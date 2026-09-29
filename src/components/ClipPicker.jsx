import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const CLIP = 10
const TOTAL = 30
const MAX_START = TOTAL - CLIP
const BAR_COUNT = 60

// Decorative waveform (deterministic, so it doesn't flicker between renders).
const BARS = Array.from({ length: BAR_COUNT }, (_, i) =>
  0.22 + 0.78 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)),
)

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const fmt = (s) => `0:${String(s).padStart(2, '0')}`

export default function ClipPicker({ previewUrl, clipStart, setClipStart, onSubmit, submitting }) {
  const audioRef = useRef(null)
  const trackRef = useRef(null)
  const dragging = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1 within the clip

  useEffect(() => () => audioRef.current?.pause(), [])

  function stop() {
    audioRef.current?.pause()
    setPlaying(false)
    setProgress(0)
  }

  function playClip() {
    const el = audioRef.current
    if (!el) return
    el.currentTime = clipStart
    setProgress(0)
    setPlaying(true)
    el.play().catch(() => setPlaying(false))
  }

  function onTimeUpdate() {
    const el = audioRef.current
    if (!el || !playing) return
    const p = (el.currentTime - clipStart) / CLIP
    if (p >= 1) stop()
    else setProgress(Math.max(0, p))
  }

  // Centre the 10s window on the finger / pointer.
  function moveTo(clientX) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const sec = ((clientX - rect.left) / rect.width) * TOTAL - CLIP / 2
    const next = clamp(Math.round(sec), 0, MAX_START)
    if (next !== clipStart) {
      if (playing) stop()
      setClipStart(next)
    }
  }

  function onPointerDown(e) {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    moveTo(e.clientX)
  }
  function onPointerMove(e) {
    if (dragging.current) moveTo(e.clientX)
  }
  function onPointerUp() {
    dragging.current = false
  }
  function onKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      setClipStart(clamp(clipStart - 1, 0, MAX_START))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      setClipStart(clamp(clipStart + 1, 0, MAX_START))
    }
  }

  const playedUntil = clipStart + progress * CLIP

  return (
    <div className="grid gap-5">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={previewUrl} preload="auto" onTimeUpdate={onTimeUpdate} onEnded={stop} />

      <div>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Clip start"
          aria-valuemin={0}
          aria-valuemax={MAX_START}
          aria-valuenow={clipStart}
          aria-valuetext={`${clipStart} to ${clipStart + CLIP} seconds`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="flex h-16 cursor-pointer touch-none select-none items-center gap-[2px] rounded-2xl bg-zinc-900 px-3 outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          {BARS.map((h, i) => {
            const t = ((i + 0.5) / BAR_COUNT) * TOTAL
            const inWindow = t >= clipStart && t < clipStart + CLIP
            const played = inWindow && t < playedUntil
            return (
              <span
                key={i}
                style={{ height: `${h * 100}%` }}
                className={`flex-1 rounded-full transition-colors duration-150 ${
                  played ? 'bg-violet-400' : inWindow ? 'bg-white' : 'bg-zinc-700'
                }`}
              />
            )
          })}
        </div>
        <div className="mt-2 flex justify-between text-xs tabular-nums text-zinc-600">
          <span>0:00</span>
          <span>0:30</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={playing ? stop : playClip}
          aria-label={playing ? 'Stop preview' : 'Play clip'}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-black transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
        >
          {playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
        </button>
        <div className="min-w-0">
          <p className="text-base font-semibold tabular-nums">
            {fmt(clipStart)} – {fmt(clipStart + CLIP)}
          </p>
          <p className="text-sm text-zinc-500">Drag to choose your 10 second clip</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="flex h-12 w-full items-center justify-center rounded-full bg-white text-sm font-semibold text-black transition active:scale-[0.98] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
      >
        {submitting ? 'Locking…' : 'Lock in song'}
      </button>
    </div>
  )
}