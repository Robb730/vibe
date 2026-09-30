-- Vibe: Rank the Picks (game mode 2).
-- Run AFTER 0010 in Supabase SQL editor.
-- IDEMPOTENT: guards + drops first (same style as 0004-0010).
--
-- OG mode ("Guess Who") untouched: default game_mode='guess', old
-- start_game(p_room_id) calls keep working via default p_mode.

-- ---------- stale-function cleanup ----------
drop function if exists public.start_game(uuid);
drop function if exists public.start_game(uuid, text);
drop function if exists public.submit_vote(uuid, uuid);
drop function if exists public.submit_rankings(uuid, int, jsonb);
drop function if exists public.finalize_rank_group(uuid, int);
drop function if exists public._reveal_rank_group(uuid, int);
drop function if exists public.start_guessing(uuid);
drop function if exists public.next_prompt(uuid);

-- ---------- schema ----------
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'game_mode'
  ) then
    alter table public.rooms add column game_mode text not null default 'guess';
  end if;
end $$;

-- Normalize a drifted check, then enforce guess|rank.
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.rooms'::regclass and conname = 'rooms_game_mode_check'
  ) then
    alter table public.rooms drop constraint rooms_game_mode_check;
  end if;
  alter table public.rooms add constraint rooms_game_mode_check
    check (game_mode in ('guess', 'rank'));
end $$;

-- Ballots: one row per (song, ranker). Full ballot = N-1 rows.
create table if not exists public.rankings (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  ranker_id uuid not null references public.players(id) on delete cascade,
  rank int not null check (rank >= 1),
  created_at timestamptz not null default now(),
  unique (round_id, ranker_id)
);
alter table public.rankings enable row level security;

-- Open read like votes (ranker ids only meaningful after reveal).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'rankings' and policyname = 'anon read rankings'
  ) then
    create policy "anon read rankings" on public.rankings for select to authenticated using (true);
  end if;
end $$;

alter table public.rankings replica identity full;
do $$ begin
  begin
    alter publication supabase_realtime add table public.rankings;
  exception when duplicate_object then
    -- already a member: ignore
  end;
end $$;

-- ---------- shared rank reveal (Borda, scores exactly once) ----------
create or replace function public._reveal_rank_group(p_room_id uuid, p_prompt int)
returns void language plpgsql security definer as $$
declare v_n int; v_gsongs int; v_nplayers int; v_affected int;
begin
  select count(*) into v_gsongs
  from public.rounds where room_id = p_room_id and prompt_ord = p_prompt;
  if v_gsongs = 0 then return; end if;
  select count(*) into v_nplayers
  from public.players where room_id = p_room_id;

  -- Transition open/locked -> revealed; ROW_COUNT guards double scoring.
  update public.rounds r set picker_id = s.picker_id, status = 'revealed'
  from public.secret_picks s
  where s.round_id = r.id
    and r.room_id = p_room_id and r.prompt_ord = p_prompt
    and r.status <> 'revealed';
  get diagnostics v_affected = row_count;
  if v_affected = 0 then return; end if;

  -- Borda: rank r in a group of N songs earns the picker (N - r) pts.
  update public.players p set score = score + coalesce((
    select sum(v_gsongs - rk.rank)
    from public.rankings rk
    join public.secret_picks s on s.round_id = rk.round_id
    where s.picker_id = p.id
      and rk.round_id in (
        select id from public.rounds
        where room_id = p_room_id and prompt_ord = p_prompt
      )
  ), 0)
  where p.room_id = p_room_id;
end $$;

-- ---------- start / restart (mode-aware, clears rankings) ----------
create or replace function public.start_game(p_room_id uuid, p_mode text default 'guess')
returns void language plpgsql security definer as $$
declare v_count int; v_phase text; v_mode text := lower(trim(both from coalesce(p_mode, 'guess')));
begin
  if v_mode not in ('guess', 'rank') then raise exception 'Invalid game mode'; end if;
  if not public._is_host(p_room_id) then raise exception 'Only the host can start'; end if;
  select phase into v_phase from public.rooms where id = p_room_id;
  if v_phase <> 'lobby' then raise exception 'Game already started'; end if;
  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 3 then raise exception 'Need at least 3 players'; end if;

  delete from public.rankings where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.rounds where room_id = p_room_id;
  delete from public.secret_prompts where room_id = p_room_id;
  update public.players set score = 0 where room_id = p_room_id;
  update public.rooms set phase = 'prompts', current_round = 0, current_prompt = 0, game_mode = v_mode where id = p_room_id;
