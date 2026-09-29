-- Vibe fix: self-healing vote deadlines.
-- Run AFTER 0005 in Supabase SQL editor. Safe to run even if 0005 was
-- applied long ago (CREATE OR REPLACE, same signature).
--
-- Why: games already in progress when 0005 landed have songs with
-- vote_deadline = NULL, so clients show no timer and advance_song has no
-- clock to enforce. With this version, the first client to notice stamps
-- the missing deadline and the 30s window starts by itself.

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

  -- Self-heal: no deadline yet (pre-0005 game) -> start its 30s clock now.
  if v_deadline is null then
    update public.rounds set vote_deadline = now() + interval '30 seconds'
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

  update public.rounds set vote_deadline = now() + interval '30 seconds'
  where id in (
    select id from public.rounds
    where room_id = p_room_id and prompt_ord = v_pr
    order by order_idx limit 1 offset v_idx + 1
  );
end $$;

grant execute on function public.advance_song(uuid) to authenticated;
