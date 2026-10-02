-- Vibe: heartbeat presence, host kick, lobby ready-up.
-- Run AFTER 0014 in Supabase SQL editor.
-- IDEMPOTENT: guards + CREATE OR REPLACE, same signatures where kept.
--
-- Why: browsers fire pagehide for BOTH tab close and refresh, so the
-- client can never distinguish them at unload. Instead every seated
-- client heartbeats every 15s (players.last_seen); rows silent for 90s
-- (closed tabs) are pruned with the full 0014 heal, while refreshes keep
-- heartbeating and never lose their seat, crown, or ready state.
-- - kick_player: host-only removal + ban until restart_game.
-- - set_ready + start_game guard: all non-host players must be ready.

-- ---------- schema ----------
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'players' and column_name = 'last_seen'
  ) then
    alter table public.players add column last_seen timestamptz not null default now();
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'players' and column_name = 'is_ready'
  ) then
    alter table public.players add column is_ready boolean not null default false;
  end if;
end $$;

-- Kick bans: kicked seats can't rejoin (same session or new) until the
-- host restarts the game, which clears this room's bans.
create table if not exists public.room_kicks (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_kicks enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'room_kicks' and policyname = 'anon read room_kicks'
  ) then
    create policy "anon read room_kicks" on public.room_kicks for select to authenticated using (true);
  end if;
end $$;

-- ---------- shared removal + heal (extracted 0014 leave body) ----------
create or replace function public._remove_player_and_heal(p_room_id uuid, p_player_id uuid)
returns void language plpgsql security definer as $$
declare
  v_is_host boolean;
  v_next_host uuid;
  v_remaining int;
  v_phase text;
  v_prompt int;
  v_mode text;
  v_nplayers int;
  v_nprompts int;
  v_gsongs int;
  v_nrankers int;
  v_idx int;
  v_prompt_texts text[];
  v_picker_order uuid[];
  v_pi int;
  v_si int;
  v_gidx int := 0;
  v_round_id uuid;
begin
  if not exists (
    select 1 from public.players where id = p_player_id and room_id = p_room_id
  ) then return; end if;

  select r.phase, r.current_prompt, r.game_mode, (r.host_id = p_player_id)
  into v_phase, v_prompt, v_mode, v_is_host
  from public.rooms r where r.id = p_room_id;
  if not found then return; end if;

  -- Leaver's footprint goes with them (round cascades clean
  -- votes/rankings/secret_picks for deleted rounds).
  delete from public.rankings where ranker_id = p_player_id;
  delete from public.votes where voter_id = p_player_id or guessed_id = p_player_id;
  delete from public.secret_prompts where room_id = p_room_id and author_id = p_player_id;
  delete from public.rounds
  where room_id = p_room_id
    and (picker_id = p_player_id
      or id in (select round_id from public.secret_picks where picker_id = p_player_id));

  delete from public.players where id = p_player_id;

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

  -- ---------- phase heal ----------
  if v_phase = 'prompts' then
    select count(*) into v_nplayers from public.players where room_id = p_room_id;
    select count(*) into v_nprompts from public.secret_prompts where room_id = p_room_id;
    if v_nplayers > 0 and v_nprompts >= v_nplayers then
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
    return;
  end if;

  if v_phase = 'songs' then
    return;
  end if;

  if v_phase = 'guessing' then
    select count(*) into v_gsongs
    from public.rounds where room_id = p_room_id and prompt_ord = v_prompt;
    if v_gsongs > 0 then
      select current_round into v_idx from public.rooms where id = p_room_id;
      if v_idx is not null and v_idx >= v_gsongs then
        update public.rooms set current_round = greatest(0, v_gsongs - 1)
        where id = p_room_id;
      end if;
    end if;

    if coalesce(v_mode, 'guess') = 'rank' then
      update public.rankings rk set rank = ordered.rn
      from (
        select rk2.id, row_number() over (partition by rk2.ranker_id order by rk2.rank) as rn
        from public.rankings rk2
        join public.rounds r on r.id = rk2.round_id
        where r.room_id = p_room_id and r.prompt_ord = v_prompt
      ) ordered
      where ordered.id = rk.id;

      select count(distinct rk.ranker_id) into v_nrankers
      from public.rankings rk
      join public.rounds r on r.id = rk.round_id
      where r.room_id = p_room_id and r.prompt_ord = v_prompt;
      select count(*) into v_nplayers from public.players where room_id = p_room_id;
      if v_gsongs > 0 and v_nrankers >= v_nplayers then
        perform public._reveal_rank_group(p_room_id, v_prompt);
      end if;
    else
      select count(*) into v_nplayers from public.players where room_id = p_room_id;
      update public.rounds r set status = 'locked'
      where r.room_id = p_room_id and r.prompt_ord = v_prompt and r.status = 'open'
        and (select count(*) from public.votes v where v.round_id = r.id) >= greatest(v_nplayers - 1, 0);
      perform public._reveal_group_if_done(p_room_id, v_prompt);
    end if;
    return;
  end if;
