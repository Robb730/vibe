import { Dices, EyeOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// One-time lifeline: offered 40s after the prompt screen mounts if the
// player still hasn't typed anything. Consumed on generate (server-side),
// one use per player per room — survives play-again via players.used_prompt_lifeline.
const LIFELINE_DELAY_MS = 40_000

export default function PromptEntry({ room, players, me }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [unlocked, setUnlocked] = useState(false)
  const [lifelineBusy, setLifelineBusy] = useState(false)
  const [lifelineClaimed, setLifelineClaimed] = useState(false)
  const [lifelineError, setLifelineError] = useState(null)

  const myRow = me ?? null
  const lifelineUsed = lifelineClaimed || myRow?.used_prompt_lifeline === true

  useEffect(() => {
    setUnlocked(false)
    if (done) return
    const t = setTimeout(() => setUnlocked(true), LIFELINE_DELAY_MS)
    return () => clearTimeout(t)
  }, [room.id, done])

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('submit_prompt', {
      p_room_id: room.id,
      p_text: text.trim().slice(0, 60),
    })
    if (error) setError(error.message)
    else setDone(true)
    setBusy(false)
  }

  async function drawLifeline() {
    setLifelineBusy(true)
    setLifelineError(null)
    const { data, error } = await supabase.rpc('draw_prompt_lifeline', {
      p_room_id: room.id,
    })
    if (error) {
      const msg = error.message ?? ''
      if (/NO_PAST_PROMPTS/.test(msg)) {
        setLifelineError("No past prompts yet — your group hasn't finished a game. Ask a friend for a nudge!")
      } else if (/LIFELINE_USED/.test(msg)) {
        setLifelineClaimed(true)
      } else if (/Already submitted/.test(msg)) {
        setDone(true)
      } else {
        setLifelineError(msg)
      }
    } else if (typeof data === 'string' && data) {
      setLifelineClaimed(true)
      setText(data.slice(0, 60))
    }
    setLifelineBusy(false)
  }

  const showLifeline = !done && unlocked && !lifelineUsed && !text.trim()

  if (done) {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
          <EyeOff className="h-7 w-7 text-emerald-300" />
        </div>
        <h3 className="font-display mt-4 text-2xl font-black">Locked in!</h3>
        <p className="mt-2 text-sm text-zinc-400">Waiting for {Math.max(0, players.length - 1)} other{players.length === 2 ? '' : 's'}… your prompt is anonymous.</p>
        <div className="mx-auto mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400" />
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-md gap-4 py-6">
      <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-violet-300">1 · Prompt entry</p>
      <h3 className="font-display text-center text-3xl font-black">Write a prompt</h3>
      <p className="text-center text-sm text-zinc-400">A few words — a moment, mood, or scene.<br />Anonymous — no one sees who wrote it.</p>
      <div className="glass rounded-3xl p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={60}
          placeholder="Type a few words…"
          autoFocus
          className="w-full rounded-2xl bg-black/40 px-5 py-4 text-lg outline-none placeholder:text-zinc-600 focus:ring-2 focus:ring-violet-500"
        />
      </div>
      <p className="text-right font-mono text-xs text-zinc-600">{text.length}/60</p>
      <button disabled={busy || !text.trim()} className="btn-primary rounded-full py-3.5 font-bold disabled:opacity-50">
        {busy ? 'Submitting…' : 'Submit prompt →'}
      </button>
      {error && <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{error}</p>}
      {showLifeline && (
        <div className="grid gap-2 rounded-3xl border border-amber-400/20 bg-amber-950/20 p-4 text-center">
          <p className="text-sm font-bold text-amber-200">Blanking out? Grab a lifeline</p>
          <p className="text-xs leading-relaxed text-zinc-400">A random prompt from your group&apos;s past games. One-time use — gone for the rest of this room, even on play-again.</p>
          <button
            type="button"
            onClick={drawLifeline}
            disabled={lifelineBusy}
            className="flex items-center justify-center gap-2 rounded-full bg-amber-400 py-3 text-sm font-bold text-black transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {lifelineBusy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Drawing…</>
            ) : (
              <><Dices className="h-4 w-4" /> Surprise me</>
            )}
          </button>
          {lifelineError && <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{lifelineError}</p>}
        </div>
      )}
      {!done && lifelineUsed && (
        <p className="text-center text-xs text-zinc-600">Prompt lifeline used (1 per room).</p>
      )}
    </form>
  )
}
