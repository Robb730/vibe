-- Vibe realtime: publish public game tables so postgres_changes actually fires.
-- Run ONCE in Supabase SQL editor (after 0001 + 0002).
-- Secret tables are deliberately NEVER published (anti-cheat: authorship must
-- stay RPC-only). If a statement errors with "already a member", ignore it —
-- that just means this migration was already applied.

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.rounds;
alter publication supabase_realtime add table public.votes;

-- Full row payloads on UPDATE/DELETE so clients always get usable data.
alter table public.rooms replica identity full;
alter table public.players replica identity full;
alter table public.rounds replica identity full;
alter table public.votes replica identity full;
