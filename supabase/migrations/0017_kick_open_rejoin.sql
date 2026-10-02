-- Vibe: kicked players may rejoin immediately (no bans).
-- Run AFTER 0016 in Supabase SQL editor.
-- IDEMPOTENT: CREATE OR REPLACE, same signatures.
--
-- Why: kick is removal only now — the row is deleted and the game heals,
-- but rejoining (same session, new session, any nickname) is always
-- allowed. The client tells "kicked" apart from "my own refresh" via a
-- session unload flag, so mid-game auto-rejoin no longer undoes kicks.
-- room_kicks is unused after this and is dropped.

-- ---------- host kick (removal + heal, no ban) ----------
create or replace function public.kick_player(p_room_id uuid, p_player_id uuid)
returns void language plpgsql security definer as $$
declare
  v_target_user uuid;
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can remove players'; end if;
  select user_id into v_target_user
  from public.players where id = p_player_id and room_id = p_room_id;
  if not found then raise exception 'Player not in this room'; end if;
  if v_target_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;

  perform public._remove_player_and_heal(p_room_id, p_player_id);
end $$;

-- ---------- join (no ban check; kicked seats may rejoin) ----------
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
  -- refresh — or a removed player on the same device — can reclaim a seat;
  -- strangers still hit the guard below).
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

-- ---------- restart (no bans to clear anymore) ----------
create or replace function public.restart_game(p_room_id uuid)
returns void language plpgsql security definer as $$
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can restart'; end if;
  delete from public.rankings where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.rounds where room_id = p_room_id;
  delete from public.secret_prompts where room_id = p_room_id;
  update public.players set score = 0, is_ready = false where room_id = p_room_id;
  update public.rooms set phase = 'lobby', current_round = 0, current_prompt = 0 where id = p_room_id;
end $$;

-- ---------- drop the now-unused bans table ----------
drop table if exists public.room_kicks;

-- ---------- permissions ----------
grant execute on function public.kick_player(uuid, uuid) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.restart_game(uuid) to authenticated;
