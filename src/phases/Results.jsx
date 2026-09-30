import { Crown, Hourglass, Medal, Music, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Avatar from '../components/Avatar.jsx'
import Marquee from '../components/Marquee.jsx'
import { useCountUp } from '../hooks/useCountUp.js'

function stripQuotes(s) {
  return String(s ?? '').replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim()
}

function FinalScore({ score, start }) {
  const shown = useCountUp(score, 1100, start)
  return <span className="ml-auto shrink-0 font-mono text-sm tabular-nums">{shown} pts</span>
}

export default function Results({ room, players, rounds, votes, rankings = [], me }) {
  const ranked = [...players].sort((a, b) => b.score - a.score)
  const isRank = room.game_mode === 'rank'
  const isHost = me && me.id === room.host_id
  const [busy, setBusy] = useState(false)
  const [restartError, setRestartError] = useState(null)
  // Same reveal language as the per-prompt takeovers, as a one-shot
  // entrance (staggered rows + eased count-up). Reduced-motion renders final.
  const animate = useMemo(
    () => !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
    []
  )

  const groups = useMemo(() => {
    const map = new Map()
    for (const r of rounds) {
      const k = r.prompt_ord ?? 0
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(r)
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ord, songs]) => ({
        ord,
        prompt: songs[0]?.prompt_text ?? '',
        songs: songs.sort((a, b) => a.order_idx - b.order_idx),
      }))
  }, [rounds])

  async function playAgain() {
    setBusy(true)
    setRestartError(null)
    const { error } = await supabase.rpc('restart_game', { p_room_id: room.id })
    if (error) setRestartError(error.message)
    setBusy(false)
  }

  return (
    <section className="mx-auto grid w-full min-w-0 max-w-lg gap-5 overflow-hidden lg:max-w-2xl">
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-300">5 · Reveal</p>
        <h3 className="font-display mt-1 flex items-center justify-center gap-2 text-2xl font-black">
          <Trophy className="h-6 w-6 text-amber-300" /> Results
        </h3>
      </div>

      <ol className="grid gap-2">
        {ranked.map((p, i) => (
          <li
            key={p.id}
            className={`${animate ? 'reveal-row-in ' : ''}flex items-center gap-3 rounded-2xl border p-3 ${
              i === 0 ? 'border-amber-400/30 bg-amber-400/10' : 'border-white/5 bg-white/[0.04]'
            }`}
            style={animate ? { animationDelay: `${Math.min(i * 120, 600)}ms` } : undefined}
          >
            <span className="flex w-8 justify-center text-zinc-500">
              {i === 0 ? <Crown className={`${animate ? 'reveal-crown-pop ' : ''}h-5 w-5 text-amber-300`} /> : i === 1 || i === 2 ? <Medal className="h-5 w-5" /> : <span className="font-black">{i + 1}</span>}
            </span>
            <Avatar name={p.nickname} size="sm" />
            <span className="min-w-0 flex-1 truncate font-bold">{p.nickname}</span>
            <FinalScore score={p.score} start={animate} />
          </li>
        ))}
      </ol>

      {groups.map((g, gi) => (
        <div
          key={g.ord}
          className={`${animate ? 'reveal-row-in ' : ''}grid gap-2`}
          style={animate ? { animationDelay: `${Math.min(300 + gi * 150, 900)}ms` } : undefined}
        >
          <p className="mt-2 break-words px-1 text-xs font-bold uppercase tracking-[0.25em] text-violet-300">
            Prompt {g.ord + 1} · <span className="normal-case text-zinc-200">“{stripQuotes(g.prompt)}”</span>
          </p>
          {g.songs.map((r) => {
            const picker = players.find((p) => p.id === r.picker_id)
            if (isRank) {
              const N = g.songs.length
              const songRanks = rankings.filter((rk) => rk.round_id === r.id)
              const pts = songRanks.reduce((s, rk) => s + (N - rk.rank), 0)
              const firsts = songRanks.filter((rk) => rk.rank === 1)
              return (
                <div key={r.id} className="flex min-w-0 items-start gap-3 overflow-hidden rounded-3xl border border-white/5 bg-white/[0.03] p-3 sm:items-center sm:p-4">
                  {r.artwork_url
                    ? <img src={r.artwork_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-2xl object-cover sm:h-14 sm:w-14" />
                    : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-600/20 sm:h-14 sm:w-14"><Music className="h-6 w-6 text-violet-300" /></span>}
                  <div className="grid min-w-0 flex-1 gap-1.5 text-sm">
                    <Marquee label={`${r.title} — ${r.artist}`} className="font-bold leading-snug">
                      {r.title} <span className="font-normal text-zinc-500">— {r.artist}</span>
                    </Marquee>
                    <p className="text-xs text-zinc-500">
                      Picked by <span className="font-bold text-zinc-100">{picker?.nickname ?? '?'}</span>
                      {' · '}
                      <span className="font-bold text-emerald-300">+{pts} pts</span>
                      {' · '}
                      <span className="text-zinc-400">{firsts.length} 1st{firsts.length === 1 ? '' : 's'}</span>
                    </p>
                    {firsts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium uppercase tracking-wider text-amber-300/80">1st from</span>
                        {firsts.map((rk) => {
                          const name = players.find((p) => p.id === rk.ranker_id)?.nickname ?? '?'
                          return (
                            <span
                              key={rk.ranker_id}
                              className="inline-flex max-w-[10rem] items-center truncate rounded-full bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-200 ring-1 ring-inset ring-amber-400/30"
                              title={name}
                            >
                              <span className="truncate">{name}</span>
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            }
            const correct = votes.filter((v) => v.round_id === r.id && v.guessed_id === r.picker_id)
            const guessNames = correct.map((v) => players.find((p) => p.id === v.voter_id)?.nickname ?? '?')
            return (
              <div key={r.id} className="flex min-w-0 items-start gap-3 overflow-hidden rounded-3xl border border-white/5 bg-white/[0.03] p-3 sm:items-center sm:p-4">
                {r.artwork_url
                  ? <img src={r.artwork_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-2xl object-cover sm:h-14 sm:w-14" />
                  : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-600/20 sm:h-14 sm:w-14"><Music className="h-6 w-6 text-violet-300" /></span>}
                <div className="grid min-w-0 flex-1 gap-1.5 text-sm">
                  <Marquee label={`${r.title} — ${r.artist}`} className="font-bold leading-snug">
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
                  +{correct.length}
                </span>
              </div>
            )
          })}
        </div>
      ))}

      {isHost ? (
        <>
          <button onClick={playAgain} disabled={busy} className="btn-primary rounded-full py-3.5 font-bold disabled:opacity-50">
            {busy ? 'Restarting…' : 'Play again (same room) →'}
          </button>
          {restartError && <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{restartError}</p>}
        </>
      ) : (
        <div className="glass grid justify-items-center gap-1.5 rounded-3xl p-4 text-center">
          <Hourglass className="animate-hourglass h-5 w-5 text-amber-300" />
          <p className="text-sm font-bold">Waiting for the host…</p>
          <p className="text-xs text-zinc-500">Play again returns to the lobby — the host starts the next game.</p>
        </div>
      )}
    </section>
  )
}
