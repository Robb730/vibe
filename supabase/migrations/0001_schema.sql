-- Vibe MVP schema — Song Prompt Guessing Game (GAME_SPEC.md §6-7)
-- Run in Supabase SQL editor. Enables Anonymous Auth separately in Dashboard.
-- IDEMPOTENT: safe to re-run. Drops project-owned objects first so stale
-- hand-created tables/functions (different constraints/return types) can't
-- linger behind CREATE ... IF NOT EXISTS / CREATE OR REPLACE.

-- Wipe project tables (cascades to policies depending on them).
drop table if exists public.votes, public.secret_picks, public.rounds,
  public.secret_prompts, public.players, public.rooms cascade;

-- Wipe possibly-stale functions (avoids 42P13 return-type errors).
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

-- Extensions
create extension if not exists "pgcrypto";

-- Rooms
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-Z]{5}$'),
  host_id uuid,
  phase text not null default 'lobby'
    check (phase in ('lobby','prompts','songs','guessing','results')),
  current_round int not null default 0,
  created_at timestamptz not null default now()
);

-- Players
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  nickname text not null check (char_length(nickname) between 1 and 20),
  score int not null default 0,
  joined_at timestamptz not null default now(),
  unique (room_id, user_id),
  unique (room_id, nickname)
);

-- Rounds (picker_id stays NULL until reveal — anti-cheat §4)
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  order_idx int not null,
  prompt_text text not null check (char_length(prompt_text) between 1 and 60),
  track_id text,
  title text,
  artist text,
  artwork_url text,
  preview_url text,
  clip_start int check (clip_start between 0 and 20),
  picker_id uuid references public.players(id),
  status text not null default 'open' check (status in ('open','locked','revealed')),
  unique (room_id, order_idx)
);

-- Votes
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  voter_id uuid not null references public.players(id) on delete cascade,
  guessed_id uuid not null references public.players(id),
  created_at timestamptz not null default now(),
  unique (round_id, voter_id),
  check (voter_id <> guessed_id)
);

-- Secret tables: NO select policy (RPC-only)
create table if not exists public.secret_prompts (
  room_id uuid not null references public.rooms(id) on delete cascade,
  author_id uuid not null references public.players(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 60),
  primary key (room_id, author_id)
);

create table if not exists public.secret_picks (
  round_id uuid primary key references public.rounds(id) on delete cascade,
  picker_id uuid not null references public.players(id) on delete cascade
);

-- RLS
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.votes enable row level security;
alter table public.secret_prompts enable row level security;
alter table public.secret_picks enable row level security;

-- Authenticated (incl. anon) members can read their room's public rows.
-- Membership check via players.user_id = auth.uid().
-- NOTE: refine with room-scoped policies before launch; open read is for MVP dev.
create policy "anon read rooms" on public.rooms for select to authenticated using (true);
create policy "anon read players" on public.players for select to authenticated using (true);
create policy "anon read rounds" on public.rounds for select to authenticated using (true);
-- Votes readable (guessed_id only meaningful after reveal; picker hidden till then)
create policy "anon read votes" on public.votes for select to authenticated using (true);
-- No policies on secret_* => no direct client access.

-- RPC stubs (full logic in next migration; these unblock frontend wiring)
create or replace function public.create_room(p_nickname text)
returns text language plpgsql security definer as $$
declare v_code text; v_room_id uuid; v_player_id uuid;
begin
  v_code := upper(substring(md5(random()::text) from 1 for 5));
  v_code := regexp_replace(v_code, '[^A-Z]', 'A', 'g');
  insert into public.rooms (code, phase) values (v_code, 'lobby') returning id into v_room_id;
  insert into public.players (room_id, user_id, nickname)
  values (v_room_id, auth.uid(), p_nickname) returning id into v_player_id;
  update public.rooms set host_id = v_player_id where id = v_room_id;
  return v_code;
end $$;

create or replace function public.join_room(p_code text, p_nickname text)
returns void language plpgsql security definer as $$
declare v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where code = upper(p_code);
  if not found then raise exception 'Room not found'; end if;
  if v_room.phase <> 'lobby' then raise exception 'Game already started'; end if;
  insert into public.players (room_id, user_id, nickname)
  values (v_room.id, auth.uid(), p_nickname);
end $$;

create or replace function public.start_game(p_room_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.rooms set phase = 'prompts' where id = p_room_id;
end $$;

create or replace function public.submit_prompt(p_room_id uuid, p_text text)
returns void language plpgsql security definer as $$
begin
  raise exception 'Not implemented yet (milestone 3)';
end $$;

create or replace function public.submit_song(p_round_id uuid, p_track_id text, p_title text, p_artist text, p_artwork_url text, p_preview_url text, p_clip_start int)
returns void language plpgsql security definer as $$
begin
  raise exception 'Not implemented yet (milestone 4)';
end $$;

create or replace function public.submit_vote(p_round_id uuid, p_guessed_id uuid)
returns void language plpgsql security definer as $$
begin
  raise exception 'Not implemented yet (milestone 5)';
end $$;

create or replace function public.next_round(p_room_id uuid)
returns void language plpgsql security definer as $$
begin
  raise exception 'Not implemented yet (milestone 5)';
end $$;

create or replace function public.restart_game(p_room_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.players set score = 0 where room_id = p_room_id;
  delete from public.rounds where room_id = p_room_id;
  update public.rooms set phase = 'lobby', current_round = 0 where id = p_room_id;
end $$;
