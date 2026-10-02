import { ArrowRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import VibeLogo from './VibeLogo.jsx'

// Gate for visitors opening an invite link who aren't players yet.
// Mid-game arrivals with the SAME anon session reclaim their seat
// (join_room rejoin path); genuinely new sessions are told to wait for the
// next round.
const JOIN_TIMEOUT_MS = 15_000

function friendlyJoinError(msg, midGame) {
  if (/kicked/i.test(msg ?? '')) return 'The host removed you — bans lift when they restart the game.'
  if (/already started/i.test(msg ?? '')) {
    return midGame
      ? 'This game already started and this device has no seat to reclaim — ask the host for the next round.'
      : 'This game already started — ask the host for the next round.'
  }
  if (/full/i.test(msg ?? '')) return 'Room is full (8 max) — wait for the next game.'
  return msg
}

export default function JoinGate({ room, onJoined }) {
  const [nickname, setNickname] = useState(() => {
    try {
      return localStorage.getItem('vibe-nickname') ?? ''
    } catch {
      return ''
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const midGame = room.phase !== 'lobby'

  async function join(e) {
    e.preventDefault()
    if (!nickname.trim()) return setError('Enter a nickname first.')
    // Blocked storage (private mode / locked-down webviews) means the
    // session can't persist — joining would bounce straight back here.
    try {
      localStorage.setItem('vibe-storage-test', '1')
      localStorage.removeItem('vibe-storage-test')
    } catch {
      setError('Joining won\u2019t stick in private mode — open this link in Safari.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { error } = await Promise.race([
        supabase.rpc('join_room', {
          p_code: room.code,
          p_nickname: nickname.trim(),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('JOIN_TIMEOUT')), JOIN_TIMEOUT_MS)),
      ])
      if (error) throw error
      try {
        localStorage.setItem('vibe-nickname', nickname.trim().slice(0, 20))
      } catch {
        /* non-fatal */
      }
      onJoined?.()
    } catch (err) {
      setError(err?.message === 'JOIN_TIMEOUT'
        ? 'Still trying — check your connection and tap Join again.'
        : friendlyJoinError(err.message, midGame))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay-fade relative flex min-h-screen items-center justify-center bg-[#07070d] p-6">
      <div className="modal-pop glass-deep w-full max-w-sm rounded-3xl p-8">
        <div className="flex justify-center"><VibeLogo size="sm" /></div>
        <p className="mt-4 text-center text-[11px] font-bold uppercase tracking-[0.3em] text-zinc-500">
          {midGame ? 'Rejoin room' : 'You\u2019re invited to room'}
        </p>
        <p className="mt-1 text-center font-mono text-3xl font-black tracking-[0.3em]">{room.code}</p>
        {midGame && (
          <p className="mt-3 text-center text-xs leading-relaxed text-zinc-400">
            This game already started — enter your nickname to reclaim your seat.
          </p>
        )}
        <form onSubmit={join} className="mt-6 grid gap-3">
          <label className="grid gap-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Your nickname</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
              placeholder="e.g. RJ"
              autoFocus
              className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-violet-500"
            />
          </label>
          {error && <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{error}</p>}
          <button disabled={busy} className="btn-primary flex items-center justify-center gap-2 rounded-full py-3 font-bold disabled:opacity-50">
            {busy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Joining<span className="reveal-dots" /></>
            ) : (
              <>{midGame ? 'Rejoin' : 'Join room'} <ArrowRight className="h-4 w-4" /></>
            )}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-zinc-600">No signup · 3+ players to start</p>
      </div>
    </div>
  )
}
