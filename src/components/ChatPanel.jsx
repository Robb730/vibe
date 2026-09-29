import { SendHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Live room chat. Rendered as a right drawer on desktop and a bottom sheet
// on mobile (same component, responsive positioning). Parent controls open
// state; auto-scroll sticks only when already near the bottom.
export default function ChatPanel({ room, messages, myPlayerId, onClose, onSent }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const listRef = useRef(null)
  const stickRef = useRef(true)

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
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Room chat">
      <div className="overlay-fade absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="modal-pop absolute inset-x-0 bottom-0 flex max-h-[78dvh] flex-col rounded-t-3xl border-t border-white/10 bg-[#101018]/98 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-0 sm:max-h-none sm:w-[380px] sm:rounded-l-3xl sm:rounded-tr-none sm:border-l sm:border-t-0">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" aria-hidden />
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <p className="text-sm font-bold">Room chat</p>
          <button
            onClick={onClose}
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
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${mine ? 'rounded-br-md bg-violet-600 text-white' : 'rounded-bl-md bg-white/[0.07] text-zinc-100'}`}>
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

        <form onSubmit={send} className="flex items-center gap-2 border-t border-white/[0.06] p-3">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={200}
            placeholder="Message the room…"
            autoComplete="off"
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/40 px-4 py-2.5 text-base outline-none placeholder:text-zinc-600 focus:border-violet-500"
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
    </div>
  )
}
