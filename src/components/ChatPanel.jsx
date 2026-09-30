import { SendHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Live room chat. Mobile: bottom sheet with dim overlay. Desktop: non-modal
// floating glass window bottom-right — game behind stays clickable.
// Parent controls open state; stays mounted across phases until closed.
export default function ChatPanel({ room, messages, myPlayerId, onClose, onSent }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [closing, setClosing] = useState(false)
  const listRef = useRef(null)
  const stickRef = useRef(true)
  const closeTimer = useRef(null)

  // Animated close: play exit keyframes, then unmount via parent.
  const requestClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => onClose?.(), 220)
  }, [closing, onClose])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, myPlayerId])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    stickRef.current = true
  }, [room.id])

  // Escape closes without touching game state.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [requestClose])

  async function send(e) {
    e.preventDefault()
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    const { error } = await supabase.rpc('send_message', {
      p_room_id: room.id,
      p_body: text.slice(0, 200),
    })
    if (error) setError(error.message)
    else {
      setBody('')
      onSent?.()
    }
    setSending(false)
  }

  function fmt(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  return (
    <>
      {/* Mobile-only dim overlay; desktop panel is non-modal so the game stays playable. */}
      <div
        className={`${closing ? 'overlay-exit' : 'overlay-fade'} fixed inset-0 z-40 bg-black/60 sm:hidden`}
        onClick={requestClose}
      />
      <div
        role="dialog"
        aria-label="Room chat"
        className={`chat-panel glass-frosted fixed inset-x-0 bottom-0 z-50 flex max-h-[78dvh] flex-col overflow-hidden rounded-t-3xl pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[min(560px,70dvh)] sm:w-[380px] sm:rounded-3xl ${closing ? 'chat-exit' : 'chat-enter'}`}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/25 sm:hidden" aria-hidden />
        <div className="relative flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <p className="text-sm font-bold">Room chat</p>
          <button
            onClick={requestClose}
            aria-label="Close chat"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul
          ref={listRef}
          onScroll={onScroll}
          className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-3"
        >
          {messages.length === 0 && (
            <li className="py-8 text-center text-xs text-zinc-600">
              No messages yet — say hi to the room.
            </li>
          )}
          {messages.map((m) => {
            const mine = myPlayerId && m.player_id === myPlayerId
            return (
              <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl border px-3.5 py-2 backdrop-blur-md ${
                    mine
                      ? 'rounded-br-md border-white/20 bg-violet-600/80 text-white shadow-lg shadow-violet-950/40'
                      : 'rounded-bl-md border-white/10 bg-white/[0.12] text-zinc-100'
                  }`}
                >
                  {!mine && (
                    <p className="text-[11px] font-bold text-violet-300">{m.nickname}</p>
                  )}
                  <p className="break-words text-sm leading-snug">{m.body}</p>
                  <p className={`mt-0.5 text-right font-mono text-[10px] ${mine ? 'text-violet-200/70' : 'text-zinc-600'}`}>
                    {fmt(m.created_at)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>

        {error && <p className="mx-4 mb-1 rounded-xl bg-red-950/80 p-2.5 text-xs text-red-300">{error}</p>}

        <form onSubmit={send} className="relative flex items-center gap-2 border-t border-white/10 bg-white/[0.03] p-3">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={200}
            placeholder="Message the room…"
            autoComplete="off"
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.08] px-4 py-2.5 text-base text-white outline-none backdrop-blur-md placeholder:text-zinc-400 focus:border-violet-400/70"
          />
          <button
            type="submit"
            disabled={sending || !body.trim()}
            aria-label="Send message"
            className="btn-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </form>
      </div>
    </>
  )
}
