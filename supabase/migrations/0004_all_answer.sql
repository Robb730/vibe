-- Vibe milestone: everybody answers every prompt (P prompts x N players).
-- Run AFTER 0003 in Supabase SQL editor.
-- Resets in-flight games to lobby (new rounds shape can't read old games).

-- ---------- replaced-function cleanup ----------
drop function if exists public.submit_prompt(uuid, text);
drop function if exists public.get_my_round(uuid);
drop function if exists public.submit_song(uuid, text, text, text, text, text, int);
drop function if exists public.submit_vote(uuid, uuid);
drop function if exists public.next_round(uuid);
drop function if exists public.restart_game(uuid);
drop function if exists public.start_game(uuid);
drop function if exists public.my_pending_songs(uuid);
drop function if exists public.start_guessing(uuid);
drop function if exists public.next_prompt(uuid);

-- ---------- schema ----------
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'current_prompt'
  ) then
    alter table public.rooms add column current_prompt int not null default 0;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rounds' and column_name = 'prompt_ord'
  ) then
    alter table public.rounds add column prompt_ord int;
  end if;
end $$;

-- ---------- reset in-flight games (old 1-per-player shape is unreadable) ----------
delete from public.votes;
delete from public.secret_picks;
delete from public.rounds;
delete from public.secret_prompts;
update public.players set score = 0;
update public.rooms set phase = 'lobby', current_round = 0, current_prompt = 0;

-- ---------- start / restart (also reset current_prompt) ----------
create or replace function public.start_game(p_room_id uuid)
returns void language plpgsql security definer as $$
declare v_count int; v_phase text;
begin
  if not public._is_host(p_room_id) then raise exception 'Only the host can start'; end if;
  select phase into v_phase from public.rooms where id = p_room_id;
  if v_phase <> 'lobby' then raise exception 'Game already started'; end if;
  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 3 then raise exception 'Need at least 3 players'; end if;

  delete from public.votes where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.secret_picks where round_id in (select id from public.rounds where room_id = p_room_id);
  delete from public.rounds where room_id = p_room_id;
  delete from public.secret_prompts where room_id = p_room_id;
  update public.players set score = 0 where room_id = p_room_id;
  update public.rooms set phase = 'prompts', current_round = 0, current_prompt = 0 where id = p_room_id;
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
  update public.rooms set phase = 'lobby', current_round = 0, current_prompt = 0 where id = p_room_id;
end $$;

-- ---------- prompts: create P x N song slots ----------
create or replace function public.submit_prompt(p_room_id uuid, p_text text)
returns void language plpgsql security definer as $$
declare
  v_me uuid;
  v_phase text;
  v_text text := trim(both from coalesce(p_text, ''));
  v_nplayers int;
  v_nprompts int;
  v_prompt_texts text[];
  v_picker_order uuid[];
  v_pi int;
  v_si int;
  v_gidx int := 0;
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

  -- All prompts in: one song slot per (prompt, player). Prompt display order
  -- is shuffled; answer order is reshuffled per prompt. Duplicate texts stay
  -- as separate groups so the P x N math always holds.
  if v_nprompts >= v_nplayers then
    select array_agg(text order by r) into v_prompt_texts
    from (select text, random() as r from public.secret_prompts where room_id = p_room_id) s;

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
end $$;

-- ---------- songs ----------
-- My unanswered slots (prompt text safe — authorship stays hidden).
create or replace function public.my_pending_songs(p_room_id uuid)
returns table (id uuid, prompt_ord int, prompt_text text, order_idx int)
language plpgsql stable security definer as $$
declare v_me uuid;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  return query
    select r.id, r.prompt_ord, r.prompt_text, r.order_idx
    from public.rounds r
    join public.secret_picks s on s.round_id = r.id
    where r.room_id = p_room_id and s.picker_id = v_me and r.track_id is null
    order by r.prompt_ord;
end $$;

create or replace function public.submit_song(
  p_round_id uuid, p_track_id text, p_title text, p_artist text,
  p_artwork_url text, p_preview_url text, p_clip_start int
)
returns void language plpgsql security definer as $$
declare
  v_room_id uuid; v_phase text; v_me uuid; v_picker uuid;
