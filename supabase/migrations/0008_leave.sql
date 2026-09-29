-- Vibe: proper leave path (rooms are NEVER deleted by this migration).
-- Run AFTER 0007 in Supabase SQL editor.
--
-- Leaving removes my player row; if I was host, the crown passes to the
-- earliest-joined remaining player. The room row always survives so
-- friends can keep playing and anyone can rejoin via invite link.

create or replace function public.leave_room(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_is_host boolean;
  v_next_host uuid;
begin
  select id into v_me
  from public.players
  where room_id = p_room_id and user_id = auth.uid();
  if not found then return; end if;

  select (host_id = v_me) into v_is_host
  from public.rooms where id = p_room_id;

  delete from public.players where id = v_me;

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
