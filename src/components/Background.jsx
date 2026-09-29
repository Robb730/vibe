// Ambient scene: aurora ribbons, bokeh orbs, grain, vignette.
// `tone` follows the game phase so the room mood shifts as the game flows.
const TONES = {
  lobby: 'from-violet-600/25 via-fuchsia-500/[0.07] to-transparent',
  prompts: 'from-sky-500/25 via-cyan-400/[0.07] to-transparent',
  songs: 'from-fuchsia-500/25 via-pink-500/[0.07] to-transparent',
  guessing: 'from-amber-500/20 via-orange-500/[0.07] to-transparent',
  results: 'from-emerald-500/20 via-teal-400/[0.07] to-transparent',
}

const ORBS = [
  { pos: 'left-[6%] top-[12%]', size: 'h-2 w-2', color: 'bg-violet-300/70', delay: '0s', dur: '7s' },
  { pos: 'right-[10%] top-[22%]', size: 'h-1.5 w-1.5', color: 'bg-fuchsia-300/60', delay: '-2s', dur: '9s' },
  { pos: 'left-[18%] top-[58%]', size: 'h-1.5 w-1.5', color: 'bg-sky-300/50', delay: '-4s', dur: '8s' },
  { pos: 'right-[22%] top-[64%]', size: 'h-2.5 w-2.5', color: 'bg-amber-200/40', delay: '-1s', dur: '10s' },
  { pos: 'left-[45%] top-[8%]', size: 'h-1 w-1', color: 'bg-white/50', delay: '-3s', dur: '6s' },
  { pos: 'right-[38%] bottom-[10%]', size: 'h-1.5 w-1.5', color: 'bg-violet-200/40', delay: '-5s', dur: '11s' },
]

export default function Background({ tone = 'lobby' }) {
  const accent = TONES[tone] ?? TONES.lobby
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {/* deep base — never flat black */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c0c1a] via-[#07070d] to-[#040407]" />

      {/* slow aurora ribbons */}
      <div className="bg-aurora-a absolute -inset-x-1/4 top-[-30%] h-[80%] blur-[70px]" />
      <div className="bg-aurora-b absolute -inset-x-1/4 bottom-[-35%] h-[75%] blur-[80px]" />

      {/* phase-reactive wash, crossfades on phase change */}
      <div key={tone} className={`bg-tone-fade absolute inset-0 bg-gradient-to-b ${accent}`} />

      {/* drifting bokeh orbs */}
      {ORBS.map((o, i) => (
        <span
          key={i}
          className={`animate-floaty absolute rounded-full blur-[1px] ${o.pos} ${o.size} ${o.color}`}
          style={{ '--tilt': '0deg', animationDelay: o.delay, animationDuration: o.dur }}
        />
      ))}

      {/* film grain + vignette */}
      <div className="bg-grain absolute inset-0 opacity-[0.05]" />
      <div className="bg-vignette absolute inset-0" />
    </div>
  )
}
