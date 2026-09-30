import { useEffect, useMemo, useRef, useState } from 'react'
import { playPhaseSound } from '../lib/countdownSound.js'

// Inline 3-2-1-Go shown inside the stage on phase entries
// (lobby -> prompts, songs -> guessing).
// Timing is local per client (~1s realtime skew max); each step is 1s,
// Go! holds ~450ms, then onDone swaps in the phase UI.
// chime: which sound plays on Go ('prompts' | 'songs').
const STEPS = [3, 2, 1]
const STEP_MS = 1000
const GO_MS = 450

export default function StartCountdown({
  onDone,
  title = 'Game starting',
  subtitle = 'Get ready — prompts are coming',
  chime = 'prompts',
}) {
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const [step, setStep] = useState(0) // 0..2 = 3..1, 3 = Go!
  const goPlayed = useRef(false)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])

  // Go chime fires exactly once per countdown instance.
  useEffect(() => {
    if (step < STEPS.length || goPlayed.current) return
    goPlayed.current = true
    playPhaseSound(chime)
  }, [step, chime])

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => doneRef.current?.(), 0)
      return () => clearTimeout(t)
    }
    const timers = []
    for (let i = 1; i <= STEPS.length; i++) {
      timers.push(setTimeout(() => setStep(i), i * STEP_MS))
    }
    timers.push(setTimeout(() => doneRef.current?.(), STEPS.length * STEP_MS + GO_MS))
    return () => timers.forEach(clearTimeout)
  }, [reduced])

  if (reduced) {
    return (
      <div className="p-5 text-center sm:p-8" aria-live="polite">
        <p className="text-sm text-zinc-400">Starting…</p>
      </div>
    )
  }

  const go = step >= STEPS.length
  const n = go ? 'Go!' : STEPS[step]

  return (
    <div className="p-5 text-center sm:p-8" aria-live="assertive">
      <section className="mx-auto grid max-w-md justify-items-center gap-3 py-10 lg:max-w-xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-violet-300">
          {title}
        </p>
        <p className="text-sm text-zinc-400">{subtitle}</p>
        <div
          key={go ? 'go' : n}
          className="countdown-pop font-display mt-2 flex h-28 w-28 items-center justify-center rounded-full bg-violet-600/20 text-5xl font-black text-white ring-2 ring-violet-400/50"
        >
          {n}
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {[...Array(STEPS.length + 1)].map((_, i) => (
            <span
              key={i}
              className={`h-1 w-6 rounded-full transition-colors ${i <= step ? 'bg-violet-400' : 'bg-zinc-800'}`}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
