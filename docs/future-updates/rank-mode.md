# Rank the Picks (game mode 2) — SPEC (draft, approved)

Status: built · OG mode ("Guess Who") stays default and untouched.

## Concept

Prompts + song answers work exactly like OG. Only the guessing phase
changes: instead of voting who picked each song, every player **ranks**
the other players' songs per prompt, best fit first. Own song is hidden
(no self-voting bias). Points use **Borda count**.

## Worked example (3 players, prompt "raining")

Hidden songs: Song R (Robb), Song H (Hensley), Song Y (Yukari).

- Robb sees H + Y, ranks H 1st, Y 2nd → Hensley +2, Yukari +1
- Hensley sees Y + R, ranks Y 1st, R 2nd → Yukari +2, Robb +1
- Yukari sees H + R, ranks H 1st, R 2nd → Hensley +2, Robb +1

Prompt totals: Hensley 4, Yukari 3, Robb 2 → Hensley wins the round.
Formula: rank r in a group of N songs earns the picker (N − r) pts.
Round tiebreak: more 1st places, then tied winners shown.
Points accumulate on `players.score`; final leaderboard = score.

## Flow per prompt group (synced for all players)

1. **Listening** — prompt + all songs shown; each 10s clip auto-plays
   one at a time (15s window per song), same for everyone.
2. **Ranking** — 60s timer; drag-to-reorder the songs (own hidden,
   order shuffled per viewer, replay button per row); Submit ballot.
3. **Reveal** — pickers named, per-prompt leaderboard (pts + 1sts),
   then next prompt. Missing ballots at deadline are auto-completed
   (leftover ranks in slot order) so one AFK player can't stall.
4. **Results** — same totals board; per-song lines show pts + 1sts
   instead of correct-guess counts.

## Mode picker (entry point)

Host clicks Start Game in lobby → modal with two cards:
`Guess Who (OG)` / `Rank the Picks` (+ one-line descs) → Confirm starts
the game in that mode. Choice is per game (play-again returns to lobby,
host picks again). Prompt lifeline (0010) works in both modes.

## DB (migration `0011_rank_mode.sql`)

- `rooms.game_mode` text `guess|rank`, default `guess` (auto-synced:
  rooms already in realtime publication).
- `rankings(round_id, ranker_id, rank 1..N−1)`,
  unique(round_id, ranker_id); open select like `votes`.
- `start_game(p_room_id, p_mode default 'guess')` (drop + recreate;
  default keeps old calls working); restart preserves nothing
  mode-related (fresh pick each lobby).
- `submit_vote` gains `game_mode='guess'` guard (anti-cross-mode).
- `submit_rankings(p_room_id, p_prompt, p_ballot jsonb)` — atomic full
  ballot; validates permutation 1..N−1 over exactly the other N−1
  slots, ranker ≠ picker; full house → lock + reveal + Borda score.
- `finalize_rank_group(...)` — anyone-callable, idempotent; after the
  rank deadline auto-completes missing ballots, reveals + scores.
- `start_guessing` / `next_prompt` stamp 15s listen windows on the
  group's rounds when mode = rank (reuses `vote_deadline`; rank closes
  at last window + 60s, derived client-side — no new timer columns).

## Frontend

- `Lobby.jsx`: Start → mode modal → `start_game` with `p_mode`.
- `Room.jsx`: `phase==='guessing'` renders `Ranking.jsx` when
  `game_mode==='rank'`; phase label + countdown copy branch.
- New `src/phases/Ranking.jsx`: Listening (synced step + progress) →
  Ranking (drag reorder, replay, 60s bar, submit, waiting state) →
  rank reveal (reuse-or-branch `RevealTakeover`).
- `Results.jsx`: branch per-song breakdown for rank mode.
- Drag: pointer-based with grip handle (`touch-action:none` on handle
  only so the list still scrolls), arrow-button fallback for a11y,
  `prefers-reduced-motion` respected. No new deps.
- `submit_vote` UI untouched; `Guessing.jsx` untouched.

## Verification

- 3-player room, rank mode: all hear songs together → all rank →
  reveal math matches hand-computed Borda → totals accumulate.
- AFK player: deadline auto-completes, group still reveals.
- OG regression: guess rooms play exactly as before; `submit_vote`
  in a rank room errors; lifeline still offered in prompts phase.
