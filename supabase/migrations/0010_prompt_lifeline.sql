-- Vibe: one-time prompt lifeline drawn from past games.
-- Run AFTER 0009 in Supabase SQL editor.
-- IDEMPOTENT: guards + drops first (same style as 0004).
--
-- Rules:
-- - After 45s without submitting (client-side timer), a player may draw one
--   suggestion from prompts used in past games. The draw CONSUMES the
--   lifeline (used on generate), even if they never submit it.
-- - One use per player per room: the flag lives on players and is NEVER
--   reset by start_game / restart_game, so it survives play-again.
-- - Pool = past games only, no seeds. Empty bank => friendly NO_PAST_PROMPTS
--   error and the lifeline is NOT consumed.

-- ---------- stale-function cleanup ----------
drop function if exists public.draw_prompt_lifeline(uuid);
drop function if exists public.submit_prompt(uuid, text);

-- ---------- schema ----------
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'players' and column_name = 'used_prompt_lifeline'
  ) then
    alter table public.players add column used_prompt_lifeline boolean not null default false;
  end if;
end $$;

-- Persistent prompt archive. Rounds are wiped on every start/restart, so
-- past games would otherwise vanish. NO select policy => RPC-only,
-- same as secret_* (deliberately unpublished from realtime).
create table if not exists public.prompt_bank (
  id uuid primary key default gen_random_uuid(),
  text text unique not null check (char_length(text) between 1 and 60),
  use_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.prompt_bank enable row level security;

-- Backfill from whatever rounds are currently stored.
insert into public.prompt_bank (text)
select distinct prompt_text from public.rounds
on conflict (text) do nothing;

-- ---------- prompts: same as 0004 + archive to bank when all are in ----------
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

  -- All prompts in: archive to the bank first (rounds get wiped on the
  -- next start/restart), then build one song slot per (prompt, player).
  -- Prompt display order is shuffled; answer order is reshuffled per prompt.
  -- Duplicate texts stay as separate groups so the P x N math always holds.
  if v_nprompts >= v_nplayers then
    insert into public.prompt_bank (text)
    select distinct text from public.secret_prompts where room_id = p_room_id
    on conflict (text) do nothing;

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

-- ---------- lifeline: draw one past prompt, consume on generate ----------
create or replace function public.draw_prompt_lifeline(p_room_id uuid)
returns text language plpgsql security definer as $$
declare
  v_me uuid;
  v_phase text;
  v_used boolean;
  v_text text;
begin
  v_me := public._my_player_id(p_room_id);
  if v_me is null then raise exception 'Not in this room'; end if;
  select phase into v_phase from public.rooms where id = p_room_id;
  if v_phase <> 'prompts' then raise exception 'Not in prompt phase'; end if;
  if exists (select 1 from public.secret_prompts where room_id = p_room_id and author_id = v_me) then
    raise exception 'Already submitted';
  end if;
  select used_prompt_lifeline into v_used from public.players where id = v_me;
  if coalesce(v_used, false) then raise exception 'LIFELINE_USED'; end if;

  -- Random bank prompt, excluding ones already in play this game.
  -- Empty bank => error BEFORE claiming, so the lifeline is preserved.
  select b.text into v_text
  from public.prompt_bank b
  where not exists (
    select 1 from public.secret_prompts s
    where s.room_id = p_room_id and s.text = b.text
  )
  order by random() limit 1;
  if v_text is null then raise exception 'NO_PAST_PROMPTS'; end if;

  -- Atomic claim: double-taps / two tabs can't both succeed.
  update public.players set used_prompt_lifeline = true
  where id = v_me and used_prompt_lifeline = false;
  if not found then raise exception 'LIFELINE_USED'; end if;

  update public.prompt_bank set use_count = use_count + 1 where text = v_text;
  return v_text;
end $$;

-- ---------- permissions ----------
-- NOTE: start_game / restart_game intentionally never touch
-- players.used_prompt_lifeline (one use per room, survives play-again).
grant execute on function public.submit_prompt(uuid, text) to authenticated;
grant execute on function public.draw_prompt_lifeline(uuid) to authenticated;