end $$;

-- ---------- leave (explicit Leave button) ----------
create or replace function public.leave_room(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
begin
  select id into v_me
  from public.players
  where room_id = p_room_id and user_id = auth.uid();
  if not found then return; end if;

  perform public._remove_player_and_heal(p_room_id, v_me);
end $$;

-- ---------- host kick (removal + ban until restart) ----------
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

  insert into public.room_kicks (room_id, user_id)
  values (p_room_id, v_target_user)
  on conflict (room_id, user_id) do nothing;

  perform public._remove_player_and_heal(p_room_id, p_player_id);
end $$;

-- ---------- heartbeat (liveness + 90s ghost prune) ----------
create or replace function public.heartbeat(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_off uuid;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;

  update public.players set last_seen = now() where id = v_me;

  -- Prune closed tabs (silent 90s+). Refreshes keep beating, so they are
  -- never touched. One room per call keeps this cheap.
  for v_off in
    select id from public.players
    where room_id = p_room_id and last_seen < now() - interval '90 seconds'
  loop
    perform public._remove_player_and_heal(p_room_id, v_off);
  end loop;
end $$;

-- ---------- ready-up ----------
create or replace function public.set_ready(p_room_id uuid, p_ready boolean)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  update public.players set is_ready = coalesce(p_ready, false), last_seen = now() where id = v_me;
end $$;

-- ---------- join (ban check first) ----------
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

  -- Kicked seats stay out (same session or new) until restart clears bans.
  if exists (
    select 1 from public.room_kicks where room_id = v_room.id and user_id = auth.uid()
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

-- ---------- start (ready gate) / restart (resets + clears bans) ----------
create or replace function public.start_game(p_room_id uuid, p_mode text default 'guess')
returns void language plpgsql security definer as $$
declare v_count int; v_phase text; v_mode text := lower(trim(both from coalesce(p_mode, 'guess'))); v_host uuid;
begin
  if v_mode not in ('guess', 'rank') then raise exception 'Invalid game mode'; end if;
  if not public._is_host(p_room_id) then raise exception 'Only the host can start'; end if;
  select phase, host_id into v_phase, v_host from public.rooms where id = p_room_id;
  if v_phase <> 'lobby' then raise exception 'Game already started'; end if;
  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 3 then raise exception 'Need at least 3 players'; end if;
  if exists (
    select 1 from public.players
    where room_id = p_room_id and id <> v_host and is_ready = false
  ) then raise exception 'Waiting for everyone to ready up'; end if;

  delete from public.rankings where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.rounds where room_id = p_room_id;
  delete from public.secret_prompts where room_id = p_room_id;
  update public.players set score = 0, is_ready = false where room_id = p_room_id;
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
  delete from public.room_kicks where room_id = p_room_id;
  update public.players set score = 0, is_ready = false where room_id = p_room_id;
  update public.rooms set phase = 'lobby', current_round = 0, current_prompt = 0 where id = p_room_id;
end $$;

-- ---------- permissions ----------
grant execute on function public._remove_player_and_heal(uuid, uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.kick_player(uuid, uuid) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.set_ready(uuid, boolean) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.start_game(uuid, text) to authenticated;
grant execute on function public.restart_game(uuid) to authenticated;
