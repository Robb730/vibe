-- Vibe milestone: full game logic (replaces 0001 stubs).
-- Run AFTER 0001_schema.sql in Supabase SQL editor.
-- Simple scoring: +1 per correct guess. Auto-reveal when all eligible voted.
-- IDEMPOTENT: drops functions first (avoids 42P13 return-type errors) and
-- normalizes columns/constraints in case tables pre-date the migrations.

-- ---------- stale-function cleanup ----------
drop function if exists public.create_room(text);
drop function if exists public.join_room(text, text);
drop function if exists public.start_game(uuid);
drop function if exists public.submit_prompt(uuid, text);
drop function if exists public.get_my_round(uuid);
drop function if exists public.submit_song(uuid, text, text, text, text, text, int);
drop function if exists public.is_picker(uuid);
drop function if exists public.submit_vote(uuid, uuid);
drop function if exists public.next_round(uuid);
drop function if exists public.restart_game(uuid);
drop function if exists public._my_player_id(uuid);
drop function if exists public._is_host(uuid);
drop function if exists public._gen_code();

-- ---------- defensive schema normalization ----------
-- create_room inserts the room BEFORE the host player exists, so host_id
-- must stay nullable. Older hand-made tables sometimes declared NOT NULL.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'host_id'
      and is_nullable = 'NO'
  ) then
    alter table public.rooms alter column host_id drop not null;
  end if;
end $$;

-- Game writes 'open' | 'locked' | 'revealed'. Normalize a drifted check.
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.rounds'::regclass and conname = 'rounds_status_check'
  ) then
    alter table public.rounds drop constraint rounds_status_check;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rounds' and column_name = 'status'
  ) then
    alter table public.rounds add constraint rounds_status_check
      check (status in ('open', 'locked', 'revealed'));
  end if;
end $$;

-- ---------- helpers ----------
create or replace function public._my_player_id(p_room_id uuid)
returns uuid language sql stable security definer as $$
  select id from public.players where room_id = p_room_id and user_id = auth.uid() limit 1;
$$;

create or replace function public._is_host(p_room_id uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from public.rooms r
    join public.players p on p.id = r.host_id
    where r.id = p_room_id and p.user_id = auth.uid()
  );
$$;

create or replace function public._gen_code()
returns text language plpgsql as $$
declare c text := '';
begin
  for i in 1..5 loop
    c := c || chr(65 + floor(random() * 26)::int);
  end loop;
  return c;
end $$;

-- ---------- create / join / start ----------
create or replace function public.create_room(p_nickname text)
returns text language plpgsql security definer as $$
declare
  v_code text;
  v_room_id uuid;
  v_player_id uuid;
  v_nick text := trim(both from coalesce(p_nickname, ''));
  v_tries int := 0;
begin
  if char_length(v_nick) < 1 or char_length(v_nick) > 20 then
    raise exception 'Nickname must be 1-20 characters';
  end if;
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  loop
    v_code := public._gen_code();
    begin
      insert into public.rooms (code, phase) values (v_code, 'lobby') returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 10 then raise exception 'Could not generate room code'; end if;
    end;
  end loop;

  insert into public.players (room_id, user_id, nickname)
  values (v_room_id, auth.uid(), v_nick) returning id into v_player_id;
  update public.rooms set host_id = v_player_id where id = v_room_id;
  return v_code;
end $$;

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
  if v_room.phase <> 'lobby' then raise exception 'Game already started'; end if;

  -- Rejoin with same session: just update nickname.
  select id into v_existing from public.players where room_id = v_room.id and user_id = auth.uid();
  if found then
    update public.players set nickname = v_nick where id = v_existing;
    return;
  end if;

  select count(*) into v_count from public.players where room_id = v_room.id;
  if v_count >= 8 then raise exception 'Room is full (8 max)'; end if;

  -- Auto-suffix duplicate nicknames: Robb, Robb2, Robb3…
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

create or replace function public.start_game(p_room_id uuid)
returns void language plpgsql security definer as $$
declare v_count int; v_phase text;
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can start'; end if;
  select phase into v_phase from public.rooms where id = p_room_id;
  if v_phase <> 'lobby' then raise exception 'Game already started'; end if;
  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 3 then raise exception 'Need at least 3 players'; end if;

  -- Fresh state (supports play-again-then-start).
  delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.rounds where room_id = p_room_id;
  delete from public.secret_prompts where room_id = p_room_id;
  update public.players set score = 0 where room_id = p_room_id;
  update public.rooms set phase = 'prompts', current_round = 0 where id = p_room_id;
