const PALETTES = [
  'from-violet-500 to-fuchsia-400',
  'from-emerald-400 to-teal-500',
  'from-pink-500 to-rose-400',
  'from-amber-400 to-orange-500',
  'from-sky-400 to-indigo-500',
]

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

export default function Avatar({ name = '?', size = 'md' }) {
  const dims = size === 'lg' ? 'h-14 w-14 text-xl' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
  const palette = PALETTES[hash(name) % PALETTES.length]
  const initials = name.slice(0, 2).toUpperCase()
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white ${palette} ${dims}`}>
      {initials}
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b0b14] bg-emerald-400" />
    </span>
  )
}
