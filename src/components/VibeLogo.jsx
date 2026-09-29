import { AudioLines } from 'lucide-react'

export default function VibeLogo({ size = 'md' }) {
  const text = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-xl' : 'text-2xl'
  const icon = size === 'lg' ? 'h-7 w-7' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  return (
    <span className={`inline-flex items-center gap-1.5 font-display font-black tracking-tight ${text}`}>
      <AudioLines className={`${icon} text-sky-300`} strokeWidth={2.5} />
      <span>
        <span className="text-white">v</span>
        <span className="text-white">i</span>
        <span className="text-[#c084fc]">b</span>
        <span className="text-white">e</span>
      </span>
      <AudioLines className={`${icon} -scale-x-100 text-amber-300`} strokeWidth={2.5} />
    </span>
  )
}
