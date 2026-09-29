import { EyeOff } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function PromptEntry({ room, players }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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
    </form>
  )
}
