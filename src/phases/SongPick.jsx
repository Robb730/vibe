import { Headphones, Hourglass, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { trackToGameTrack } from '../lib/itunes.js'
import ClipPicker from '../components/ClipPicker.jsx'
import SongSearch from '../components/SongSearch.jsx'

const primaryBtn =
  'flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black transition active:scale-[0.98] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400'

const errorBox = 'rounded-xl bg-red-950/60 p-3 text-sm text-red-300'

function loadMine(roomId) {
  try {
    return JSON.parse(localStorage.getItem(`vibe-mine-${roomId}`) ?? '[]')
  } catch {
    return []
  }
}

function saveMine(roomId, id) {
  try {
    const key = `vibe-mine-${roomId}`
    const mine = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!mine.includes(id)) localStorage.setItem(key, JSON.stringify([...mine, id]))
    return [...new Set([...mine, id])]
  } catch {
    return [id]
  }
}

// One prompt slot: live search -> select -> clip -> lock.
function SlotAnswer({ slot, onLocked }) {
  const [selected, setSelected] = useState(null)
  const [clipStart, setClipStart] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    const t = trackToGameTrack(selected)
    const { error } = await supabase.rpc('submit_song', {
      p_round_id: slot.id,
      p_track_id: t.track_id,
      p_title: t.title,
      p_artist: t.artist,
      p_artwork_url: t.artwork_url,
      p_preview_url: t.preview_url,
      p_clip_start: clipStart,
    })
    if (error) setError(error.message)
    else onLocked(slot.id)
    setSubmitting(false)
  }

  return (
    <div className="grid gap-7">
      <div>
        <p className="font-display text-2xl font-black leading-snug sm:text-3xl">“{slot.prompt_text}”</p>
        <p className="mt-3 text-sm text-zinc-500">Pick the song that fits. Nobody sees who wrote it.</p>
      </div>

      {!selected ? (
        <SongSearch onSelect={setSelected} autoFocus />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-2xl bg-zinc-900 p-2.5 pr-2 ring-1 ring-inset ring-white/[0.06]">
            <img src={selected.artworkUrl60} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-zinc-800" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{selected.trackName}</p>
              <p className="truncate text-sm text-zinc-500">{selected.artistName}</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="h-10 shrink-0 rounded-full px-4 text-sm font-medium text-zinc-400 transition active:bg-white/10 lg:hover:bg-white/5 lg:hover:text-white"
            >
              Change
            </button>
          </div>
          <ClipPicker
            previewUrl={selected.previewUrl}
            clipStart={clipStart}
            setClipStart={setClipStart}
            onSubmit={submit}
            submitting={submitting}
          />
        </>
      )}
      {error && <p className={errorBox}>{error}</p>}
    </div>
  )
}

export default function SongPick({ room, players, rounds, me }) {
  const [pending, setPending] = useState([])
  const [answeredIds, setAnsweredIds] = useState(() => loadMine(room.id))
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)

  const fetchPending = useCallback(async () => {
    const { data } = await supabase.rpc('my_pending_songs', { p_room_id: room.id })
    if (Array.isArray(data)) setPending(data)
  }, [room.id])

  useEffect(() => {
    fetchPending()
  }, [fetchPending])

  const roundsById = useMemo(() => new Map(rounds.map((r) => [r.id, r])), [rounds])

  // My slots = answered (local record) + pending, sorted by prompt.
  const mySlots = useMemo(() => {
    const ids = [...new Set([...answeredIds, ...pending.map((p) => p.id)])]
    return ids
      .map((id) => pending.find((p) => p.id === id) ?? roundsById.get(id))
      .filter((s) => s && s.prompt_text)
      .sort((a, b) => (a.prompt_ord ?? 0) - (b.prompt_ord ?? 0))
  }, [answeredIds, pending, roundsById])

  const doneCount = mySlots.filter((s) => roundsById.get(s.id)?.track_id).length
  const current = mySlots.find((s) => !roundsById.get(s.id)?.track_id) ?? null

  const songsIn = rounds.filter((r) => r.track_id).length
  const songsDone = rounds.length > 0 && songsIn >= rounds.length
  const isHost = me && me.id === room.host_id

  function handleLocked(slotId) {
    setAnsweredIds(saveMine(room.id, slotId))
    fetchPending()
  }

  async function startGuessing() {
    setStarting(true)
    setStartError(null)
    const { error } = await supabase.rpc('start_guessing', { p_room_id: room.id })
    if (error) setStartError(error.message)
    setStarting(false)
  }

  // All my songs locked: progress / host gate.
  if (!current) {
    if (mySlots.length === 0) {
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="text-sm text-zinc-500">Shuffling prompts. Your songs are on the way.</p>
        </div>
      )
    }
    return (
      <div className="mx-auto grid max-w-sm gap-7 py-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 ring-1 ring-inset ring-white/[0.08]">
          <Headphones className="h-6 w-6 text-zinc-300" />
        </div>
        <div>
          <h3 className="font-display text-2xl font-black">Your songs are in</h3>
          <p className="mt-2 text-sm tabular-nums text-zinc-500">
            {songsIn} of {rounds.length} submitted by the room
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={rounds.length}
          aria-valuenow={songsIn}
          className="h-1 overflow-hidden rounded-full bg-zinc-800"
        >
          <div
            className="h-full rounded-full bg-violet-400 transition-all duration-500"
            style={{ width: `${rounds.length ? (songsIn / rounds.length) * 100 : 0}%` }}
          />
        </div>
        {songsDone ? (
          isHost ? (
            <div className="grid gap-3">
              <button onClick={startGuessing} disabled={starting} className={primaryBtn}>
                <Play className="h-4 w-4" fill="currentColor" /> {starting ? 'Starting…' : 'Start guessing'}
              </button>
              {startError && <p className={errorBox}>{startError}</p>}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Waiting for the host to start guessing.</p>
          )
          ) : (
            <div className="grid justify-items-center gap-2">
              <Hourglass className="animate-hourglass h-5 w-5 text-amber-300" />
              <p className="text-sm text-zinc-400">Waiting for the host to start guessing.</p>
            </div>
          )}
      </div>
    )
  }

  const stepIdx = mySlots.indexOf(current)

  return (
    <section className="mx-auto grid max-w-lg gap-8 lg:max-w-2xl">
      {/* Progress */}
      <div className="grid gap-3">
        <p className="text-sm font-medium tabular-nums text-zinc-400">
          Song {Math.min(doneCount + 1, mySlots.length)} of {mySlots.length}
        </p>
        <div className="flex gap-1.5" aria-hidden>
          {mySlots.map((s, i) => {
            const done = Boolean(roundsById.get(s.id)?.track_id)
            return (
              <span
                key={s.id}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  done ? 'bg-white' : i === stepIdx ? 'bg-violet-400' : 'bg-zinc-800'
                }`}
              />
            )
          })}
        </div>
      </div>

      <SlotAnswer key={current.id} slot={current} onLocked={handleLocked} />

      <p className="text-center text-xs tabular-nums text-zinc-600">
        {songsIn} of {rounds.length} songs in from {players.length} players
        {isHost ? ' · you start the guessing' : ''}
      </p>
    </section>
  )
}