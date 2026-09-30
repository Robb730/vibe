import { ChevronDown, ChevronUp, GripVertical, Loader2, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { playClip, stopClip } from '../lib/audio.js'
import Marquee from '../components/Marquee.jsx'
import RankRevealTakeover from '../components/RankRevealTakeover.jsx'

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

// ---------- main phase ----------
export default function Ranking({ room, players, rounds, rankings, me }) {
  const promptOrd = room.current_prompt ?? 0
  const now = useNow(250)
  const finalizedRef = useRef(false)
  // Active grip-drag session: pointer capture retargets every move/up event
  // to the grip itself, so ALL drag logic must live on the grip element.
  const dragSession = useRef(null)

  const [mineIds, setMineIds] = useState(() => new Set(loadMine(room.id)))
  const [order, setOrder] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  // Phone audio: iOS blocks play() without a prior user gesture, and seeks
  // before metadata fail on cellular. Track both so the UI can recover.
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [badClips, setBadClips] = useState(() => new Set())

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

  function markBroken(id) {
    setBadClips((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  function clipOpts(id) {
    return {
      onBlocked: () => setAudioBlocked(true),
      onBroken: () => markBroken(id),
      onPlaying: () => setAudioBlocked(false),
    }
  }

  function playCurrent(song) {
    if (!song?.preview_url || badClips.has(song.id)) return
    playClip(song, clipOpts(song.id))
  }

  // Synced clip playback during listening.
  useEffect(() => {
    if (!listening) {
      stopClip()
      return undefined
    }
    const song = group[Math.max(0, listenIdx)]
    if (!song?.preview_url || badClips.has(song.id)) return undefined
    playCurrent(song)
    return () => stopClip()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, listenIdx, promptOrd])

  // Stop any replay when leaving the phase.
  useEffect(() => () => stopClip(), [])

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

  function onGripDown(e, id, idx) {
    if (e.isPrimary === false) return
    if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return
    const row = e.currentTarget.closest('li')
    // Row height + list gap (gap-2 = 8px): converts pointer travel to rows.
    const rowH = (row?.offsetHeight ?? 68) + 8
    dragSession.current = { id, index: idx, startY: e.clientY, rowH }
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* older browsers: moves still fire on the grip while over it */
    }
    setDraggingId(id)
    e.preventDefault()
  }

  function onGripMove(e) {
    const s = dragSession.current
    if (!s || e.isPrimary === false) return
    const target = Math.max(0, Math.min(order.length - 1, s.index + Math.round((e.clientY - s.startY) / s.rowH)))
    if (target === s.index) return
    const from = s.index
    s.index = target
    setOrder((prev) => {
      if (prev[from] !== s.id) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function onGripUp(e) {
    if (e && e.isPrimary === false) return
    dragSession.current = null
    setDraggingId(null)
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
        <RankRevealTakeover
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
      <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-violet-300">
        4 · Ranking — prompt {promptOrd + 1} of {promptCount}
      </p>
      <h3 className="font-display px-2 text-center text-xl font-black text-balance sm:text-2xl">“{group[0]?.prompt_text}”</h3>

      {audioBlocked && (
        <p
          aria-live="polite"
          className="mx-auto w-fit rounded-full bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/30"
        >
          🔇 Tap anywhere for sound
        </p>
      )}

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
                  {(!r.preview_url || badClips.has(r.id)) ? (
                    <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 ring-1 ring-inset ring-white/10">
                      No preview
                    </span>
                  ) : (
                    <>
                      {active && <span className="eq-bar h-5 shrink-0" aria-hidden />}
                      {done && <span className="shrink-0 font-mono text-[11px] text-emerald-300">heard</span>}
                    </>
                  )}
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
            <ol className={`grid min-w-0 gap-2 ${draggingId ? 'select-none' : ''}`}>
              {orderedSongs.map((r, i) => (
                <li
                  key={r.id}
                  className={`flex min-w-0 items-center gap-2 overflow-hidden rounded-2xl border p-2.5 transition-colors sm:gap-3 sm:p-3 ${
                    draggingId === r.id
                      ? 'border-violet-400/60 bg-violet-600/15 ring-1 ring-inset ring-violet-400/40'
                      : 'border-white/5 bg-white/[0.04]'
                  }`}
                >
                  <span className="w-6 shrink-0 text-center font-mono text-xs font-bold tabular-nums text-zinc-400">{i + 1}</span>
                  {r.artwork_url && (
                    <img src={r.artwork_url} alt="" draggable={false} loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Marquee label={r.title} className="text-sm font-bold leading-snug">{r.title}</Marquee>
                    <Marquee label={r.artist} className="text-xs text-zinc-500">{r.artist}</Marquee>
                  </div>
                  {(!r.preview_url || badClips.has(r.id)) ? (
                    <span
                      title="No preview available for this song"
                      className="flex h-9 shrink-0 items-center rounded-full bg-white/5 px-2.5 text-[11px] font-semibold text-zinc-500 ring-1 ring-inset ring-white/10"
                    >
                      No preview
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        if (r.preview_url && !badClips.has(r.id)) playClip(r, clipOpts(r.id))
                      }}
                      aria-label={`Replay ${r.title}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 transition active:scale-95 lg:hover:bg-white/15"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                  )}
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
                    onPointerDown={(e) => onGripDown(e, r.id, i)}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={onGripUp}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp') move(r.id, -1)
                      if (e.key === 'ArrowDown') move(r.id, 1)
                    }}
                    className={`flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg transition active:cursor-grabbing active:bg-white/10 lg:hover:bg-white/5 lg:hover:text-zinc-200 ${
                      draggingId === r.id ? 'bg-violet-600/25 text-violet-100' : 'text-zinc-500'
                    }`}
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
