// Bottom-center stacked toasts (joins, leaves, host changes). Auto-dismissed
// by the parent; this component is purely presentational.
const DOTS = {
  join: 'bg-emerald-400',
  leave: 'bg-zinc-500',
  host: 'bg-violet-400',
}

export default function Toasts({ toasts }) {
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-in flex max-w-full items-center gap-2.5 rounded-full border border-white/10 bg-[#14141f]/95 py-2.5 pl-4 pr-5 text-sm font-semibold shadow-2xl backdrop-blur-xl"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOTS[t.kind] ?? DOTS.join}`} />
          <span className="truncate">{t.text}</span>
        </div>
      ))}
    </div>
  )
}
