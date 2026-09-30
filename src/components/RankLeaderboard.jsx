import { ArrowRight, Crown, Hourglass, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Avatar from './Avatar.jsx'
import Marquee from './Marquee.jsx'

function stripQuotes(s) {
  return String(s ?? '').replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim()
}

// Revealed leaderboard for one prompt group in rank mode:
// Borda points + 1st-place counts per song and per player.
export default function RankLeaderboard({ room, group, players, rankings, isHost, isLast }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const N = group.length
  const groupIds = useMemo(() => new Set(group.map((r) => r.id)), [group])

  const { board, songStats } = useMemo(() => {
    const pts = new Map(players.map((p) => [p.id, { player: p, points: 0, firsts: 0 }]))
    const stats = new Map(group.map((r) => [r.id, { points: 0, firsts: 0, top: [] }]))
    for (const rk of rankings) {
      if (!groupIds.has(rk.round_id)) continue
      const round = group.find((r) => r.id === rk.round_id)
      const pickerId = round?.picker_id
      if (!pickerId) continue
      const gain = N - rk.rank
      const cell = pts.get(pickerId)
      if (cell) {
        cell.points += gain
        if (rk.rank === 1) cell.firsts += 1
      }
      const st = stats.get(rk.round_id)
      if (st) {
        st.points += gain
        if (rk.rank === 1) {
          st.firsts += 1
          const ranker = players.find((p) => p.id === rk.ranker_id)
          if (ranker) st.top.push(ranker.nickname)
        }
      }
    }
    const board = [...pts.values()].sort(
      (a, b) => b.points - a.points || b.firsts - a.firsts || b.player.score - a.player.score
    )
    return { board, songStats: stats }
  }, [players, rankings, group, groupIds, N])

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
        <h3 className="font-display text-balance text-xl font-black leading-tight sm:text-2xl">
          Prompt {room.current_prompt + 1} results
        </h3>
        <p className="max-w-full break-words text-balance text-sm text-zinc-400">“{stripQuotes(group[0]?.prompt_text)}”</p>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-violet-300">Ranked · Borda scoring</p>
      </div>

      <ul className="grid min-w-0 gap-2.5">
        {group.map((r) => {
          const picker = players.find((p) => p.id === r.picker_id)
          const st = songStats.get(r.id) ?? { points: 0, firsts: 0, top: [] }
          return (
            <li
              key={r.id}
              className="flex min-w-0 items-start gap-3 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.04] p-3 sm:items-center sm:p-4"
            >
              {r.artwork_url ? (
                <img src={r.artwork_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl object-cover sm:h-14 sm:w-14" />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-600/20 sm:h-14 sm:w-14">
                  <Play className="h-5 w-5 text-violet-300" />
                </span>
              )}
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Marquee label={`${r.title} — ${r.artist}`} className="text-sm font-bold leading-snug">
                  {r.title} <span className="font-normal text-zinc-500">— {r.artist}</span>
                </Marquee>
                <p className="text-xs text-zinc-500">
                  Picked by <span className="font-bold text-zinc-100">{picker?.nickname ?? '?'}</span>
                  {' · '}
                  <span className="font-bold text-emerald-300">+{st.points} pts</span>
                  {' · '}
                  <span className="text-zinc-400">{st.firsts} 1st{st.firsts === 1 ? '' : 's'}</span>
                </p>
                {st.top.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-amber-300/80">1st from</span>
                    {st.top.map((name) => (
                      <span
                        key={name}
                        className="inline-flex max-w-[10rem] items-center truncate rounded-full bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-200 ring-1 ring-inset ring-amber-400/30"
                        title={name}
                      >
                        <span className="truncate">{name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <ol className="grid min-w-0 gap-1.5">
        {board.map(({ player, points, firsts }, i) => (
          <li key={player.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-black/30 px-3 py-2.5 text-sm sm:px-4">
            <span className="w-5 shrink-0 text-center font-black tabular-nums text-zinc-600">{i + 1}</span>
            <Avatar name={player.nickname} size="sm" />
            <span className="min-w-0 flex-1 basis-24 truncate font-semibold">{player.nickname}</span>
            {i === 0 && points > 0 && <Crown className="h-4 w-4 shrink-0 text-amber-300" />}
            <span className="ml-auto flex shrink-0 items-baseline gap-1.5 font-mono text-xs">
              <span className="font-bold tabular-nums text-emerald-300">+{points}</span>
              <span className="text-zinc-500">{firsts} 1st{firsts === 1 ? '' : 's'}</span>
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
