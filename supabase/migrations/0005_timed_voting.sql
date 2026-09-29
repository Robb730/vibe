-- Vibe milestone: simultaneous timed voting (30s windows, 3s fast-forward).
-- Run AFTER 0004 in Supabase SQL editor.
-- rooms.current_round becomes the server-driven song index within the
-- current prompt group (previously write-only). Deadlines use DB time.

-- ---------- schema ----------
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rounds' and column_name = 'vote_deadline'
  ) then
    alter table public.rounds add column vote_deadline timestamptz;
  end if;
end $$;

-- ---------- shared batch-reveal (scores exactly once) ----------
create or replace function public._reveal_group_if_done(p_room_id uuid, p_prompt int)
returns void language plpgsql security definer as $$
declare v_gsongs int; v_glocked int; v_n int;
begin
  select count(*) into v_gsongs
  from public.rounds where room_id = p_room_id and prompt_ord = p_prompt;
  if v_gsongs = 0 then return; end if;
  select count(*) into v_glocked
  from public.rounds where room_id = p_room_id and prompt_ord = p_prompt
    and status in ('locked', 'revealed');
  if v_glocked < v_gsongs then return; end if;

  -- Transition losers -> revealed; ROW_COUNT guards against double scoring
  -- when two completions race (row locks serialize under read-committed).
  update public.rounds r set picker_id = s.picker_id, status = 'revealed'
  from public.secret_picks s
  where s.round_id = r.id
    and r.room_id = p_room_id and r.prompt_ord = p_prompt
    and r.status <> 'revealed';
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;

  update public.players p set score = score + (
    select count(*)
    from public.votes v
    join public.secret_picks s on s.round_id = v.round_id
    where v.voter_id = p.id
      and v.guessed_id = s.picker_id
      and v.round_id in (
        select id from public.rounds
        where room_id = p_room_id and prompt_ord = p_prompt
      )
  )
  where p.room_id = p_room_id;
end $$;

-- ---------- voting with deadline ----------
create or replace function public.submit_vote(p_round_id uuid, p_guessed_id uuid)
returns void language plpgsql security definer as $$
declare
  v_room_id uuid; v_phase text;
  v_me uuid; v_picker uuid; v_status text; v_prompt int; v_deadline timestamptz;
  v_nplayers int; v_nvotes int;
begin
  select room_id, status, prompt_ord, vote_deadline into v_room_id, v_status, v_prompt, v_deadline
  from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  select phase into v_phase from public.rooms where id = v_room_id;
  if v_phase <> 'guessing' then raise exception 'Not in guessing phase'; end if;
  if v_status <> 'open' then raise exception 'Voting is closed for this song'; end if;

  v_me := public._my_player_id(v_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select picker_id into v_picker from public.secret_picks where round_id = p_round_id;
  if v_me = v_picker then raise exception 'Pickers cannot vote on their own song'; end if;
  if p_guessed_id = v_me then raise exception 'Cannot vote for yourself'; end if;
  if not exists (select 1 from public.players where id = p_guessed_id and room_id = v_room_id) then
    raise exception 'Invalid guess';
  end if;

  -- Late vote: close the song, run the reveal check, reject the vote.
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

  -- Lock this song once every eligible voter has voted (no reveal yet).
  if v_nvotes >= v_nplayers - 1 then
    update public.rounds set status = 'locked' where id = p_round_id;
  end if;

  perform public._reveal_group_if_done(v_room_id, v_prompt);
end $$;

-- ---------- timer advance (any member; idempotent) ----------
create or replace function public.advance_song(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_phase text; v_pr int; v_idx int;
  v_song_id uuid; v_status text; v_deadline timestamptz;
  v_gsongs int; v_grevealed int; v_affected int;
begin
  if public._my_player_id(p_room_id) is null then raise exception 'Not in this room'; end if;
  select phase, current_prompt, current_round into v_phase, v_pr, v_idx
  from public.rooms where id = p_room_id;
  if v_phase <> 'guessing' then return; end if;

  select id, status, vote_deadline into v_song_id, v_status, v_deadline
  from public.rounds
  where room_id = p_room_id and prompt_ord = v_pr
  order by order_idx limit 1 offset v_idx;
  if not found then return; end if;

  -- Expired and still open: lock it.
  if v_status = 'open' and v_deadline is not null and now() > v_deadline then
    update public.rounds set status = 'locked' where id = v_song_id and status = 'open';
    v_status := 'locked';
  end if;

  perform public._reveal_group_if_done(p_room_id, v_pr);

  -- Group fully revealed: stop here, the leaderboard takes over.
  select count(*) into v_gsongs
  from public.rounds where room_id = p_room_id and prompt_ord = v_pr;
  select count(*) into v_grevealed
  from public.rounds where room_id = p_room_id and prompt_ord = v_pr and status = 'revealed';
  if v_grevealed >= v_gsongs then return; end if;

  -- Current song still votable: nothing to do.
  if v_status = 'open' then return; end if;

  -- Move the shared pointer exactly once (concurrent callers collapse).
  update public.rooms set current_round = v_idx + 1
  where id = p_room_id and current_round = v_idx and current_prompt = v_pr;
  get diagnostics v_affected = row_count;
  if v_affected = 0 then return; end if;

  update public.rounds set vote_deadline = now() + interval '30 seconds'
  where id in (
    select id from public.rounds
    where room_id = p_room_id and prompt_ord = v_pr
    order by order_idx limit 1 offset v_idx + 1
  );
end $$;

-- ---------- stamp deadlines on group entry ----------
create or replace function public.start_guessing(p_room_id uuid)
returns void language plpgsql security definer as $$
declare v_phase text; v_total int; v_open int;
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can start guessing'; end if;
  select phase into v_phase from public.rooms where id = p_room_id;
  if v_phase <> 'songs' then raise exception 'Not in song phase'; end if;
  select count(*), count(*) filter (where track_id is null) into v_total, v_open
  from public.rounds where room_id = p_room_id;
  if v_total = 0 or v_open > 0 then raise exception 'Waiting for songs'; end if;

  update public.rooms set phase = 'guessing', current_round = 0, current_prompt = 0 where id = p_room_id;
  update public.rounds set vote_deadline = now() + interval '30 seconds'
  where id in (
    select id from public.rounds
    where room_id = p_room_id and prompt_ord = 0
    order by order_idx limit 1
  );
end $$;

create or replace function public.next_prompt(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_phase text; v_cur int; v_total_groups int; v_gsongs int; v_grevealed int;
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can advance'; end if;
  select phase, current_prompt into v_phase, v_cur from public.rooms where id = p_room_id;
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
    update public.rounds set vote_deadline = now() + interval '30 seconds'
    where id in (
      select id from public.rounds
      where room_id = p_room_id and prompt_ord = v_cur + 1
      order by order_idx limit 1
    );
  end if;
end $$;

-- Permissions
grant execute on function public.submit_vote(uuid, uuid) to authenticated;
grant execute on function public.advance_song(uuid) to authenticated;
grant execute on function public.start_guessing(uuid) to authenticated;
grant execute on function public.next_prompt(uuid) to authenticated;
