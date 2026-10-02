import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getVolume, setVolume, subscribeVolume } from '../lib/volume.js'

// Room clip-volume mixer (song clips only — phase chimes stay full).
// Mobile-first: the panel is a thumb-friendly bottom sheet on phones and a
// compact dropdown on sm+ screens. Level persists per device.
export default function VolumeControl({ iconClass }) {
  const [volume, setVol] = useState(() => getVolume())
  const [open, setOpen] = useState(false)
  const lastAudible = useRef(volume > 0 ? volume : 1)
  const panelRef = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => subscribeVolume(setVol), [])

  useEffect(() => {
    if (volume > 0) lastAudible.current = volume
  }, [volume])

  // Close on outside tap / Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (panelRef.current?.contains(e.target)) return
      if (btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open ])

  const muted = volume <= 0
  const Icon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const pct = Math.round(volume * 100)

  function toggleMute() {
    setVolume(muted ? lastAudible.current : 0)
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close volume mixer' : `Open volume mixer, currently ${pct} percent`}
        aria-expanded={open}
        className={`${iconClass ?? ''} w-10`}
      >
        <Icon className="h-5 w-5" />
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Clip volume"
          className="glass fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] rounded-3xl p-5 shadow-2xl shadow-black/50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-12 sm:z-50 sm:w-72 sm:p-4"
        >
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              aria-label={muted ? 'Unmute clips' : 'Mute clips'}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-200 ring-1 ring-inset ring-white/10 transition active:scale-95 lg:hover:bg-white/10"
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              aria-label="Clip volume"
              aria-valuetext={`${pct} percent`}
              className="h-11 min-w-0 flex-1 cursor-pointer accent-violet-400"
            />
            <span className="w-12 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-zinc-100">
              {pct}%
            </span>
          </div>
          <p className="mt-2 text-center text-xs text-zinc-500 sm:text-left">
            Song clips only — chimes stay full volume.
          </p>
        </div>
      )}
    </div>
  )
}
