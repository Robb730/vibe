import { Crown, Medal, Music, Trophy } from 'lucide-react'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import Avatar from '../components/Avatar.jsx'
import Marquee from '../components/Marquee.jsx'

export default function Results({ room, players, rounds, votes }) {
  const ranked = [...players].sort((a, b) => b.score - a.score)

  const groups = useMemo(() => {
    const map = new Map()
    for (const r of rounds) {
      const k = r.prompt_ord ?? 0
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(r)
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ord, songs]) => ({
        ord,
        prompt: songs[0]?.prompt_text ?? '',
        songs: songs.sort((a, b) => a.order_idx - b.order_idx),
      }))
  }, [rounds])

  async function playAgain() {
    await supabase.rpc('restart_game', { p_room_id: room.id })
  }

  return (
    <section className="mx-auto grid max-w-lg gap-5 lg:max-w-2xl">
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-300">5 · Reveal</p>
        <h3 className="font-display mt-1 flex items-center justify-center gap-2 text-2xl font-black">
          <Trophy className="h-6 w-6 text-amber-300" /> Results
        </h3>
      </div>

      <ol className="grid gap-2">
        {ranked.map((p, i) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 rounded-2xl border p-3 ${
              i === 0 ? 'border-amber-400/30 bg-amber-400/10' : 'border-white/5 bg-white/[0.04]'
            }`}
          >
            <span className="flex w-8 justify-center text-zinc-500">
              {i === 0 ? <Crown className="h-5 w-5 text-amber-300" /> : i === 1 || i === 2 ? <Medal className="h-5 w-5" /> : <span className="font-black">{i + 1}</span>}
            </span>
            <Avatar name={p.nickname} size="sm" />
            <span className="min-w-0 flex-1 truncate font-bold">{p.nickname}</span>
            <span className="ml-auto shrink-0 font-mono text-sm">{p.score} pts</span>
          </li>
        ))}
      </ol>

      {groups.map((g) => (
        <div key={g.ord} className="grid gap-2">
          <p className="mt-2 px-1 text-xs font-bold uppercase tracking-[0.25em] text-violet-300">
            Prompt {g.ord + 1} · <span className="normal-case text-zinc-200">“{g.prompt}”</span>
          </p>
          {g.songs.map((r) => {
            const picker = players.find((p) => p.id === r.picker_id)
            const correct = votes.filter((v) => v.round_id === r.id && v.guessed_id === r.picker_id)
            return (
              <div key={r.id} className="flex gap-3 rounded-3xl border border-white/5 bg-white/[0.03] p-3">
                {r.artwork_url
                  ? <img src={r.artwork_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-2xl object-cover sm:h-14 sm:w-14" />
                  : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-600/20 sm:h-14 sm:w-14"><Music className="h-6 w-6 text-violet-300" /></span>}
                <div className="min-w-0 flex-1 text-sm">
                  <Marquee label={`${r.title} — ${r.artist}`} className="font-bold">
                    {r.title} <span className="font-normal text-zinc-500">— {r.artist}</span>
                  </Marquee>
                  <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">
                    Picked by {picker?.nickname ?? '?'} · {correct.length} correct
                    {correct.length > 0 && ` (${correct.map((v) => players.find((p) => p.id === v.voter_id)?.nickname ?? '?').join(', ')})`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <button onClick={playAgain} className="btn-primary rounded-full py-3.5 font-bold">
        Play again (same room) →
      </button>
    </section>
  )
}
