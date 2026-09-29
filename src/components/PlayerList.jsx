import { Crown } from 'lucide-react'
import Avatar from './Avatar.jsx'

export default function PlayerList({ players, hostId }) {
  return (
    <ul className="grid gap-1">
      {players.map((p) => (
        <li key={p.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white/5">
          <Avatar name={p.nickname} size="sm" />
          <span className="text-sm font-semibold">{p.nickname}</span>
          {p.id === hostId
            ? (
              <span className="ml-auto flex items-center gap-1 rounded-full bg-violet-600/25 px-2.5 py-1 text-[10px] font-bold text-violet-200">
                <Crown className="h-3 w-3" /> Host
              </span>
            )
            : <span className="ml-auto font-mono text-xs text-zinc-500">{p.score}pt</span>}
        </li>
      ))}
    </ul>
  )
}
