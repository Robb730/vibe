import { Check, Crown, Hourglass, ListOrdered, Loader2, MessageSquare, Music, Play, Search, Trophy, Users, Disc3 } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const MODES = [
  {
    id: 'guess',
    icon: Search,
    title: 'Guess Who (OG)',
    desc: 'Vote who picked each song. +1 per correct guess.',
  },
  {
    id: 'rank',
    icon: ListOrdered,
    title: 'Rank the Picks',
    desc: 'Rank songs best-fit first. Borda scoring.',
  },
]

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
  const [modeOpen, setModeOpen] = useState(false)
  const [mode, setMode] = useState('guess')
  const [readyBusy, setReadyBusy] = useState(false)
  const [readyError, setReadyError] = useState(null)
  // Host needs no toggle: Start unlocks once every OTHER member is ready.
  const notReady = players.filter((p) => p.id !== room.host_id && !p.is_ready)
  const allReady = notReady.length === 0
  const readyCount = players.filter((p) => p.id === room.host_id || p.is_ready).length
  const canStart = players.length >= 3 && allReady
  const isHost = me && me.id === room.host_id
  const imReady = !!me?.is_ready

  async function toggleReady() {
    setReadyBusy(true)
    setReadyError(null)
    const { error } = await supabase.rpc('set_ready', { p_room_id: room.id, p_ready: !imReady })
    if (error) setReadyError(error.message)
    setReadyBusy(false)
  }

  async function start(picked = mode) {
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('start_game', { p_room_id: room.id, p_mode: picked })
    if (error) setError(error.message)
    setBusy(false)
    if (!error) setModeOpen(false)
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
            : players.length < 3
              ? 'Start when you have at least 3 players.'
              : isHost
                ? `Waiting for ${notReady.length} more to ready up…`
                : 'Tap Ready below so the host can start.'}
        </p>
        <p className="mt-2 font-mono text-xs tabular-nums text-zinc-500" aria-live="polite">
          {readyCount}/{players.length} ready
        </p>
        {isHost ? (
          <>
            <button
              onClick={() => setModeOpen(true)}
              disabled={busy || !canStart}
              title={!canStart && players.length >= 3 ? 'Waiting for everyone to ready up' : undefined}
              className={`mx-auto mt-6 flex w-full max-w-xs items-center justify-center gap-2 rounded-full py-3.5 font-bold ${
                canStart ? 'btn-primary' : 'cursor-not-allowed bg-white/10 text-zinc-500'
              } disabled:opacity-70`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {busy ? 'Starting' : 'Start Game'}
            </button>
            {!canStart && players.length >= 3 && (
              <p className="mx-auto mt-3 max-w-xs text-xs text-zinc-500">
                Waiting for {notReady.length} more to ready up…
              </p>
            )}
            {error && <p className="mx-auto mt-3 max-w-xs rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{error}</p>}
            {modeOpen && (
              <div
                className="overlay-fade fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
                onClick={() => !busy && setModeOpen(false)}
                role="presentation"
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Choose game mode"
                  className="modal-pop grid w-full max-w-md gap-4 rounded-3xl border border-white/10 bg-zinc-950 p-5 text-left sm:p-6"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="grid gap-1">
                    <h3 className="font-display text-lg font-black">Choose game mode</h3>
                    <p className="text-sm text-zinc-400">One game, one mode. Play again returns here.</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {MODES.map((m) => {
                      const active = mode === m.id
                      return (
                        <button
                          key={m.id}
                          onClick={() => setMode(m.id)}
                          aria-pressed={active}
                          className={`grid min-w-0 gap-2 rounded-2xl border p-4 text-left transition active:scale-[0.98] ${
                            active
                              ? 'border-violet-400/60 bg-violet-600/20'
                              : 'border-white/10 bg-white/[0.03] lg:hover:border-white/20 lg:hover:bg-white/[0.06]'
                          }`}
                        >
                          <span className={`flex h-9 w-9 items-center justify-center rounded-full ${active ? 'bg-violet-500/30' : 'bg-white/10'}`}>
                            <m.icon className={`h-4 w-4 ${active ? 'text-violet-100' : 'text-zinc-300'}`} />
                          </span>
                          <span className="grid gap-1">
                            <span className="text-sm font-bold">{m.title}</span>
                            <span className="text-xs leading-relaxed text-zinc-400">{m.desc}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setModeOpen(false)}
                      disabled={busy}
                      className="flex-1 rounded-full border border-white/10 py-3 text-sm font-bold text-zinc-300 transition active:scale-[0.98] disabled:opacity-50 lg:hover:bg-white/5"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => start(mode)}
                      disabled={busy || !canStart}
                      className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {busy ? 'Starting…' : 'Confirm & start'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mx-auto mt-6 grid w-full max-w-xs justify-items-center gap-3 rounded-3xl border border-white/10 bg-black/40 p-5">
            <button
              onClick={toggleReady}
              disabled={readyBusy}
              aria-pressed={imReady}
              className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 font-bold transition active:scale-[0.98] disabled:opacity-50 ${
                imReady ? 'bg-emerald-500 text-black lg:hover:brightness-110' : 'btn-primary'
              }`}
            >
              {readyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : imReady ? <Check className="h-4 w-4" /> : null}
              {readyBusy ? 'Saving…' : imReady ? 'Ready! Tap to unready' : 'I’m Ready'}
            </button>
            {readyError && <p className="w-full rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{readyError}</p>}
            <div className="grid justify-items-center gap-1.5">
              <Hourglass className="animate-hourglass h-5 w-5 text-amber-300" />
              <p className="text-sm font-bold">Waiting for the host…</p>
              <p className="text-xs text-zinc-500">Only the host can start the game.</p>
            </div>
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
