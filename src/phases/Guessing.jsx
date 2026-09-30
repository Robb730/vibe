import { EyeOff, Lock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Avatar from '../components/Avatar.jsx'
import RevealTakeover from '../components/RevealTakeover.jsx'

const VOTE_WINDOW_MS = 30_000
const FAST_FORWARD_MS = 3_000

// Synced 3-2-1 entry. entryAt = first song deadline - 30s vote window.
function CountdownEntry({ entryAt, promptText, promptOrd, promptCount }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])
  const n = Math.max(1, Math.min(3, Math.ceil(Math.max(0, entryAt - now) / 1000)))
  return (
    <section className="mx-auto grid max-w-md justify-items-center gap-3 py-10 text-center lg:max-w-xl">
      <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-violet-300">
        4 · Guessing — prompt {promptOrd + 1} of {promptCount}
      </p>
      <h3 className="font-display px-2 text-2xl font-black sm:text-3xl">“{promptText}”</h3>
      <p className="text-sm text-zinc-400">Get ready — everyone votes together</p>
      <div
        key={n}
        aria-live="assertive"
        className="countdown-pop font-display mt-2 flex h-28 w-28 items-center justify-center rounded-full bg-violet-600/20 text-6xl font-black text-white ring-2 ring-violet-400/50"
      >
        {n}
      </div>
    </section>
  )
}

function loadMine(roomId) {
  try {
    return JSON.parse(localStorage.getItem(`vibe-mine-${roomId}`) ?? '[]')
  } catch {
    return []
  }
}

function msLeft(deadline) {
  if (!deadline) return null
  return new Date(deadline).getTime() - Date.now()
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `0:${String(s).padStart(2, '0')}`
}