end $$;

-- ---------- prompts + shuffle ----------
create or replace function public.submit_prompt(p_room_id uuid, p_text text)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_phase text;
  v_text text := trim(both from coalesce(p_text, ''));
  v_nplayers int;
  v_nprompts int;
  v_order uuid[];
  v_texts text[];
  v_i int;
  v_author uuid;
  v_picker uuid;
  v_round_id uuid;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select phase into v_phase from public.rooms where id = p_room_id;
  if v_phase <> 'prompts' then raise exception 'Not in prompt phase'; end if;
  if char_length(v_text) < 1 or char_length(v_text) > 60 then
    raise exception 'Prompt must be 1-60 characters';
  end if;

  insert into public.secret_prompts (room_id, author_id, text)
  values (p_room_id, v_me, v_text)
  on conflict (room_id, author_id) do update set text = excluded.text;

  select count(*) into v_nplayers from public.players where room_id = p_room_id;
  select count(*) into v_nprompts from public.secret_prompts where room_id = p_room_id;

  -- All in: derangement shuffle — rotate shuffled player order by 1.
  if v_nprompts >= v_nplayers then
    select array_agg(id order by r) into v_order
    from (select id, random() as r from public.players where room_id = p_room_id) s;

    delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
    delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
    delete from public.rounds where room_id = p_room_id;

    for v_i in 1..array_length(v_order, 1) loop
      v_author := v_order[v_i];
      v_picker := v_order[(v_i % array_length(v_order, 1)) + 1];
      select text into v_text from public.secret_prompts where room_id = p_room_id and author_id = v_author;

      insert into public.rounds (room_id, order_idx, prompt_text, status)
      values (p_room_id, v_i - 1, v_text, 'open') returning id into v_round_id;
      insert into public.secret_picks (round_id, picker_id) values (v_round_id, v_picker);
    end loop;

    update public.rooms set phase = 'songs' where id = p_room_id;
  end if;
end $$;

-- Private: my assigned round (prompt text safe — author hidden).
create or replace function public.get_my_round(p_room_id uuid)
returns public.rounds language plpgsql stable security definer as $$
declare v_me uuid; v_rec public.rounds%rowtype;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select r.* into v_rec
  from public.rounds r
  join public.secret_picks s on s.round_id = r.id
  where r.room_id = p_room_id and s.picker_id = v_me
  order by r.order_idx limit 1;
  if not found then raise exception 'No assignment yet'; end if;
  return v_rec;
end $$;

-- ---------- songs ----------
create or replace function public.submit_song(
  p_round_id uuid, p_track_id text, p_title text, p_artist text,
  p_artwork_url text, p_preview_url text, p_clip_start int
)
returns void language plpgsql security definer as $$
declare
  v_room_id uuid; v_phase text; v_me uuid; v_picker uuid;
  v_nrounds int; v_ndone int;
