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
    <div className="grid gap-4">
      <div className="grid justify-items-center gap-1 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/15">
          <Trophy className="h-5 w-5 text-amber-300" />
        </span>
        <h3 className="font-display text-xl font-black">Prompt {room.current_prompt + 1} results</h3>
        <p className="text-sm text-zinc-400">“{group[0]?.prompt_text}”</p>
      </div>

      <ul className="grid gap-2">
        {group.map((r) => {
          const picker = players.find((p) => p.id === r.picker_id)
          const correctVoters = votes.filter((v) => v.round_id === r.id && v.guessed_id === r.picker_id)
          return (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.04] p-3">
              {r.artwork_url && <img src={r.artwork_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl" />}
              <div className="min-w-0 flex-1 text-sm">
                <Marquee label={`${r.title} — ${r.artist}`} className="font-bold">
                  {r.title} <span className="font-normal text-zinc-500">— {r.artist}</span>
                </Marquee>
                <p className="truncate text-xs text-zinc-400">
                  Picked by <span className="font-bold text-zinc-200">{picker?.nickname ?? '?'}</span>
                  {' · '}
                  {correctVoters.length > 0
                    ? `sussed by ${correctVoters.map((v) => players.find((p) => p.id === v.voter_id)?.nickname ?? '?').join(', ')}`
                    : 'fooled everyone'}
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs text-emerald-300">+{correctVoters.length}</span>
            </li>
          )
        })}
      </ul>

      <ol className="grid gap-1.5">
        {points.map(({ player, correct }, i) => (
          <li key={player.id} className="flex items-center gap-3 rounded-2xl bg-black/30 px-4 py-2.5 text-sm">
            <span className="w-6 text-center font-black text-zinc-600">{i + 1}</span>
            <Avatar name={player.nickname} size="sm" />
            <span className="min-w-0 flex-1 truncate font-semibold">{player.nickname}</span>
            {i === 0 && correct > 0 && <Crown className="h-4 w-4 text-amber-300" />}
            <span className="ml-auto font-mono text-xs text-zinc-400">+{correct} this prompt · {player.score} total</span>
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
