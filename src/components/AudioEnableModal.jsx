import { Check, Loader2, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import VibeLogo from './VibeLogo.jsx'

// First-run sound permission for phones, shown in the lobby right after
// joining. The Allow tap plays a real chime inside the gesture — the
// strongest iOS unlock token — so every later timer-driven clip in both
// game modes is pre-authorized. No dismiss path by design: the tap itself
// is the unlock, and closing calls onEnabled.
const CHIME_SRC = '/sounds/songs-open.mp3'

export default function AudioEnableModal({ onEnabled }) {
  const [status, setStatus] = useState('idle') // idle | working | done | error
  const timer = useRef(null)

  function allow() {
    if (status === 'working' || status === 'done') return
    setStatus('working')
    let el = null
    try {
      el = new Audio(CHIME_SRC)
    } catch {
      setStatus('error')
      return
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      setStatus('done')
      timer.current = setTimeout(() => onEnabled?.(), 650)
    }
    try {
      const pr = el.play()
      if (pr && typeof pr.then === 'function') {
        pr.then(finish).catch(() => setStatus('error'))
      } else {
        finish()
      }
    } catch {
      setStatus('error')
    }
  }

  // Cleanup the delayed close if the parent unmounts first.
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <div
      className="overlay-fade fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Enable game sound"
    >
      <div className="modal-pop glass-deep my-auto grid w-full max-w-sm justify-items-center gap-4 rounded-3xl p-6 text-center sm:p-8">
        <VibeLogo size="sm" />

        <span className="relative flex h-20 w-20 items-center justify-center" aria-hidden>
          {status !== 'done' && <span className="animate-pulse-ring absolute inset-0 rounded-full" />}
          <span className="absolute inset-0 rounded-full bg-violet-600/20 ring-1 ring-inset ring-violet-400/40" />
          {status === 'done' ? (
            <Check className="reveal-crown-pop relative h-8 w-8 text-emerald-300" />
          ) : (
            <Volume2 className="relative h-8 w-8 text-violet-200" />
          )}
        </span>

        <div className="grid gap-1.5">
          <h3 className="font-display text-xl font-black">
            {status === 'done' ? 'Sound on!' : 'Turn on game sound?'}
          </h3>
          <p className="text-sm leading-relaxed text-zinc-400">
            {status === 'done'
              ? 'The music will just play from here.'
              : 'Vibe plays 10-second clips you\u2019ll vote on. Tap Allow once and the music just plays \u2014 no more silent rounds.'}
          </p>
        </div>

        {status === 'working' && (
          <div className="flex h-6 items-end gap-1" aria-hidden>
            {[0, 0.15, 0.3, 0.1, 0.25].map((d, i) => (
              <span key={i} className="eq-bar h-full" style={{ animationDelay: `${d}s` }} />
            ))}
          </div>
        )}

        {status === 'error' ? (
          <div className="grid w-full gap-2">
            <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">
              That didn\u2019t play — check silent mode and volume, then try again.
            </p>
            <button
              onClick={allow}
              className="btn-primary flex items-center justify-center gap-2 rounded-full py-3.5 font-bold"
            >
              <Volume2 className="h-4 w-4" /> Try again
            </button>
          </div>
        ) : (
          status !== 'done' && (
            <button
              onClick={allow}
              disabled={status === 'working'}
              className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3.5 font-bold disabled:opacity-70"
            >
              {status === 'working' ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Enabling…</>
              ) : (
                <><Volume2 className="h-4 w-4" /> Allow sound</>
              )}
            </button>
          )
        )}
      </div>
    </div>
  )
}