begin
  select room_id into v_room_id from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  v_me := public._my_player_id(v_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select phase into v_phase from public.rooms where id = v_room_id;
  if v_phase <> 'songs' then raise exception 'Not in song phase'; end if;

  select picker_id into v_picker from public.secret_picks where round_id = p_round_id;
  if v_picker is distinct from v_me then raise exception 'Not your song slot'; end if;
  if p_clip_start < 0 or p_clip_start > 20 then raise exception 'Clip must be 0-20s'; end if;
  if coalesce(p_preview_url, '') = '' then raise exception 'Preview URL required'; end if;

  update public.rounds
  set track_id = p_track_id, title = p_title, artist = p_artist,
      artwork_url = p_artwork_url, preview_url = p_preview_url,
      clip_start = p_clip_start, status = 'open'
  where id = p_round_id;
  -- Phase stays 'songs' until the host calls start_guessing.
end $$;

-- Host moves songs -> guessing once every slot is filled.
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

  update public.rooms set phase = 'guessing', current_prompt = 0 where id = p_room_id;
end $$;

-- ---------- voting: lock per song, batch-reveal per prompt ----------
create or replace function public.submit_vote(p_round_id uuid, p_guessed_id uuid)
returns void language plpgsql security definer as $$
declare
  v_room_id uuid; v_phase text;
  v_me uuid; v_picker uuid; v_status text; v_prompt int;
  v_nplayers int; v_nvotes int; v_gsongs int; v_glocked int;
begin
  select room_id, status, prompt_ord into v_room_id, v_status, v_prompt
  from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  select phase into v_phase from public.rooms where id = v_room_id;
  if v_phase <> 'guessing' then raise exception 'Not in guessing phase'; end if;
  if v_status <> 'open' then raise exception 'Voting is closed for this song'; end if;

  v_me := public._my_player_id(v_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select picker_id into v_picker from public.secret_picks where round_id = p_round_id;
  if v_me = v_picker then raise exception 'Pickers cannot vote on their own song'; end if;
  if p_guessed_id = v_me then raise exception 'Cannot vote for yourself'; end if;
  if not exists (select 1 from public.players where id = p_guessed_id and room_id = v_room_id) then
    raise exception 'Invalid guess';
  end if;

  insert into public.votes (round_id, voter_id, guessed_id)
  values (p_round_id, v_me, p_guessed_id)
  on conflict (round_id, voter_id) do update set guessed_id = excluded.guessed_id;

  select count(*) into v_nplayers from public.players where room_id = v_room_id;
  select count(*) into v_nvotes from public.votes where round_id = p_round_id;

  -- Lock this song once every eligible voter has voted (no reveal yet).
  if v_nvotes >= v_nplayers - 1 then
    update public.rounds set status = 'locked' where id = p_round_id;
  end if;

  -- Whole prompt group voted: batch-reveal + score (+1 per correct guess).
  select count(*) into v_gsongs
  from public.rounds where room_id = v_room_id and prompt_ord = v_prompt;
  select count(*) into v_glocked
  from public.rounds where room_id = v_room_id and prompt_ord = v_prompt
    and status in ('locked', 'revealed');

  if v_glocked >= v_gsongs then
    update public.rounds r set picker_id = s.picker_id, status = 'revealed'
    from public.secret_picks s
    where s.round_id = r.id and r.room_id = v_room_id and r.prompt_ord = v_prompt;

    update public.players p set score = score + (
      select count(*)
      from public.votes v
      join public.secret_picks s on s.round_id = v.round_id
      where v.voter_id = p.id
        and v.guessed_id = s.picker_id
        and v.round_id in (
          select id from public.rounds
          where room_id = v_room_id and prompt_ord = v_prompt
        )
    )
    where p.room_id = v_room_id;
  end if;
end $$;

-- Host advances to the next prompt group (or results) after a reveal.
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
    update public.rooms set current_prompt = v_cur + 1 where id = p_room_id;
  end if;
end $$;

-- Permissions
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.restart_game(uuid) to authenticated;
grant execute on function public.submit_prompt(uuid, text) to authenticated;
grant execute on function public.my_pending_songs(uuid) to authenticated;
grant execute on function public.submit_song(uuid, text, text, text, text, text, int) to authenticated;
grant execute on function public.start_guessing(uuid) to authenticated;
grant execute on function public.submit_vote(uuid, uuid) to authenticated;
grant execute on function public.next_prompt(uuid) to authenticated;