end $$;

create or replace function public.restart_game(p_room_id uuid)
returns void language plpgsql security definer as $$
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can restart'; end if;
  delete from public.rankings where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.rounds where room_id = p_room_id;
  delete from public.secret_prompts where room_id = p_room_id;
  update public.players set score = 0 where room_id = p_room_id;
  update public.rooms set phase = 'lobby', current_round = 0, current_prompt = 0 where id = p_room_id;
end $$;

-- NOTE: submit_prompt (0010 version) also wipes rounds on reshuffle — clear
-- rankings there too so a re-dealt game can't keep stale ballots. Recreated
-- here with identical logic + one extra delete.
create or replace function public.submit_prompt(p_room_id uuid, p_text text)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_phase text;
  v_text text := trim(both from coalesce(p_text, ''));
  v_nplayers int;
  v_nprompts int;
  v_prompt_texts text[];
  v_picker_order uuid[];
  v_pi int;
  v_si int;
  v_gidx int := 0;
  v_round_id uuid;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select phase into v_phase from public.rooms where id = p_room_id;
  if v_phase <> 'prompts' then raise exception 'Not in prompt phase'; end if;
  if char_length(v_text) < 1 or char_length(v_text) > 60 then
    raise exception 'Prompt must be 1-60 characters';
  end if;

  insert into public.secret_prompts (room_id, author_id, text)
  values (p_room_id, v_me, v_text)
  on conflict (room_id, author_id) do update set text = excluded.text;

  select count(*) into v_nplayers from public.players where room_id = p_room_id;
  select count(*) into v_nprompts from public.secret_prompts where room_id = p_room_id;

  if v_nprompts >= v_nplayers then
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
end $$;

-- ---------- voting: guess-mode only (anti-cross-mode guard) ----------
create or replace function public.submit_vote(p_round_id uuid, p_guessed_id uuid)
returns void language plpgsql security definer as $$
declare
  v_room_id uuid; v_phase text; v_mode text;
  v_me uuid; v_picker uuid; v_status text; v_prompt int; v_deadline timestamptz;
  v_nplayers int; v_nvotes int;
