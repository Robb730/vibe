-- Vibe: rooms die with their last player.
-- Run AFTER 0012 in Supabase SQL editor.
-- Reverses the 0008 keep-alive rule by request: leaving removes my player
-- row; if I was host, the crown passes to the earliest-joined remaining
-- player; if NOBODY remains, the room row is deleted (rounds, votes,
-- rankings, messages cascade; the global prompt_bank is untouched).
-- Old invite links to deleted rooms return "Room not found" (client
-- already handles that + the room-closed redirect).
-- IDEMPOTENT: CREATE OR REPLACE, same signature.

create or replace function public.leave_room(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_is_host boolean;
  v_next_host uuid;
  v_remaining int;
begin
  select id into v_me
  from public.players
  where room_id = p_room_id and user_id = auth.uid();
  if not found then return; end if;

  select (host_id = v_me) into v_is_host
  from public.rooms where id = p_room_id;

  delete from public.players where id = v_me;

  select count(*) into v_remaining
  from public.players where room_id = p_room_id;

  -- Empty room: delete it so no ghost rooms linger.
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
end $$;

grant execute on function public.leave_room(uuid) to authenticated;
