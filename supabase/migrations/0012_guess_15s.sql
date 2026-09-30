-- Vibe: OG guess vote window 30s -> 15s.
-- Run AFTER 0011 in Supabase SQL editor.
-- IDEMPOTENT: CREATE OR REPLACE, same signatures (client needs no changes
-- beyond VOTE_WINDOW_MS; entry math derives from the stamped deadline).
--
-- Guess mode only: first-song entry stays 4s countdown + window, so the
-- 3-2-1 entry is preserved (19s first deadline, 15s per song after).
-- Rank branches are byte-identical to 0011 (15s listen windows + 60s rank
-- derived client-side). No in-flight reset: existing deadlines play out,
-- new stamps apply going forward.

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

  -- Self-heal: no deadline yet -> start its 15s clock now.
  if v_deadline is null then
    update public.rounds set vote_deadline = now() + interval '15 seconds'
    where id = v_song_id and vote_deadline is null;
    return;
  end if;

  -- Expired and still open: lock it.
  if v_status = 'open' and now() > v_deadline then
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

  update public.rounds set vote_deadline = now() + interval '15 seconds'
  where id in (
    select id from public.rounds
    where room_id = p_room_id and prompt_ord = v_pr
    order by order_idx limit 1 offset v_idx + 1
  );
end $$;

-- ---------- stamp deadlines on group entry ----------
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
    -- 4s shared countdown entry + 15s vote window (clients derive entry as
    -- first deadline - 15s).
    update public.rounds set vote_deadline = now() + interval '19 seconds'
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
      update public.rounds set vote_deadline = now() + interval '19 seconds'
      where id in (
        select id from public.rounds
        where room_id = p_room_id and prompt_ord = v_cur + 1
        order by order_idx limit 1
      );
    end if;
  end if;
end $$;

grant execute on function public.advance_song(uuid) to authenticated;
grant execute on function public.start_guessing(uuid) to authenticated;
grant execute on function public.next_prompt(uuid) to authenticated;
