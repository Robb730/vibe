-- Vibe: synced countdown entry into voting.
-- Run AFTER 0006 in Supabase SQL editor. Same signatures (OR REPLACE).
--
-- The first song of each prompt group gets vote_deadline = now() + 34s:
-- a 4s shared countdown (clients show 3-2-1) followed by the 30s vote
-- window. Clients derive entry time as (first deadline - 30s), so every
-- screen drops into voting simultaneously with no tap needed.

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
  update public.rounds set vote_deadline = now() + interval '34 seconds'
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
    update public.rounds set vote_deadline = now() + interval '34 seconds'
    where id in (
      select id from public.rounds
      where room_id = p_room_id and prompt_ord = v_cur + 1
      order by order_idx limit 1
    );
  end if;
end $$;

grant execute on function public.start_guessing(uuid) to authenticated;
grant execute on function public.next_prompt(uuid) to authenticated;
