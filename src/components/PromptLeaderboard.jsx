import { ArrowRight, Crown, Hourglass, Trophy } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Avatar from './Avatar.jsx'
import Marquee from './Marquee.jsx'

// Revealed leaderboard for one prompt group: who picked what, who guessed right.
export default function PromptLeaderboard({ room, group, players, votes, isHost, isLast }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const groupIds = new Set(group.map((r) => r.id))

  const points = players
    .map((p) => ({
      player: p,
      correct: votes.filter(
        (v) =>
          groupIds.has(v.round_id) &&
          v.voter_id === p.id &&
          v.guessed_id === group.find((r) => r.id === v.round_id)?.picker_id
      ).length,
    }))
    .sort((a, b) => b.correct - a.correct || b.player.score - a.player.score)

  async function next() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('next_prompt', { p_room_id: room.id })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="grid w-full min-w-0 gap-4 overflow-hidden">
      <div className="grid min-w-0 justify-items-center gap-1.5 px-1 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-inset ring-amber-400/20">
          <Trophy className="h-5 w-5 text-amber-300" />
        </span>
        <h3 className="font-display text-balance text-xl font-black leading-tight sm:text-2xl">
          Prompt {room.current_prompt + 1} results
        </h3>
        <p className="max-w-full break-words text-balance text-sm text-zinc-400">“{group[0]?.prompt_text}”</p>
      </div>

      <ul className="grid min-w-0 gap-2.5">
        {group.map((r) => {
          const picker = players.find((p) => p.id === r.picker_id)
          const correctVoters = votes.filter((v) => v.round_id === r.id && v.guessed_id === r.picker_id)
          const guessNames = correctVoters.map((v) => players.find((p) => p.id === v.voter_id)?.nickname ?? '?')
          return (
            <li
              key={r.id}
              className="flex min-w-0 items-start gap-3 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.04] p-3 sm:items-center sm:p-4"
            >
              {r.artwork_url ? (
                <img
                  src={r.artwork_url}
                  alt=""
                  loading="lazy"
                  className="h-12 w-12 shrink-0 rounded-xl object-cover sm:h-14 sm:w-14"
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-600/20 sm:h-14 sm:w-14">
                  <Trophy className="h-5 w-5 text-violet-300" />
                </span>
              )}
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Marquee label={`${r.title} — ${r.artist}`} className="text-sm font-bold leading-snug">
                  {r.title} <span className="font-normal text-zinc-500">— {r.artist}</span>
                </Marquee>
                <p className="text-xs text-zinc-500">
                  Picked by <span className="font-bold text-zinc-100">{picker?.nickname ?? '?'}</span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {guessNames.length > 0 ? (
                    <>
                      <span className="text-[11px] font-medium uppercase tracking-wider text-emerald-300/80">
                        Guessed by
                      </span>
                      {guessNames.map((name) => (
                        <span
                          key={name}
                          className="inline-flex max-w-[10rem] items-center truncate rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-200 ring-1 ring-inset ring-emerald-400/30"
                          title={name}
                        >
                          <span className="truncate">{name}</span>
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-400 ring-1 ring-inset ring-white/10">
                      Fooled everyone
                    </span>
                  )}
                </div>
              </div>
              <span className="shrink-0 self-start rounded-full bg-emerald-400/10 px-2 py-1 font-mono text-xs font-bold tabular-nums text-emerald-300 ring-1 ring-inset ring-emerald-400/20 sm:self-center">
                +{correctVoters.length}
              </span>
            </li>
          )
        })}
      </ul>

      <ol className="grid min-w-0 gap-1.5">
        {points.map(({ player, correct }, i) => (
          <li
            key={player.id}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-black/30 px-3 py-2.5 text-sm sm:px-4"
          >
            <span className="w-5 shrink-0 text-center font-black tabular-nums text-zinc-600">{i + 1}</span>
            <Avatar name={player.nickname} size="sm" />
            <span className="min-w-0 flex-1 basis-24 truncate font-semibold">{player.nickname}</span>
            {i === 0 && correct > 0 && <Crown className="h-4 w-4 shrink-0 text-amber-300" />}
            <span className="ml-auto flex shrink-0 items-baseline gap-1.5 font-mono text-xs">
              <span className="font-bold tabular-nums text-emerald-300">+{correct}</span>
              <span className="text-zinc-500">this prompt</span>
              <span className="text-zinc-600">·</span>
              <span className="tabular-nums text-zinc-400">{player.score} total</span>
            </span>
          </li>
        ))}
      </ol>

      {isHost ? (
        <>
          <button onClick={next} disabled={busy} className="btn-primary flex items-center justify-center gap-2 rounded-full py-3.5 font-bold disabled:opacity-50">
            {busy ? 'Moving…' : isLast ? 'See final results' : 'Next prompt'} <ArrowRight className="h-4 w-4" />
          </button>
          {error && <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{error}</p>}
        </>
      ) : (
        <div className="glass grid justify-items-center gap-1.5 rounded-3xl p-4 text-center">
          <Hourglass className="animate-hourglass h-5 w-5 text-amber-300" />
          <p className="text-sm font-bold">Waiting for the host…</p>
          <p className="text-xs text-zinc-500">The host moves us to the next prompt.</p>
        </div>
      )}
    </div>
  )
}
