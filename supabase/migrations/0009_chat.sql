-- Vibe: live chat + delete the room (and its chat) when the last player leaves.
-- Run AFTER 0008 in Supabase SQL editor.
--
-- Reverses 0008's never-delete rule: an empty room has no one left to play,
-- so the room row goes and every child (rounds, votes, secrets, messages)
-- follows via ON DELETE CASCADE.

-- ---------- messages ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  nickname text not null check (char_length(nickname) between 1 and 20),
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists messages_room_created_idx
  on public.messages (room_id, created_at);

alter table public.messages enable row level security;
-- RPC-only writes (no direct insert policy); reads scoped below.
drop policy if exists "anon read messages" on public.messages;
create policy "anon read messages" on public.messages
  for select to authenticated using (true);

-- Send a chat message as my current nickname. Cheap spam guard included.
create or replace function public.send_message(p_room_id uuid, p_body text)
returns void language plpgsql security definer as $$
declare
  v_me public.players%rowtype;
  v_text text := trim(both from coalesce(p_body, ''));
  v_recent int;
begin
  select * into v_me from public.players
  where room_id = p_room_id and user_id = auth.uid();
  if not found then raise exception 'Not in this room'; end if;
  if char_length(v_text) < 1 or char_length(v_text) > 200 then
    raise exception 'Message must be 1-200 characters';
  end if;

  select count(*) into v_recent from public.messages
  where room_id = p_room_id and player_id = v_me.id
    and created_at > now() - interval '60 seconds';
  if v_recent >= 30 then raise exception 'Slow down — too many messages'; end if;

  insert into public.messages (room_id, player_id, nickname, body)
  values (p_room_id, v_me.id, v_me.nickname, v_text);
end $$;

grant execute on function public.send_message(uuid, text) to authenticated;

-- Realtime for chat (same pattern as 0003).
alter publication supabase_realtime add table public.messages;
alter table public.messages replica identity full;

-- ---------- leave: pass the crown, vanish when empty ----------
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

  -- Nobody left: the room (and its chat, rounds, votes, secrets) goes too.
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