// Synced countdown bar driven by the server deadline.
function CountdownBar({ deadline }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  if (!deadline) {
    // No deadline yet (stale pre-timer game): never silently missing.
    return (
      <div className="grid gap-1">
        <p className="font-mono text-[11px] text-amber-300">Starting timer…</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-400/70" />
        </div>
      </div>
    )
  }
  const left = new Date(deadline).getTime() - now
  const frac = Math.max(0, Math.min(1, left / VOTE_WINDOW_MS))
  const urgent = left < 10_000
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between font-mono text-[11px]">
        <span className={urgent ? 'font-bold text-red-300' : 'text-zinc-400'}>
          {left <= 0 ? "Time's up!" : 'Voting closes in'}
        </span>
        <span className={urgent ? 'font-bold text-red-300' : 'text-zinc-300'}>{fmt(left)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${urgent ? 'bg-gradient-to-r from-red-500 to-amber-400' : 'bg-gradient-to-r from-violet-400 to-fuchsia-400'}`}
          style={{ width: `${frac * 100}%` }}
        />
      </div>
    </div>
  )
}

// One anonymous answer: synced countdown, vote, auto-advance (no manual next).
function SongVote({ song, players, votes, me, room, songPos, songTotal }) {
  const [guess, setGuess] = useState(null)
  const [isPicker, setIsPicker] = useState(() => loadMine(room.id).includes(song.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ffLeft, setFfLeft] = useState(null) // fast-forward 3s countdown
  const audioRef = useRef(null)
  const pauseTimer = useRef(null)
  const advancedRef = useRef(false)
  const stampedRef = useRef(false)
  const ffTimer = useRef(null)

  const songVotes = votes.filter((v) => v.round_id === song.id)
  const myVote = me ? songVotes.find((v) => v.voter_id === me.id) : null
  const locked = song.status !== 'open'

  useEffect(() => {
    supabase.rpc('is_picker', { p_round_id: song.id }).then(({ data }) => {
      if (data === true) setIsPicker(true)
    })
  }, [song.id])

  // Auto-play the clip when this song goes live. No tap-to-play UI in
  // voting by design; a blocked autoplay simply stays silent.
  function playClip() {
    const el = audioRef.current
    if (!el) return
    el.currentTime = song.clip_start ?? 0
    try {
      const pr = el.play()
      if (pr && typeof pr.catch === 'function') pr.catch(() => {})
    } catch {
      /* autoplay blocked: stay silent */
    }
    clearTimeout(pauseTimer.current)
    pauseTimer.current = setTimeout(() => el.pause(), 10_000)
  }

  useEffect(() => {
    playClip()
    const el = audioRef.current
    return () => {
      clearTimeout(pauseTimer.current)
      el?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, song.clip_start])

  function advance() {
    if (advancedRef.current) return
    advancedRef.current = true
    supabase.rpc('advance_song', { p_room_id: room.id }).then(() => {})
  }

  // Self-heal: song has no deadline (stale game) -> ask the server to stamp it.
  // advance_song backfills vote_deadline and returns; realtime delivers it.
  useEffect(() => {
    if (locked || song.vote_deadline || stampedRef.current) return
    stampedRef.current = true
    supabase.rpc('advance_song', { p_room_id: room.id }).then(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, song.vote_deadline, locked])

  // Expiry watcher: fire advance once when the server deadline passes.
  useEffect(() => {
    if (locked || !song.vote_deadline) return
    const left = msLeft(song.vote_deadline)
    if (left === null) return
    if (left <= 0) {
      advance()
      return
    }
    const t = setTimeout(advance, left + 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, song.vote_deadline, locked])

  // All-voted fast-forward: visible 3s countdown, then advance.
  useEffect(() => {
    if (!locked) {
      setFfLeft(null)
      return
    }
    setFfLeft(FAST_FORWARD_MS)
    const started = Date.now()
    ffTimer.current = setInterval(() => {
      const left = FAST_FORWARD_MS - (Date.now() - started)
      if (left <= 0) {
        clearInterval(ffTimer.current)
        advance()
      } else {
        setFfLeft(left)
      }
    }, 100)
    return () => clearInterval(ffTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, locked])

  async function vote(playerId) {
    setGuess(playerId)
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('submit_vote', {
      p_round_id: song.id,
      p_guessed_id: playerId,
    })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="grid gap-4">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={song.preview_url} preload="auto" />

      <div className="flex items-center justify-center gap-2">
        {Array.from({ length: songTotal }).map((_, i) => (
          <span
            key={i}
            className={`h-2 rounded-full transition-all ${i < songPos ? 'w-6 bg-emerald-400' : i === songPos ? 'w-6 bg-violet-400' : 'w-2 bg-white/15'}`}
          />
        ))}
        <span className="ml-2 font-mono text-[11px] text-zinc-500">{songPos + 1}/{songTotal}</span>
      </div>

      {!locked && <CountdownBar deadline={song.vote_deadline} />}

      <div className="rounded-3xl border border-violet-500/15 bg-gradient-to-b from-violet-950/50 to-black/40 p-4 text-center sm:p-5">
        <div className="mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-black/50 p-3 text-left">
          {song.artwork_url && <img src={song.artwork_url} alt="" className="h-12 w-12 shrink-0 rounded-xl" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{song.title}</p>
            <p className="truncate text-xs uppercase tracking-wider text-zinc-500">{song.artist}</p>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10" aria-hidden>
            <span className="eq-bar h-5" style={{ animationDelay: '0s' }} />
          </span>
        </div>
      </div>

      {locked ? (
        <div className="grid justify-items-center gap-2 rounded-3xl border border-emerald-500/20 bg-emerald-950/20 p-6 text-center">
          <Lock className="h-6 w-6 text-emerald-300" />
          <p className="font-bold">
            {ffLeft !== null ? `Everyone's in! Next song in ${Math.ceil(ffLeft / 1000)}…` : 'Vote locked — picker stays hidden'}
          </p>
          <p className="text-sm text-zinc-400">Reveals land once the whole prompt is voted.</p>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-[width] duration-100"
              style={{ width: `${ffLeft !== null ? (ffLeft / FAST_FORWARD_MS) * 100 : 100}%` }}
            />
          </div>
        </div>
      ) : isPicker ? (
        <div className="grid justify-items-center gap-2 rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-center">
          <EyeOff className="h-6 w-6 text-zinc-400" />
          <p className="font-bold">This is your song — sit tight</p>
          <p className="text-sm text-zinc-400">{songVotes.length}/{Math.max(0, players.length - 1)} votes in. No voting for yourself.</p>
        </div>
      ) : (
        <>
          <p className="text-center text-sm text-zinc-400">
            Who picked this? {myVote ? '· vote locked in (tap to change)' : `· ${songVotes.length} votes in`}
          </p>
          <div className="flex flex-wrap items-start justify-center gap-3 rounded-3xl border border-white/5 bg-black/30 p-4 sm:gap-4 sm:p-5">
            {players.filter((p) => p.id !== me?.id).map((p) => (
              <button
                key={p.id}
                onClick={() => vote(p.id)}
                disabled={busy}
                className={`grid min-h-[76px] w-[72px] justify-items-center gap-1.5 rounded-2xl p-2 transition active:scale-95 ${
                  (guess ?? myVote?.guessed_id) === p.id ? 'bg-violet-600/30 ring-2 ring-violet-400' : 'hover:bg-white/5'
                } disabled:opacity-50`}
              >
                <Avatar name={p.nickname} size="lg" />
                <span className="max-w-full truncate text-[11px] font-semibold">{p.nickname}</span>
              </button>
            ))}
          </div>
          {error && <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{error}</p>}
        </>
      )}
    </div>
  )
}