begin
  select room_id into v_room_id from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  v_me := public._my_player_id(v_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select phase into v_phase from public.rooms where id = v_room_id;
  if v_phase <> 'songs' then raise exception 'Not in song phase'; end if;

  select picker_id into v_picker from public.secret_picks where round_id = p_round_id;
  if v_picker is distinct from v_me then raise exception 'Not your prompt'; end if;
  if p_clip_start < 0 or p_clip_start > 20 then raise exception 'Clip must be 0-20s'; end if;
  if coalesce(p_preview_url, '') = '' then raise exception 'Preview URL required'; end if;

  update public.rounds
  set track_id = p_track_id, title = p_title, artist = p_artist,
      artwork_url = p_artwork_url, preview_url = p_preview_url,
      clip_start = p_clip_start, status = 'locked'
  where id = p_round_id;

  select count(*), count(track_id) into v_nrounds, v_ndone
  from public.rounds where room_id = v_room_id;

  if v_ndone >= v_nrounds then
    update public.rounds set status = 'open' where room_id = v_room_id;
    update public.rooms set phase = 'guessing', current_round = 0 where id = v_room_id;
  end if;
end $$;

create or replace function public.is_picker(p_round_id uuid)
returns boolean language plpgsql stable security definer as $$
declare v_room_id uuid; v_me uuid; v_picker uuid;
begin
  select room_id into v_room_id from public.rounds where id = p_round_id;
  if not found then return false; end if;
  v_me := public._my_player_id(v_room_id);
  if v_me is null then return false; end if;
  select picker_id into v_picker from public.secret_picks where round_id = p_round_id;
  return v_picker = v_me;
end $$;

-- ---------- voting + reveal + scoring ----------
create or replace function public.submit_vote(p_round_id uuid, p_guessed_id uuid)
returns void language plpgsql security definer as $$
declare
  v_room_id uuid; v_phase text; v_expected int;
  v_me uuid; v_picker uuid; v_nplayers int; v_nvotes int;
begin
  select room_id into v_room_id from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  select phase, current_round into v_phase, v_expected from public.rooms where id = v_room_id;
  if v_phase <> 'guessing' then raise exception 'Not in guessing phase'; end if;

  v_me := public._my_player_id(v_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select picker_id into v_picker from public.secret_picks where round_id = p_round_id;
  if v_me = v_picker then raise exception 'Pickers cannot vote on their own song'; end if;
  if p_guessed_id = v_me then raise exception 'Cannot vote for yourself'; end if;
  if not exists (select 1 from public.players where id = p_guessed_id and room_id = v_room_id) then
    raise exception 'Invalid guess';
  end if;
  if exists (select picker_id from public.rounds where id = p_round_id and picker_id is not null) then
    raise exception 'Round already revealed';
  end if;

  insert into public.votes (round_id, voter_id, guessed_id)
  values (p_round_id, v_me, p_guessed_id)
  on conflict (round_id, voter_id) do update set guessed_id = excluded.guessed_id;

  select count(*) into v_nplayers from public.players where room_id = v_room_id;
  select count(*) into v_nvotes from public.votes where round_id = p_round_id;

  -- Auto-reveal when all eligible voters voted: +1 per correct guess.
  if v_nvotes >= v_nplayers - 1 then
    update public.rounds set picker_id = v_picker, status = 'revealed' where id = p_round_id;
    update public.players p set score = score + 1
    from public.votes v
    where v.round_id = p_round_id and v.voter_id = p.id and v.guessed_id = v_picker;
  end if;
end $$;

create or replace function public.next_round(p_room_id uuid)
returns void language plpgsql security definer as $$
declare
  v_phase text; v_cur int; v_total int; v_revealed boolean;
begin
  if public._my_player_id(p_room_id) is null then raise exception 'Not in this room'; end if;
  select phase, current_round into v_phase, v_cur from public.rooms where id = p_room_id;
  if v_phase <> 'guessing' then raise exception 'Not in guessing phase'; end if;
  select count(*) into v_total from public.rounds where room_id = p_room_id;
  select (picker_id is not null) into v_revealed
  from public.rounds where room_id = p_room_id order by order_idx limit 1 offset v_cur;
  if coalesce(v_revealed, false) = false then raise exception 'Reveal the current round first'; end if;

  if v_cur + 1 >= v_total then
    update public.rooms set phase = 'results' where id = p_room_id;
  else
    update public.rooms set current_round = v_cur + 1 where id = p_room_id;
  end if;
end $$;

create or replace function public.restart_game(p_room_id uuid)
returns void language plpgsql security definer as $$
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can restart'; end if;
  delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.rounds where room_id = p_room_id;
  delete from public.secret_prompts where room_id = p_room_id;
  update public.players set score = 0 where room_id = p_room_id;
  update public.rooms set phase = 'lobby', current_round = 0 where id = p_room_id;
end $$;

-- Permissions
grant execute on function public._gen_code() to authenticated;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.submit_prompt(uuid, text) to authenticated;
grant execute on function public.get_my_round(uuid) to authenticated;
grant execute on function public.submit_song(uuid, text, text, text, text, text, int) to authenticated;
grant execute on function public.is_picker(uuid) to authenticated;
grant execute on function public.submit_vote(uuid, uuid) to authenticated;
grant execute on function public.next_round(uuid) to authenticated;
grant execute on function public.restart_game(uuid) to authenticated;
