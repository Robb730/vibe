-- Vibe: leaving mid-game must not stall the game + same-session rejoin.
-- Run AFTER 0013 in Supabase SQL editor.
-- IDEMPOTENT: CREATE OR REPLACE, same signatures.
--
-- What was wrong:
-- - leave_room deleted only the player row (plus crown pass / empty-room
--   delete). The leaver's secret_prompts cascade away, but nothing
--   re-checked phase completion, so:
--     prompts: all-in shuffle never re-ran -> stuck waiting for a ghost.
--     songs:   leaver's secret_picks rows cascade away, leaving orphan
--              rounds (no picker, track_id NULL) -> start_guessing stuck.
--     guessing (guess): reveal only ran inside submit_vote/advance_song,
--              so a group waiting on the leaver's vote never revealed.
--     guessing (rank):  remaining ballots kept the old N-1 size.
-- - votes.guessed_id had no ON DELETE action, so deleting a player others
--   had guessed at could fail with an FK violation.
-- - join_room rejected mid-game joins even for the SAME anon session
--   (refresh that deleted its own row under the old client beacon, then
--   tried to reclaim its seat) with "Game already started".
--
-- This migration:
-- 1. votes.guessed_id -> ON DELETE CASCADE (votes guessing a leaver go
--    away; affected voters can simply vote again).
-- 2. leave_room removes the leaver's rounds/ballots/votes/prompts and then
--    heals the current phase (prompts reshuffle, guess lock+reveal, rank
--    ballot renumber+reveal-if-complete, current_round clamp).
-- 3. join_room lets an existing member reclaim their seat mid-game.

-- ---------- 1. FK: votes guessing a deleted player cascade ----------
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.votes'::regclass and conname = 'votes_guessed_id_fkey'
  ) then
    alter table public.votes drop constraint votes_guessed_id_fkey;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.votes'::regclass and conname = 'votes_guessed_id_fkey'
  ) then
    alter table public.votes add constraint votes_guessed_id_fkey
      foreign key (guessed_id) references public.players(id) on delete cascade;
  end if;
end $$;