export default function Guessing({ room, players, rounds, votes, me }) {
  const promptOrd = room.current_prompt ?? 0
  const songPos = room.current_round ?? 0

  const group = useMemo(
    () => rounds.filter((r) => (r.prompt_ord ?? 0) === promptOrd).sort((a, b) => a.order_idx - b.order_idx),
    [rounds, promptOrd]
  )
  const promptCount = useMemo(() => new Set(rounds.map((r) => r.prompt_ord ?? 0)).size, [rounds])
  const revealed = group.length > 0 && group.every((r) => r.picker_id)
  const isHost = me && me.id === room.host_id

  // Synced entry: first song deadline - 30s window. Everyone counts down
  // together, then drops into voting with no tap needed.
  const firstDeadline = group[0]?.vote_deadline ? new Date(group[0].vote_deadline).getTime() : 0
  const entryAt = firstDeadline ? firstDeadline - VOTE_WINDOW_MS : 0
  const [entered, setEntered] = useState(() => Date.now() >= entryAt)
  useEffect(() => {
    setEntered(Date.now() >= entryAt)
    if (!entryAt || Date.now() >= entryAt) return
    const t = setTimeout(() => setEntered(true), entryAt - Date.now() + 150)
    return () => clearTimeout(t)
  }, [entryAt, promptOrd])

  const song = group[Math.min(songPos, Math.max(0, group.length - 1))]

  if (group.length === 0) return <p className="py-10 text-center text-sm text-zinc-400">Loading prompt…</p>

  if (revealed) {
    return (
      <section className="mx-auto grid max-w-lg gap-4 lg:max-w-xl">
        <RevealTakeover
          room={room}
          group={group}
          players={players}
          votes={votes}
          isHost={isHost}
          isLast={promptOrd + 1 >= promptCount}
        />
      </section>
    )
  }

  if (!entered) {
    return (
      <CountdownEntry
        entryAt={entryAt}
        promptText={group[0]?.prompt_text}
        promptOrd={promptOrd}
        promptCount={promptCount}
      />
    )
  }

  return (
    <section className="mx-auto grid max-w-lg gap-4 lg:max-w-xl">
      <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-violet-300">
        4 · Guessing — prompt {promptOrd + 1} of {promptCount}
      </p>
      <h3 className="font-display px-2 text-center text-xl font-black sm:text-2xl">“{group[0]?.prompt_text}”</h3>
      {song && (
        <SongVote
          key={song.id}
          song={song}
          players={players}
          votes={votes}
          me={me}
          room={room}
          songPos={Math.min(songPos, group.length - 1)}
          songTotal={group.length}
        />
      )}
    </section>
  )
}
