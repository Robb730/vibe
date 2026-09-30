import { Crown, Hourglass, Loader2, MessageSquare, Music, Play, Trophy, Users, Disc3 } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const STEPS = [
  { icon: MessageSquare, title: '1. Prompt Entry', desc: 'Everyone submits\na prompt (anonymous).' },
  { icon: Music, title: '2. Answer All', desc: 'Pick a song + 10s clip\nfor every prompt.' },
  { icon: Crown, title: '3. Host Starts', desc: 'Host kicks off\nguessing.' },
  { icon: Users, title: '4. Guessing', desc: 'Vote who picked\neach answer.' },
  { icon: Trophy, title: '5. Reveal', desc: 'See the results\nand earn points!' },
]

export default function Lobby({ room, players, me }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const canStart = players.length >= 3
  const isHost = me && me.id === room.host_id

  async function start() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('start_game', { p_room_id: room.id })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="relative overflow-hidden rounded-3xl">
      {/* sunset backdrop */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(109,91,255,0.5), transparent 70%), linear-gradient(180deg, rgba(20,10,40,0.2) 0%, rgba(10,5,25,0.85) 75%), url(https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=60&auto=format&fit=crop) center/cover',
        }}
      />
      <div className="relative px-6 pb-6 pt-10 text-center md:pt-14">
        <div className="animate-pulse-ring mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/70 vinyl-glow">
          <Disc3 className="h-8 w-8 text-violet-300" />
        </div>
        <h2 className="font-display mt-4 text-xl font-black md:text-2xl">
          {canStart ? (isHost ? 'Everyone’s here — start when ready' : 'Everyone’s here!') : 'Waiting for more players…'}
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          {canStart
            ? isHost
              ? 'You’re hosting — kick it off whenever you like.'
              : 'The host will start the game any moment.'
            : 'Start when you have at least 3 players.'}
        </p>
        {isHost ? (
          <>
            <button
              onClick={start}
              disabled={busy || !canStart}
              className={`mx-auto mt-6 flex w-full max-w-xs items-center justify-center gap-2 rounded-full py-3.5 font-bold ${
                canStart ? 'btn-primary' : 'cursor-not-allowed bg-white/10 text-zinc-500'
              } disabled:opacity-70`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {busy ? 'Starting' : 'Start Game'}
            </button>
            {error && <p className="mx-auto mt-3 max-w-xs rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{error}</p>}
          </>
        ) : (
          <div className="mx-auto mt-6 grid w-full max-w-xs justify-items-center gap-1.5 rounded-3xl border border-white/10 bg-black/40 p-5">
            <Hourglass className="animate-hourglass h-5 w-5 text-amber-300" />
            <p className="text-sm font-bold">Waiting for the host…</p>
            <p className="text-xs text-zinc-500">Only the host can start the game.</p>
          </div>
        )}

        <div className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-4 border-t border-white/10 pt-6 sm:grid-cols-3 md:grid-cols-5 lg:max-w-4xl">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative grid justify-items-center gap-1 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-600/25">
                <s.icon className="h-5 w-5 text-violet-200" />
              </span>
              <p className="mt-2 text-xs font-bold">{s.title}</p>
              <p className="whitespace-pre-line text-[11px] leading-snug text-zinc-500">{s.desc}</p>
              {i < STEPS.length - 1 && <span className="absolute right-[-12px] top-3 hidden text-zinc-700 md:block">〉</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
