import { Crown, Disc3, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Avatar from './Avatar.jsx'
import Marquee from './Marquee.jsx'
import PromptLeaderboard from './PromptLeaderboard.jsx'
import { useCountUp } from '../hooks/useCountUp.js'

const SUSPENSE_MS = 1800
const UNMASK_MS = 950
const TALLY_MS = 1500

function TallyRow({ player, correct, total, rank, start }) {
  const shown = useCountUp(correct, 1100, start)
  return (
    <li
      className="reveal-row-in flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-white/[0.04] px-3 py-2.5 text-sm ring-1 ring-inset ring-white/[0.06] sm:px-4"
      style={{ animationDelay: `${rank * 120}ms` }}
    >
      <span className="w-5 shrink-0 text-center font-semibold tabular-nums text-zinc-500">{rank + 1}</span>
      <Avatar name={player.nickname} size="sm" />
      <span className="min-w-0 flex-1 basis-24 truncate font-semibold">{player.nickname}</span>
      {rank === 0 && correct > 0 && <Crown className="reveal-crown-pop h-4 w-4 shrink-0 text-amber-300" />}
      <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-emerald-300">+{shown}</span>
        <span className="text-xs tabular-nums text-zinc-500">{total}pt</span>
      </span>
    </li>
  )
}

// Reveal: suspense -> song-by-song unmasking -> points tally -> leaderboard.
// Deterministic per client (same order, fixed delays), so all screens stay in
// sync with no coordination.
export default function RevealTakeover({ room, group, players, votes, isHost, isLast }) {
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  )
  const [phase, setPhase] = useState(reduced ? 'done' : 'suspense')
  const [unmasked, setUnmasked] = useState(0)

  const groupIds = useMemo(() => new Set(group.map((r) => r.id)), [group])
  const songData = useMemo(
    () =>
      group.map((r) => ({
        round: r,
        picker: players.find((p) => p.id === r.picker_id),
        correctVoters: votes.filter((v) => v.round_id === r.id && v.guessed_id === r.picker_id),
      })),
    [group, players, votes]
  )
  const points = useMemo(
    () =>
      players
        .map((p) => ({
          player: p,
          correct: votes.filter(
            (v) =>
              groupIds.has(v.round_id) &&
              v.voter_id === p.id &&
              v.guessed_id === group.find((r) => r.id === v.round_id)?.picker_id
          ).length,
        }))
        .sort((a, b) => b.correct - a.correct || b.player.score - a.player.score),
    [players, votes, groupIds, group]
  )

  // suspense -> unmasking
  useEffect(() => {
    if (phase !== 'suspense') return
    const t = setTimeout(() => {
      setPhase('unmask')
      setUnmasked(1)
    }, SUSPENSE_MS)
    return () => clearTimeout(t)
  }, [phase])

  // staggered unmasking -> tally
  useEffect(() => {
    if (phase !== 'unmask') return
    if (unmasked >= songData.length) {
      const t = setTimeout(() => setPhase('tally'), 500)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setUnmasked((n) => n + 1), UNMASK_MS)
    return () => clearTimeout(t)
  }, [phase, unmasked, songData.length])

  // tally -> done
  useEffect(() => {
    if (phase !== 'tally') return
    const t = setTimeout(() => setPhase('done'), TALLY_MS)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'done') {
    return (
      <PromptLeaderboard
        room={room}
        group={group}
        players={players}
        votes={votes}
        isHost={isHost}
        isLast={isLast}
      />
    )
  }

  return (
    // shrink-0 + w-full: never let a flex/grid parent squash the reveal.
    // Clipping lives on the background layer only, so content can't be cut off.
    <div className="relative isolate w-full shrink-0 rounded-3xl bg-zinc-950/70 ring-1 ring-inset ring-white/[0.08]">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl" aria-hidden>
        <div className="reveal-spotlight absolute inset-0" />
      </div>

      <div className="mx-auto flex min-h-[min(30rem,72dvh)] w-full max-w-lg flex-col gap-6 p-5 sm:p-8">
        <div className="grid gap-3 text-center">
          <p className="text-sm font-medium text-violet-300">Prompt {room.current_prompt + 1}</p>
          <h3 className="font-display text-balance text-2xl font-black leading-snug sm:text-3xl">
            “{group[0]?.prompt_text}”
          </h3>
        </div>

        {phase === 'suspense' && (
          <div className="my-auto grid justify-items-center gap-6 py-4 text-center">
            <div className="relative flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
              <span className="animate-pulse-ring absolute inset-0 rounded-full" aria-hidden />
              <span className="absolute inset-0 rounded-full bg-zinc-900 ring-1 ring-inset ring-white/10" aria-hidden />
              <Disc3 className="reveal-disc-spin relative h-14 w-14 text-violet-300 sm:h-16 sm:w-16" />
            </div>

            <div className="grid gap-1.5">
              <p className="font-display text-xl font-black">
                The votes are in<span className="reveal-dots" />
              </p>
              <p className="text-sm text-zinc-500">Unmasking who picked what</p>
            </div>

            <div className="flex h-6 items-end gap-1" aria-hidden>
              {[0, 0.15, 0.3, 0.1, 0.25].map((d, i) => (
                <span key={i} className="eq-bar h-full" style={{ animationDelay: `${d}s` }} />
              ))}
            </div>

            <div className="h-1 w-40 overflow-hidden rounded-full bg-zinc-800" aria-hidden>
              <div
                className="reveal-progress h-full rounded-full bg-violet-400"
                style={{ animationDuration: `${SUSPENSE_MS}ms` }}
              />
            </div>
          </div>
        )}

        {phase !== 'suspense' && (
          <ul className="grid min-w-0 gap-2.5">
            {songData.map(({ round: r, picker, correctVoters }, i) => {
              const shown = i < unmasked
              return (
                <li
                  key={r.id}
                  className={`flex min-w-0 items-start gap-3 overflow-hidden rounded-2xl p-3 ring-1 ring-inset transition-colors duration-500 sm:items-center ${
                    shown ? 'bg-white/[0.06] ring-violet-400/30' : 'bg-white/[0.02] ring-white/[0.06]'
                  }`}
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                    {r.artwork_url && (
                      <img
                        src={r.artwork_url}
                        alt=""
                        loading="lazy"
                        className={`h-full w-full object-cover transition-all duration-500 ${shown ? '' : 'blur-md saturate-0'}`}
                      />
                    )}
                    {!shown && <span className="reveal-shimmer absolute inset-0" aria-hidden />}
                  </div>

                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <Marquee label={r.title} className="text-sm font-semibold leading-snug">{r.title}</Marquee>
                    <Marquee label={r.artist} className="text-xs text-zinc-500">{r.artist}</Marquee>
                    {shown ? (
                      <div className="reveal-picker-in mt-1.5 grid gap-1.5">
                        <p className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
                          <Avatar name={picker?.nickname ?? '?'} size="sm" />
                          <span className="truncate">
                            Picked by <span className="font-bold text-zinc-100">{picker?.nickname ?? '?'}</span>
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {correctVoters.length > 0 ? (
                            <>
                              <span className="text-[11px] font-medium uppercase tracking-wider text-emerald-300/80">
                                Guessed by
                              </span>
                              {correctVoters.map((v) => {
                                const name = players.find((p) => p.id === v.voter_id)?.nickname ?? '?'
                                return (
                                  <span
                                    key={v.voter_id}
                                    className="inline-flex max-w-[10rem] items-center truncate rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-200 ring-1 ring-inset ring-emerald-400/30"
                                    title={name}
                                  >
                                    <span className="truncate">{name}</span>
                                  </span>
                                )
                              })}
                            </>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-400 ring-1 ring-inset ring-white/10">
                              Fooled everyone
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-xs tracking-[0.4em] text-zinc-600">? ? ?</p>
                    )}
                  </div>

                  {shown &&
                    (correctVoters.length > 0 ? (
                      <span className="reveal-stamp-in shrink-0 self-start rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-bold tabular-nums text-emerald-300 ring-1 ring-inset ring-emerald-400/30 sm:self-center">
                        +{correctVoters.length}
                      </span>
                    ) : (
                      <span className="reveal-stamp-in shrink-0 self-start rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 ring-1 ring-inset ring-white/10 sm:self-center">
                        +0
                      </span>
                    ))}
                </li>
              )
            })}
          </ul>
        )}

        {phase === 'tally' && (
          <ol className="grid gap-2">
            {points.map(({ player, correct }, i) => (
              <TallyRow key={player.id} player={player} correct={correct} total={player.score} rank={i} start />
            ))}
          </ol>
        )}

        <button
          onClick={() => setPhase('done')}
          className="mx-auto mt-auto flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-zinc-500 transition active:bg-white/10 lg:hover:bg-white/5 lg:hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
        >
          <SkipForward className="h-4 w-4" /> Skip reveal
        </button>
      </div>
    </div>
  )
}