-- ---------- 2. Resilient leave ----------
create or replace function public.leave_room(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_is_host boolean;
  v_next_host uuid;
  v_remaining int;
  v_phase text;
  v_prompt int;
  v_mode text;
  v_nplayers int;
  v_nprompts int;
  v_gsongs int;
  v_nrankers int;
  v_idx int;
  v_prompt_texts text[];
  v_picker_order uuid[];
  v_pi int;
  v_si int;
  v_gidx int := 0;
  v_round_id uuid;
begin
  select id into v_me
  from public.players
  where room_id = p_room_id and user_id = auth.uid();
  if not found then return; end if;

  select r.phase, r.current_prompt, r.game_mode, (r.host_id = v_me)
  into v_phase, v_prompt, v_mode, v_is_host
  from public.rooms r where r.id = p_room_id;
  if not found then return; end if;

  -- Leaver's footprint goes with them: own ballots/votes (voter cascade
  -- covers voter_id; guessed_id cascade covers guesses AT the leaver),
  -- own prompt, and every song slot they owned (revealed or not). Round
  -- cascades clean votes/rankings/secret_picks for deleted rounds.
  delete from public.rankings where ranker_id = v_me;
  delete from public.votes where voter_id = v_me or guessed_id = v_me;
  delete from public.secret_prompts where room_id = p_room_id and author_id = v_me;
  delete from public.rounds
  where room_id = p_room_id
    and (picker_id = v_me
      or id in (select round_id from public.secret_picks where picker_id = v_me));

  delete from public.players where id = v_me;

  select count(*) into v_remaining
  from public.players where room_id = p_room_id;

  -- Empty room: delete it so no ghost rooms linger (0013 rule kept).
  if v_remaining = 0 then
    delete from public.rooms where id = p_room_id;
    return;
  end if;

  -- Pass the crown so host-gated buttons keep working.
  if coalesce(v_is_host, false) then
    select id into v_next_host
    from public.players
    where room_id = p_room_id
    order by joined_at asc limit 1;
    if found then
      update public.rooms set host_id = v_next_host where id = p_room_id;
    end if;
  end if;

  -- ---------- phase heal ----------
  if v_phase = 'prompts' then
    select count(*) into v_nplayers from public.players where room_id = p_room_id;
    select count(*) into v_nprompts from public.secret_prompts where room_id = p_room_id;
    -- Everyone remaining already submitted: run the same all-in shuffle
    -- submit_prompt runs (P x N slots, prompt display order shuffled,
    -- answer order reshuffled per prompt).
    if v_nplayers > 0 and v_nprompts >= v_nplayers then
      insert into public.prompt_bank (text)
      select distinct text from public.secret_prompts where room_id = p_room_id
      on conflict (text) do nothing;

      select array_agg(text order by r) into v_prompt_texts
      from (select text, random() as r from public.secret_prompts where room_id = p_room_id) s;

      delete from public.rankings where round_id in (select id from public.rounds where room_id = p_room_id);
      delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
      delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
      delete from public.rounds where room_id = p_room_id;

      for v_pi in 1..array_length(v_prompt_texts, 1) loop
        select array_agg(id order by r) into v_picker_order
        from (select id, random() as r from public.players where room_id = p_room_id) s;

        for v_si in 1..array_length(v_picker_order, 1) loop
          insert into public.rounds (room_id, order_idx, prompt_ord, prompt_text, status)
          values (p_room_id, v_gidx, v_pi - 1, v_prompt_texts[v_pi], 'open')
          returning id into v_round_id;
          insert into public.secret_picks (round_id, picker_id)
          values (v_round_id, v_picker_order[v_si]);
          v_gidx := v_gidx + 1;
        end loop;
      end loop;

      update public.rooms set phase = 'songs' where id = p_room_id;
    end if;
    return;
  end if;

  if v_phase = 'songs' then
    -- Nothing to auto-flip: deleting the leaver's slots already unblocks
    -- start_guessing (host starts once no track_id IS NULL remains).
    return;
  end if;

  if v_phase = 'guessing' then
    -- Clamp the shared song pointer in case the current song left with them.
    select count(*) into v_gsongs
    from public.rounds where room_id = p_room_id and prompt_ord = v_prompt;
    if v_gsongs > 0 then
      select current_round into v_idx from public.rooms where id = p_room_id;
      if v_idx is not null and v_idx >= v_gsongs then
        update public.rooms set current_round = greatest(0, v_gsongs - 1)
        where id = p_room_id;
      end if;
    end if;

    if coalesce(v_mode, 'guess') = 'rank' then
      -- Close rank gaps left by deleted ballot rows, then reveal only on a
      -- real full house (remaining players x new N-1 rows).
      update public.rankings rk set rank = ordered.rn
      from (
        select rk2.id, row_number() over (partition by rk2.ranker_id order by rk2.rank) as rn
        from public.rankings rk2
        join public.rounds r on r.id = rk2.round_id
        where r.room_id = p_room_id and r.prompt_ord = v_prompt
      ) ordered
      where ordered.id = rk.id;

      select count(distinct rk.ranker_id) into v_nrankers
      from public.rankings rk
      join public.rounds r on r.id = rk.round_id
      where r.room_id = p_room_id and r.prompt_ord = v_prompt;
      select count(*) into v_nplayers from public.players where room_id = p_room_id;
      if v_gsongs > 0 and v_nrankers >= v_nplayers then
        perform public._reveal_rank_group(p_room_id, v_prompt);
      end if;
    else
      -- Lock songs whose remaining votes now meet the shrunk threshold,
      -- then reveal the group if it is complete.
      select count(*) into v_nplayers from public.players where room_id = p_room_id;
      update public.rounds r set status = 'locked'
      where r.room_id = p_room_id and r.prompt_ord = v_prompt and r.status = 'open'
        and (select count(*) from public.votes v where v.round_id = r.id) >= greatest(v_nplayers - 1, 0);
      perform public._reveal_group_if_done(p_room_id, v_prompt);
    end if;
    return;
  end if;
end $$;

grant execute on function public.leave_room(uuid) to authenticated;

-- ---------- 3. Same-session rejoin (mid-game seat reclaim) ----------
create or replace function public.join_room(p_code text, p_nickname text)
returns void language plpgsql security definer as $$
declare
  v_room public.rooms%rowtype;
  v_nick text := trim(both from coalesce(p_nickname, ''));
  v_count int;
  v_existing uuid;
begin
  if char_length(v_nick) < 1 or char_length(v_nick) > 20 then
    raise exception 'Nickname must be 1-20 characters';
  end if;
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_room from public.rooms where code = upper(trim(both from coalesce(p_code, '')));
  if not found then raise exception 'Room not found'; end if;

  -- Rejoin with same session: just update nickname (allowed mid-game so a
  -- refresh can reclaim its seat; strangers still hit the guard below).
  select id into v_existing from public.players where room_id = v_room.id and user_id = auth.uid();
  if found then
    update public.players set nickname = v_nick where id = v_existing;
    return;
  end if;

  -- New seat: lobby only.
  if v_room.phase <> 'lobby' then raise exception 'Game already started'; end if;

  select count(*) into v_count from public.players where room_id = v_room.id;
  if v_count >= 8 then raise exception 'Room is full (8 max)'; end if;

  -- Auto-suffix duplicate nicknames: Robb, Robb2, Robb3…
  if exists (select 1 from public.players where room_id = v_room.id and nickname = v_nick) then
    for i in 2..99 loop
      if not exists (select 1 from public.players where room_id = v_room.id and nickname = v_nick || i::text) then
        v_nick := v_nick || i::text;
        exit;
      end if;
    end loop;
  end if;

  insert into public.players (room_id, user_id, nickname)
  values (v_room.id, auth.uid(), v_nick);
end $$;

grant execute on function public.join_room(text, text) to authenticated;