begin
  select room_id, status, prompt_ord, vote_deadline into v_room_id, v_status, v_prompt, v_deadline
  from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  select phase, game_mode into v_phase, v_mode from public.rooms where id = v_room_id;
  if v_phase <> 'guessing' then raise exception 'Not in guessing phase'; end if;
  if v_mode <> 'guess' then raise exception 'Not in guess mode'; end if;
  if v_status <> 'open' then raise exception 'Voting is closed for this song'; end if;

  v_me := public._my_player_id(v_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select picker_id into v_picker from public.secret_picks where round_id = p_round_id;
  if v_me = v_picker then raise exception 'Pickers cannot vote on their own song'; end if;
  if p_guessed_id = v_me then raise exception 'Cannot vote for yourself'; end if;
  if not exists (select 1 from public.players where id = p_guessed_id and room_id = v_room_id) then
    raise exception 'Invalid guess';
  end if;

  if v_deadline is not null and now() > v_deadline then
    update public.rounds set status = 'locked' where id = p_round_id and status = 'open';
    perform public._reveal_group_if_done(v_room_id, v_prompt);
    raise exception 'Time is up';
  end if;

  insert into public.votes (round_id, voter_id, guessed_id)
  values (p_round_id, v_me, p_guessed_id)
  on conflict (round_id, voter_id) do update set guessed_id = excluded.guessed_id;

  select count(*) into v_nplayers from public.players where room_id = v_room_id;
  select count(*) into v_nvotes from public.votes where round_id = p_round_id;

  if v_nvotes >= v_nplayers - 1 then
    update public.rounds set status = 'locked' where id = p_round_id;
  end if;

  perform public._reveal_group_if_done(v_room_id, v_prompt);
end $$;

-- ---------- rankings: atomic full ballot ----------
-- p_ballot: JSON array of round_id strings, best-fit first.
-- Validates permutation 1..N-1 over exactly the other N-1 slots.
create or replace function public.submit_rankings(p_room_id uuid, p_prompt int, p_ballot jsonb)
returns void language plpgsql security definer as $$
declare
  v_me uuid; v_phase text; v_mode text;
  v_n int; v_len int; v_i int; v_rid uuid;
  v_picker uuid; v_nrankers int;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select phase, game_mode into v_phase, v_mode from public.rooms where id = p_room_id;
  if v_phase <> 'guessing' then raise exception 'Not in ranking phase'; end if;
  if v_mode <> 'rank' then raise exception 'Not in rank mode'; end if;
  if jsonb_typeof(p_ballot) <> 'array' then raise exception 'Invalid ballot'; end if;

  select count(*) into v_n from public.rounds where room_id = p_room_id and prompt_ord = p_prompt;
  if v_n < 2 then raise exception 'No songs for this prompt'; end if;
  -- Already revealed: ballots closed.
  if exists (
    select 1 from public.rounds
    where room_id = p_room_id and prompt_ord = p_prompt and status = 'revealed'
  ) then raise exception 'Rankings are closed for this prompt'; end if;

  v_len := jsonb_array_length(p_ballot);
  if v_len <> v_n - 1 then raise exception 'Ballot must rank every other song'; end if;

  -- Validate every entry: UUID, in-group, not own, distinct.
  for v_i in 0..v_len - 1 loop
    begin
      v_rid := (p_ballot ->> v_i)::uuid;
    exception when others then
      raise exception 'Invalid ballot entry';
    end;
    if not exists (
      select 1 from public.rounds
      where id = v_rid and room_id = p_room_id and prompt_ord = p_prompt
    ) then raise exception 'Invalid ballot entry'; end if;
    select picker_id into v_picker from public.secret_picks where round_id = v_rid;
    if v_picker = v_me then raise exception 'Cannot rank your own song'; end if;
  end loop;
  -- Distinctness over the array.
  if (select count(distinct x) from (select (p_ballot ->> g)::uuid as x from generate_series(0, v_len - 1) g) s) <> v_len then
    raise exception 'Duplicate songs in ballot';
  end if;

  -- Atomic replace of my ballot for this group.
  delete from public.rankings
  where ranker_id = v_me
    and round_id in (select id from public.rounds where room_id = p_room_id and prompt_ord = p_prompt);

  for v_i in 0..v_len - 1 loop
    v_rid := (p_ballot ->> v_i)::uuid;
    insert into public.rankings (round_id, ranker_id, rank)
    values (v_rid, v_me, v_i + 1);
  end loop;

  -- Full house: every player submitted N-1 rows -> reveal + Borda score.
  select count(distinct rk.ranker_id) into v_nrankers
  from public.rankings rk
  join public.rounds r on r.id = rk.round_id
  where r.room_id = p_room_id and r.prompt_ord = p_prompt;
  if v_nrankers >= (select count(*) from public.players where room_id = p_room_id) then
    perform public._reveal_rank_group(p_room_id, p_prompt);
  end if;
end $$;

-- ---------- rankings: deadline auto-complete (anyone, idempotent) ----------
-- Missing ballots are filled with leftover ranks in slot (order_idx) order.
create or replace function public.finalize_rank_group(p_room_id uuid, p_prompt int)
returns void language plpgsql security definer as $$
declare
  v_me uuid; v_phase text; v_mode text;
  v_n int; v_missing uuid; v_slot uuid; v_pos int;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select phase, game_mode into v_phase, v_mode from public.rooms where id = p_room_id;
  if v_phase <> 'guessing' then return; end if;
  if v_mode <> 'rank' then raise exception 'Not in rank mode'; end if;

  select count(*) into v_n from public.rounds where room_id = p_room_id and prompt_ord = p_prompt;
  if v_n < 2 then return; end if;
  if exists (
    select 1 from public.rounds
    where room_id = p_room_id and prompt_ord = p_prompt and status = 'revealed'
  ) then return; end if;

  -- Auto-complete each missing ranker in slot order.
  for v_missing in
    select p.id from public.players p
    where p.room_id = p_room_id
      and not exists (
        select 1 from public.rankings rk
        join public.rounds r on r.id = rk.round_id
        where rk.ranker_id = p.id and r.room_id = p_room_id and r.prompt_ord = p_prompt
      )
  loop
    v_pos := 1;
    for v_slot in
      select r.id from public.rounds r
      join public.secret_picks s on s.round_id = r.id
      where r.room_id = p_room_id and r.prompt_ord = p_prompt and s.picker_id <> v_missing
      order by r.order_idx
    loop
      insert into public.rankings (round_id, ranker_id, rank)
      values (v_slot, v_missing, v_pos)
      on conflict (round_id, ranker_id) do nothing;
      v_pos := v_pos + 1;
    end loop;
  end loop;

  perform public._reveal_rank_group(p_room_id, p_prompt);
end $$;

-- ---------- group entry: rank mode gets staggered 15s listen windows ----------
-- Reuses vote_deadline (no new timer columns). Rank closes at last window
-- + 60s, derived client-side. Guess mode keeps the 34s countdown entry.
create or replace function public.start_guessing(p_room_id uuid)
returns void language plpgsql security definer as $$
declare v_phase text; v_total int; v_open int; v_mode text;
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can start guessing'; end if;
  select phase, game_mode into v_phase, v_mode from public.rooms where id = p_room_id;
  if v_phase <> 'songs' then raise exception 'Not in song phase'; end if;
  select count(*), count(*) filter (where track_id is null) into v_total, v_open
  from public.rounds where room_id = p_room_id;
  if v_total = 0 or v_open > 0 then raise exception 'Waiting for songs'; end if;

  update public.rooms set phase = 'guessing', current_round = 0, current_prompt = 0 where id = p_room_id;

  if v_mode = 'rank' then
    update public.rounds r set vote_deadline = base.d
    from (
      select id, now() + (row_number() over (order by order_idx) * interval '15 seconds') as d
      from public.rounds where room_id = p_room_id and prompt_ord = 0
    ) base
    where r.id = base.id;
  else
    update public.rounds set vote_deadline = now() + interval '34 seconds'
    where id in (
      select id from public.rounds
      where room_id = p_room_id and prompt_ord = 0
      order by order_idx limit 1
    );
  end if;
end $$;

create or replace function public.next_prompt(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_phase text; v_cur int; v_total_groups int; v_gsongs int; v_grevealed int; v_mode text;
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can advance'; end if;
  select phase, current_prompt, game_mode into v_phase, v_cur, v_mode from public.rooms where id = p_room_id;
  if v_phase <> 'guessing' then raise exception 'Not in guessing phase'; end if;

  select count(*) into v_gsongs
  from public.rounds where room_id = p_room_id and prompt_ord = v_cur;
  if v_gsongs = 0 then raise exception 'No songs for this prompt'; end if;
  select count(*) into v_grevealed
  from public.rounds where room_id = p_room_id and prompt_ord = v_cur and status = 'revealed';
  if v_grevealed < v_gsongs then raise exception 'Finish voting first'; end if;

  select count(distinct prompt_ord) into v_total_groups
  from public.rounds where room_id = p_room_id;

  if v_cur + 1 >= v_total_groups then
    update public.rooms set phase = 'results' where id = p_room_id;
  else
    update public.rooms set current_prompt = v_cur + 1, current_round = 0 where id = p_room_id;
    if v_mode = 'rank' then
      update public.rounds r set vote_deadline = base.d
      from (
        select id, now() + (row_number() over (order by order_idx) * interval '15 seconds') as d
        from public.rounds where room_id = p_room_id and prompt_ord = v_cur + 1
      ) base
      where r.id = base.id;
    else
      update public.rounds set vote_deadline = now() + interval '34 seconds'
      where id in (
        select id from public.rounds
        where room_id = p_room_id and prompt_ord = v_cur + 1
        order by order_idx limit 1
      );
    end if;
  end if;
end $$;

-- ---------- permissions ----------
grant execute on function public._reveal_rank_group(uuid, int) to authenticated;
grant execute on function public.start_game(uuid, text) to authenticated;
grant execute on function public.restart_game(uuid) to authenticated;
grant execute on function public.submit_prompt(uuid, text) to authenticated;
grant execute on function public.submit_vote(uuid, uuid) to authenticated;
grant execute on function public.submit_rankings(uuid, int, jsonb) to authenticated;
grant execute on function public.finalize_rank_group(uuid, int) to authenticated;
grant execute on function public.start_guessing(uuid) to authenticated;
grant execute on function public.next_prompt(uuid) to authenticated;
