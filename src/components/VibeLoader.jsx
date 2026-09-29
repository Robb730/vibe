import VibeLogo from './VibeLogo.jsx'

const BARS = ['0s', '-0.15s', '-0.3s', '-0.45s', '-0.6s', '-0.3s', '-0.15s']

// Brand loader: equalizer bars + logo + animated message.
export default function VibeLoader({ message = 'Loading', sub }) {
  return (
    <div className="grid justify-items-center gap-5 text-center">
      <div className="flex h-16 items-end gap-1.5" aria-hidden>
        {BARS.map((d, i) => (
          <span
            key={i}
            className="eq-bar h-10"
            style={{ animationDelay: d, height: `${22 + ((i * 7) % 20)}px` }}
          />
        ))}
      </div>
      <VibeLogo size="sm" />
      <div>
        <p className="font-display text-lg font-black">
          {message}
          <span className="reveal-dots" aria-hidden />
        </p>
        {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
      </div>
    </div>
  )
}
