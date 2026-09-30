import { useEffect } from 'react'
import { Code2, Heart, Music, Sparkles, Users, X } from 'lucide-react'
import VibeLogo from './VibeLogo.jsx'

export default function CreditsModal({ onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="overlay-fade fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Credits"
    >
      <div
        className="modal-pop glass-deep relative my-auto flex max-h-[85vh] max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-[#10101c]/90 px-6 py-4 backdrop-blur-xl">
          <VibeLogo size="sm" />
          <button
            onClick={onClose}
            aria-label="Close credits"
            className="rounded-full p-1.5 text-zinc-500 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="credits-scroll -mx-1 max-h-[calc(85vh-73px)] max-h-[calc(85dvh-73px)] overflow-y-auto px-6 py-5">
          <div className="pointer-events-none absolute inset-x-6 top-[73px] z-10 h-6 bg-gradient-to-b from-[#10101c] to-transparent" aria-hidden />
          <h3 className="font-display text-2xl font-black">
            Credits <span className="text-gradient">.</span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            The people and services behind vibe.
          </p>

          <div className="mt-5 grid gap-3">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-violet-600/20 to-transparent p-4">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-violet-300">
              <Code2 className="h-3.5 w-3.5" /> Lead Developer
            </p>
            <p className="font-display mt-2 text-xl font-black">RJO</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Design, code, and late-night debugging — built the whole game from scratch.
            </p>
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              <Users className="h-3.5 w-3.5" /> Suggestions &amp; Playtesting
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {['Hensley', 'Yukari', 'Toni', 'Lanz'].map((n) => (
                <span key={n} className="rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-bold text-white">
                  {n}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Thanks for the ideas, feedback, and for testing the game with us.
            </p>
          </div>

          <div className="rounded-2xl border border-amber-300/20 bg-gradient-to-b from-amber-400/15 to-transparent p-4">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-amber-300">
              <Sparkles className="h-3.5 w-3.5" /> Special Thanks
            </p>
            <p className="font-display mt-2 text-lg font-black">jefferson dalundon</p>
            <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-zinc-400">
              <Heart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pink-400" />
              That one random person we met on umingle — thanks for vibing with us.
            </p>
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              <Music className="h-3.5 w-3.5" /> Music Data
            </p>
            <p className="mt-2 text-sm font-bold">Apple iTunes Search API</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Song search, 30-second previews, and artwork are provided by Apple&apos;s iTunes
              Search API. All music rights belong to the respective artists and labels.{' '}
              <a
                href="https://www.apple.com/itunes/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-sky-300 underline-offset-2 hover:underline"
              >
                apple.com/itunes
              </a>
            </p>
          </div>

          <p className="handwritten mt-5 text-center text-xl text-zinc-500">
            good music. better people.
          </p>
        </div>
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-8 bg-gradient-to-t from-[#10101c] to-transparent" aria-hidden />
      </div>
    </div>
    </div>
  )
}
