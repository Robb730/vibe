import { ArrowRight, ChevronDown, ChevronUp, Crown, GripVertical, Hourglass, Loader2, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Avatar from '../components/Avatar.jsx'
import Marquee from '../components/Marquee.jsx'

const RANK_WINDOW_MS = 60_000

function loadMine(roomId) {
  try {
    return JSON.parse(localStorage.getItem(`vibe-mine-${roomId}`) ?? '[]')
  } catch {
    return []
  }
}

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function shuffleFor(ids, seed) {
  const arr = [...ids]
  let h = hashStr(seed)
  const rnd = () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) >>> 0)
    h = (Math.imul(h ^ (h >>> 13), 3266489917) >>> 0)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `0:${String(s).padStart(2, '0')}`
}

function useNow(step = 250) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), step)
    return () => clearInterval(t)
  }, [step])
  return now
}

// ---------- rank reveal (Borda pts + 1sts) ----------
function RankReveal({ room, group, players, rankings, isHost, isLast }) {
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
        <p className="max-w-full break-words text-balance text-sm text-zinc-400">“{group[0]?.prompt_text}”</p>
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

// ---------- main phase ----------
export default function Ranking({ room, players, rounds, rankings, me }) {
  const promptOrd = room.current_prompt ?? 0
  const now = useNow(250)
  const audioRef = useRef(null)
  const pauseTimer = useRef(null)
  const finalizedRef = useRef(false)
  const dragIdx = useRef(null)

  const [mineIds, setMineIds] = useState(() => new Set(loadMine(room.id)))
  const [order, setOrder] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const group = useMemo(
    () => rounds.filter((r) => (r.prompt_ord ?? 0) === promptOrd).sort((a, b) => a.order_idx - b.order_idx),
    [rounds, promptOrd]
  )
  const promptCount = useMemo(() => new Set(rounds.map((r) => r.prompt_ord ?? 0)).size, [rounds])
  const revealed = group.length > 0 && group.every((r) => r.picker_id)
  const isHost = me && me.id === room.host_id

  // Resolve my own slots (hidden from ranking): local record + is_picker RPC.
  useEffect(() => {
    let live = true
    const known = new Set(loadMine(room.id))
    Promise.all(
      group.map((r) =>
        supabase.rpc('is_picker', { p_round_id: r.id }).then(({ data }) => (data === true ? r.id : null)).catch(() => null)
      )
    ).then((ids) => {
      if (!live) return
      for (const id of ids) if (id) known.add(id)
      setMineIds(known)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, promptOrd, group.length])

  const others = useMemo(() => group.filter((r) => !mineIds.has(r.id)), [group, mineIds])

  // Per-viewer shuffled start order (stable per prompt + player).
  useEffect(() => {
    if (others.length === 0) return
    setOrder((prev) => {
      const ids = others.map((r) => r.id)
      const sameSet = prev.length === ids.length && prev.every((id) => ids.includes(id))
      if (sameSet) return prev
      return shuffleFor(ids, `${me?.id ?? 'anon'}-${promptOrd}`)
    })
  }, [others, me?.id, promptOrd])

  const myRankings = useMemo(
    () => (me ? rankings.filter((rk) => rk.ranker_id === me.id && group.some((r) => r.id === rk.round_id)) : []),
    [rankings, me, group]
  )
  const submitted = myRankings.length >= Math.max(0, group.length - 1) && group.length > 0
  const submittedCount = useMemo(() => {
    const s = new Set(
      rankings.filter((rk) => group.some((r) => r.id === rk.round_id)).map((rk) => rk.ranker_id)
    )
    return s.size
  }, [rankings, group])

  // Listening windows: staggered 15s deadlines stamped by start_guessing.
  const deadlines = useMemo(
    () => group.map((r) => (r.vote_deadline ? new Date(r.vote_deadline).getTime() : 0)).sort((a, b) => a - b),
    [group]
  )
  const maxDeadline = deadlines.length ? deadlines[deadlines.length - 1] : 0
  const listening = maxDeadline > 0 && now < maxDeadline
  const listenIdx = listening ? deadlines.findIndex((d) => now < d) : group.length
  const rankDeadline = maxDeadline > 0 ? maxDeadline + RANK_WINDOW_MS : 0
  const rankLeft = rankDeadline > 0 ? rankDeadline - now : null

  // Synced clip playback during listening.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !listening) {
      el?.pause()
      return undefined
    }
    const song = group[Math.max(0, listenIdx)]
    if (!song?.preview_url) return undefined
    el.src = song.preview_url
    el.currentTime = song.clip_start ?? 0
    try {
      const pr = el.play()
      if (pr && typeof pr.catch === 'function') pr.catch(() => {})
    } catch {
      /* autoplay blocked: stay silent */
    }
    clearTimeout(pauseTimer.current)
    pauseTimer.current = setTimeout(() => el.pause(), 10_000)
    return () => {
      clearTimeout(pauseTimer.current)
      el.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, listenIdx, promptOrd])

  // Deadline: anyone finalizes once (auto-completes AFK ballots + reveals).
  useEffect(() => {
    if (revealed || !rankDeadline || now < rankDeadline || finalizedRef.current) return
    finalizedRef.current = true
    supabase.rpc('finalize_rank_group', { p_room_id: room.id, p_prompt: promptOrd }).then(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, rankDeadline, revealed, promptOrd])

  useEffect(() => {
    finalizedRef.current = false
  }, [promptOrd])

  function move(id, dir) {
    setOrder((prev) => {
      const i = prev.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function onGripDown(e, idx) {
    if (e.button !== undefined && e.button !== 0) return
    dragIdx.current = idx
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function onGripMove(e, idx) {
    if (dragIdx.current === null || dragIdx.current === idx) return
    const from = dragIdx.current
    setOrder((prev) => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(idx, 0, item)
      return next
    })
    dragIdx.current = idx
  }

  function onGripUp() {
    dragIdx.current = null
  }

  async function submit() {
    if (order.length === 0) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('submit_rankings', {
      p_room_id: room.id,
      p_prompt: promptOrd,
      p_ballot: order,
    })
    if (error) setError(error.message)
    setBusy(false)
  }

  if (group.length === 0) return <p className="py-10 text-center text-sm text-zinc-400">Loading prompt…</p>

  if (revealed) {
    return (
      <section className="mx-auto grid w-full min-w-0 max-w-lg gap-4 overflow-hidden lg:max-w-xl">
        <RankReveal
          room={room}
          group={group}
          players={players}
          rankings={rankings}
          isHost={isHost}
          isLast={promptOrd + 1 >= promptCount}
        />
      </section>
    )
  }

  const orderedSongs = order.map((id) => others.find((r) => r.id === id)).filter(Boolean)

  return (
    <section className="mx-auto grid w-full min-w-0 max-w-lg gap-4 overflow-hidden lg:max-w-xl">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="auto" />

      <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-violet-300">
        4 · Ranking — prompt {promptOrd + 1} of {promptCount}
      </p>
      <h3 className="font-display px-2 text-center text-xl font-black text-balance sm:text-2xl">“{group[0]?.prompt_text}”</h3>

      {listening ? (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="text-zinc-400">Listening together… song {Math.min(listenIdx + 1, group.length)}/{group.length}</span>
              <span className="text-zinc-300">{fmt(maxDeadline - now)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-[width] duration-300"
                style={{ width: `${maxDeadline ? Math.max(0, Math.min(100, ((maxDeadline - now) / (group.length * 15_000)) * 100)) : 0}%` }}
              />
            </div>
          </div>
          <ul className="grid min-w-0 gap-2">
            {group.map((r, i) => {
              const active = i === listenIdx
              const done = i < listenIdx
              return (
                <li
                  key={r.id}
                  className={`flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl p-3 ring-1 ring-inset transition-colors ${
                    active ? 'bg-violet-600/20 ring-violet-400/40' : done ? 'bg-white/[0.03] ring-white/[0.06]' : 'bg-white/[0.02] ring-white/[0.06] opacity-70'
                  }`}
                >
                  {r.artwork_url && (
                    <img src={r.artwork_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Marquee label={r.title} className="text-sm font-bold">{r.title}</Marquee>
                    <Marquee label={r.artist} className="text-xs text-zinc-500">{r.artist}</Marquee>
                  </div>
                  {active && <span className="eq-bar h-5 shrink-0" aria-hidden />}
                  {done && <span className="shrink-0 font-mono text-[11px] text-emerald-300">heard</span>}
                </li>
              )
            })}
          </ul>
          <p className="text-center text-xs text-zinc-500">Ranking opens when the last clip ends. Your song stays hidden.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className={(rankLeft ?? 0) < 10_000 ? 'font-bold text-red-300' : 'text-zinc-400'}>
                {(rankLeft ?? 0) <= 0 ? "Time's up!" : submitted ? 'Ballot locked in (tap Submit to change)' : 'Rank best fit first'}
              </span>
              <span className={(rankLeft ?? 0) < 10_000 ? 'font-bold text-red-300' : 'text-zinc-300'}>
                {rankLeft === null ? '…' : fmt(rankLeft)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  (rankLeft ?? 0) < 10_000 ? 'bg-gradient-to-r from-red-500 to-amber-400' : 'bg-gradient-to-r from-violet-400 to-fuchsia-400'
                }`}
                style={{ width: `${rankLeft === null ? 0 : Math.max(0, Math.min(100, (rankLeft / RANK_WINDOW_MS) * 100))}%` }}
              />
            </div>
          </div>

          {others.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">Finding your ballot…</p>
          ) : (
            <ol className="grid min-w-0 gap-2">
              {orderedSongs.map((r, i) => (
                <li
                  key={r.id}
                  onPointerMove={(e) => onGripMove(e, i)}
                  onPointerUp={onGripUp}
                  onPointerCancel={onGripUp}
                  className="flex min-w-0 items-center gap-2 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.04] p-2.5 sm:gap-3 sm:p-3"
                >
                  <span className="w-6 shrink-0 text-center font-mono text-xs font-bold tabular-nums text-zinc-400">{i + 1}</span>
                  {r.artwork_url && (
                    <img src={r.artwork_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Marquee label={r.title} className="text-sm font-bold leading-snug">{r.title}</Marquee>
                    <Marquee label={r.artist} className="text-xs text-zinc-500">{r.artist}</Marquee>
                  </div>
                  <button
                    onClick={() => {
                      const el = audioRef.current
                      if (!el || !r.preview_url) return
                      el.src = r.preview_url
                      el.currentTime = r.clip_start ?? 0
                      try {
                        const pr = el.play()
                        if (pr && typeof pr.catch === 'function') pr.catch(() => {})
                      } catch {
                        /* ignore */
                      }
                      clearTimeout(pauseTimer.current)
                      pauseTimer.current = setTimeout(() => el.pause(), 10_000)
                    }}
                    aria-label={`Replay ${r.title}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 transition active:scale-95 lg:hover:bg-white/15"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                  <span className="grid shrink-0 gap-0.5">
                    <button
                      onClick={() => move(r.id, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${r.title} up`}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition active:bg-white/10 disabled:opacity-30 lg:hover:bg-white/5 lg:hover:text-white"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(r.id, 1)}
                      disabled={i === orderedSongs.length - 1}
                      aria-label={`Move ${r.title} down`}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition active:bg-white/10 disabled:opacity-30 lg:hover:bg-white/5 lg:hover:text-white"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Drag to reorder ${r.title}`}
                    onPointerDown={(e) => onGripDown(e, i)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp') move(r.id, -1)
                      if (e.key === 'ArrowDown') move(r.id, 1)
                    }}
                    className="flex h-10 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-zinc-500 transition active:cursor-grabbing active:bg-white/10 lg:hover:bg-white/5 lg:hover:text-zinc-200"
                    style={{ touchAction: 'none' }}
                  >
                    <GripVertical className="h-5 w-5" />
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="grid gap-2">
            <button
              onClick={submit}
              disabled={busy || orderedSongs.length === 0}
              className="btn-primary flex items-center justify-center gap-2 rounded-full py-3.5 font-bold disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Submitting…' : submitted ? 'Update ballot' : 'Submit ballot'}
            </button>
            {error && <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{error}</p>}
            <p className="text-center text-xs tabular-nums text-zinc-500">
              {submittedCount}/{players.length} ballots in{submitted ? ' · yours is in' : ''} · your song is hidden
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
