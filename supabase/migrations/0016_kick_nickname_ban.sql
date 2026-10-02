-- Vibe: nickname-layer kick bans (closes the incognito re-entry hole).
-- Run AFTER 0015 in Supabase SQL editor.
-- IDEMPOTENT: guards + CREATE OR REPLACE, same signatures.
--
-- Why: room_kicks bans user_id, but anonymous auth mints a NEW user_id per
-- browser/device/storage-wipe, so a kicked player could walk straight back
-- in from incognito with the same name. Kicks now also record the
-- lowercased nickname, and join_room rejects either signal.
-- Tradeoffs (accepted): a kicked player can still evade by renaming (but
-- the new name is visible to the host), and an innocent friend picking the
-- exact same name is blocked until restart clears bans. Mid-game new seats
-- stay blocked by the existing "Game already started" guard.

-- ---------- schema ----------
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'room_kicks' and column_name = 'nickname'
  ) then
    alter table public.room_kicks add column nickname text;
  end if;
end $$;

-- ---------- host kick (removal + user + nickname ban until restart) ----------
create or replace function public.kick_player(p_room_id uuid, p_player_id uuid)
returns void language plpgsql security definer as $$
declare
  v_target_user uuid;
  v_target_nick text;
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can remove players'; end if;
  select user_id, nickname into v_target_user, v_target_nick
  from public.players where id = p_player_id and room_id = p_room_id;
  if not found then raise exception 'Player not in this room'; end if;
  if v_target_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;

  insert into public.room_kicks (room_id, user_id, nickname)
  values (p_room_id, v_target_user, lower(trim(both from coalesce(v_target_nick, ''))))
  on conflict (room_id, user_id) do update set nickname = excluded.nickname;

  perform public._remove_player_and_heal(p_room_id, p_player_id);
end $$;

-- ---------- join (user + nickname ban check first) ----------
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

  -- Kicked seats stay out (same session, new session, or same nickname)
  -- until restart clears bans.
  if exists (
    select 1 from public.room_kicks
    where room_id = v_room.id
      and (user_id = auth.uid()
        or (nickname is not null and nickname <> '' and nickname = lower(v_nick)))
  ) then raise exception 'Kicked by host'; end if;

  -- Rejoin with same session: just update nickname (allowed mid-game so a
  -- refresh can reclaim its seat; strangers still hit the guard below).
  select id into v_existing from public.players where room_id = v_room.id and user_id = auth.uid();
  if found then
    update public.players set nickname = v_nick, last_seen = now() where id = v_existing;
    return;
  end if;

  -- New seat: lobby only.
  if v_room.phase <> 'lobby' then raise exception 'Game already started'; end if;

  select count(*) into v_count from public.players where room_id = v_room.id;
  if v_count >= 8 then raise exception 'Room is full (8 max)'; end if;

  -- Auto-suffix duplicate nicknames: RJ, RJ2, RJ3…
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

-- ---------- permissions ----------
grant execute on function public.kick_player(uuid, uuid) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
