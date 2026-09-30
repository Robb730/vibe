import { ArrowLeft, Check, Copy, Crown, LogOut, MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, ensureAnonSession } from '../lib/supabase.js'
import { playPhaseSound } from '../lib/countdownSound.js'
import { useRoom } from '../hooks/useRoom.js'
import VibeLogo from '../components/VibeLogo.jsx'
import VibeLoader from '../components/VibeLoader.jsx'
import Avatar from '../components/Avatar.jsx'
import Background from '../components/Background.jsx'
import AuthBanner from '../components/AuthBanner.jsx'
import JoinGate from '../components/JoinGate.jsx'
import ChatPanel from '../components/ChatPanel.jsx'
import StartCountdown from '../components/StartCountdown.jsx'
import Toasts from '../components/Toasts.jsx'
import '../lib/audio.js'
import Lobby from '../phases/Lobby.jsx'
import PromptEntry from '../phases/PromptEntry.jsx'
import SongPick from '../phases/SongPick.jsx'
import Guessing from '../phases/Guessing.jsx'
import Ranking from '../phases/Ranking.jsx'
import Results from '../phases/Results.jsx'

const MAX_PLAYERS = 8

const PHASE_LABEL = {
  lobby: 'Lobby',
  prompts: 'Writing prompts',
  songs: 'Picking songs',
  guessing: 'Guessing',
  results: 'Results',
}

function phaseLabel(phase, gameMode) {
  if (phase === 'guessing' && gameMode === 'rank') return 'Ranking'
  return PHASE_LABEL[phase] ?? phase
}

const iconBtn =
  'flex h-10 items-center justify-center gap-2 rounded-full text-zinc-500 transition active:bg-white/10 lg:hover:bg-white/5 lg:hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400'

export default function Room() {
  const { code } = useParams()
  const { room, players, rounds, votes, rankings, messages, loading, error, live, roomDeleted, refreshMessages } = useRoom(code)
  const [myUserId, setMyUserId] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [copied, setCopied] = useState(false)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    ensureAnonSession().then((err) => {
      setAuthError(err)
      supabase.auth.getUser().then(({ data }) => {
        setMyUserId(data.user?.id ?? null)
        setAuthReady(true)
      })
    })
  }, [])

  const [toasts, setToasts] = useState([])
  const toastId = useRef(0)
  const prevRoster = useRef(null)
  const prevHostId = useRef(null)

  const pushToast = useCallback((kind, text) => {
    const id = ++toastId.current
    setToasts((ts) => [...ts.slice(-2), { id, kind, text }])
    setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id))
    }, 3500)
  }, [])

  // Roster transitions -> join/leave toasts (initial load excluded).
  useEffect(() => {
    const cur = new Map(players.map((p) => [p.id, p.nickname]))
    if (prevRoster.current === null) {
      prevRoster.current = cur
      return
    }
    const prev = prevRoster.current
    prevRoster.current = cur
    for (const [id, nick] of cur) {
      if (!prev.has(id)) pushToast('join', `${nick} joined the room`)
    }
    for (const [id, nick] of prev) {
      if (!cur.has(id)) pushToast('leave', `${nick} left the room`)
    }
  }, [players, pushToast])

  // Crown passing -> host toast.
  useEffect(() => {
    if (!room) return
    if (prevHostId.current === null) {
      prevHostId.current = room.host_id
      return
    }
    if (prevHostId.current !== room.host_id) {
      prevHostId.current = room.host_id
      const h = players.find((p) => p.id === room.host_id)
      pushToast('host', `${h ? h.nickname : 'Someone'} is now host`)
    }
  }, [room, players, pushToast])

  const [chatOpen, setChatOpen] = useState(false)
  const [seenCount, setSeenCount] = useState(0)

  // Track seen messages while chat is open; the badge counts the rest.
  useEffect(() => {
    if (chatOpen) setSeenCount(messages.length)
  }, [chatOpen, messages])

  const unread = chatOpen ? 0 : Math.max(0, messages.length - seenCount)

  // Inline 3-2-1 when lobby flips to prompts and when songs flips to
  // guessing (host + guests). Late joiners loading straight into the phase
  // skip it (prevPhase starts null).
  // Songs-open chime fires exactly once per prompts -> songs entry.
  const [showStartCountdown, setShowStartCountdown] = useState(false)
  const [showGuessingCountdown, setShowGuessingCountdown] = useState(false)
  const prevPhase = useRef(null)
  const songsChimePlayed = useRef(false)
  useEffect(() => {
    const phase = room?.phase
    if (!phase) return
    if (prevPhase.current === 'lobby' && phase === 'prompts') setShowStartCountdown(true)
    else if (phase !== 'prompts') setShowStartCountdown(false)
    if (prevPhase.current === 'songs' && phase === 'guessing') setShowGuessingCountdown(true)
    else if (phase !== 'guessing') setShowGuessingCountdown(false)
    if (prevPhase.current === 'prompts' && phase === 'songs' && !songsChimePlayed.current) {
      songsChimePlayed.current = true
      playPhaseSound('songs')
    } else if (phase !== 'songs') {
      songsChimePlayed.current = false
    }
    prevPhase.current = phase
  }, [room?.phase])

  // Room vanished (last player left): brief notice, then home.
  useEffect(() => {
    if (!roomDeleted) return
    const t = setTimeout(() => {
      window.location.href = '/'
    }, 2500)
    return () => clearTimeout(t)
  }, [roomDeleted])

  if (loading || !authReady) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center bg-zinc-950">
        <Background />
        <div className="relative px-6">
          <VibeLoader message="Joining room" sub={code ? `Room ${String(code).toUpperCase()}` : 'Finding your vibe'} />
        </div>
      </div>
    )
  }

  if (roomDeleted) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <Background />
        <div className="relative grid max-w-sm justify-items-center gap-5 text-center">
          <VibeLogo size="sm" />
          <div>
            <p className="text-lg font-semibold">Room closed</p>
            <p className="mt-1 text-sm text-zinc-500">Everyone left — taking you home…</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !room) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <Background />
        <div className="relative grid max-w-sm justify-items-center gap-5 text-center">
          <VibeLogo size="sm" />
          <div>
            <p className="text-lg font-semibold">Room not found</p>
            <p className="mt-1 text-sm text-zinc-500">{error ?? 'Check the code and try again.'}</p>
          </div>
          <Link
            to="/"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-black transition active:scale-[0.98]"
          >
            <ArrowLeft className="h-4 w-4" /> Back home
          </Link>
        </div>
      </div>
    )
  }

  const host = players.find((p) => p.id === room.host_id)
  const me = players.find((p) => p.user_id === myUserId)

  // Invite-link visitor with no player row: nickname gate first.
  // Reload after join guarantees entry even if realtime isn't applied yet;
  // with 0003 applied the reload is a harmless one-time cost.
  if (!me) {
    return <JoinGate room={room} onJoined={() => window.location.reload()} />
  }

  const inviteLink = `${window.location.origin}/room/${room.code}`
  const spotsLeft = Math.max(0, MAX_PLAYERS - players.length)

  function copy() {
    navigator.clipboard?.writeText(inviteLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="relative min-h-[100dvh] overflow-x-clip text-zinc-100">
      <Background tone={room.phase} />
      <div className="relative mx-auto grid w-full max-w-7xl gap-6 px-4 pb-12 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:px-8 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-x-10 xl:px-10">
        {/* Header */}
        <header className="grid gap-5 lg:col-start-1 lg:row-start-1">
          <div className="flex items-center gap-1">
            <Link to="/" aria-label="Back home" className={`${iconBtn} -ml-2 w-10`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <VibeLogo size="sm" />
            <button
              onClick={async () => {
                try {
                  await supabase.rpc('leave_room', { p_room_id: room.id })
                } catch {
                  /* going home anyway */
                }
                window.location.href = '/'
              }}
              aria-label="Leave room"
              className={`${iconBtn} ml-auto px-3 text-sm`}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Leave</span>
            </button>
          </div>

          <AuthBanner authError={authError} />

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-black tracking-tight">{room.code}</h1>
              <p className="mt-1.5 flex items-center gap-2 truncate text-sm text-zinc-500">
                <span
                  role="status"
                  aria-label={live ? 'Realtime connected' : 'Reconnecting'}
                  title={live ? 'Realtime connected' : 'Reconnecting to realtime… run 0003_realtime.sql if this never turns green.'}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${live ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`}
                />
                <span className="truncate">
                  {phaseLabel(room.phase, room.game_mode)}
                  {host ? `, hosted by ${host.nickname}` : ''}
                </span>
              </p>
            </div>
            <button
              onClick={copy}
              aria-live="polite"
              className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-zinc-900 px-4 text-sm font-medium text-zinc-200 ring-1 ring-inset ring-white/[0.08] transition active:scale-95 lg:hover:bg-zinc-800"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4 text-zinc-400" />}
              {copied ? 'Copied' : 'Invite'}
            </button>
          </div>
        </header>

        {/* Roster: horizontal strip on mobile, sidebar on desktop */}
        <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-1">
          <div className="mb-3 hidden items-baseline justify-between lg:flex">
            <p className="text-sm font-medium text-zinc-300">Players</p>
            <p className="text-xs tabular-nums text-zinc-600">
              {players.length} of {MAX_PLAYERS}
            </p>
          </div>
          <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:sticky lg:top-4 lg:mx-0 lg:grid lg:gap-0.5 lg:overflow-visible lg:px-0">
            {players.map((p) => {
              const isMe = p.user_id === myUserId
              return (
                <li
                  key={p.id}
                  className="flex shrink-0 items-center gap-2.5 rounded-full bg-zinc-900 py-1 pl-1 pr-3 ring-1 ring-inset ring-white/[0.06] lg:rounded-xl lg:bg-transparent lg:py-1.5 lg:pl-1.5 lg:ring-0"
                >
                  <Avatar name={p.nickname} size="sm" />
                  <span
                    className={`max-w-[9rem] truncate text-sm lg:max-w-none lg:flex-1 ${
                      isMe ? 'font-semibold text-white' : 'font-medium text-zinc-300'
                    }`}
                  >
                    {isMe ? 'You' : p.nickname}
                  </span>
                  {p.id === room.host_id && <Crown className="h-3.5 w-3.5 shrink-0 text-violet-300" aria-label="Host" />}
                  {p.score > 0 && <span className="text-xs tabular-nums text-zinc-500 lg:ml-auto">{p.score}pt</span>}
                </li>
              )
            })}
          </ul>
          {room.phase === 'lobby' && (
            <p className="mt-4 hidden text-xs leading-relaxed text-zinc-600 lg:block">
              {spotsLeft > 0 ? `${spotsLeft} spots open. ` : 'Room is full. '}
              The game starts with at least 3 players.
            </p>
          )}
        </aside>

        {/* Phase content. No overflow-hidden: the song dropdown must float above. */}
        <main className="min-w-0 lg:col-start-1 lg:row-start-2">
          <div className="stage rounded-3xl">
            {room.phase === 'lobby' && <Lobby room={room} players={players} me={me} />}
            {room.phase === 'prompts' && (
              <div className="p-5 sm:p-8 xl:p-10">
                {showStartCountdown ? (
                  <StartCountdown onDone={() => setShowStartCountdown(false)} />
                ) : (
                  <PromptEntry room={room} players={players} me={me} />
                )}
              </div>
            )}
            {room.phase === 'songs' && (
              <div className="p-5 sm:p-8 xl:p-10"><SongPick room={room} players={players} rounds={rounds} me={me} /></div>
            )}
            {room.phase === 'guessing' && (
              <div className="p-5 sm:p-8 xl:p-10">
                {showGuessingCountdown ? (
                  <StartCountdown
                    title={room.game_mode === 'rank' ? 'Ranking starts' : 'Guessing starts'}
                    subtitle={room.game_mode === 'rank'
                      ? 'Get ready — hear every clip, then rank best fit first'
                      : 'Get ready — hear the clips, catch who picked what'}
                    chime="songs"
                    onDone={() => setShowGuessingCountdown(false)}
                  />
                ) : room.game_mode === 'rank' ? (
                  <Ranking room={room} players={players} rounds={rounds} rankings={rankings} me={me} />
                ) : (
                  <Guessing room={room} players={players} rounds={rounds} votes={votes} me={me} />
                )}
              </div>
            )}
            {room.phase === 'results' && (
              <div className="p-5 sm:p-8 xl:p-10"><Results room={room} players={players} rounds={rounds} votes={votes} rankings={rankings} me={me} /></div>
            )}
          </div>
        </main>
      </div>
      <Toasts toasts={toasts} />
      {/* Floating glass chat button — all phases, bottom-right on mobile + desktop. */}
      <button
        onClick={() => {
          if (!chatOpen) setSeenCount(messages.length)
          setChatOpen((v) => !v)
        }}
        aria-label={
          chatOpen ? 'Close chat' : unread > 0 ? `Open chat, ${unread} unread messages` : 'Open chat'
        }
        aria-expanded={chatOpen}
        className={`glass fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full text-zinc-100 shadow-2xl shadow-black/50 backdrop-blur-xl transition active:scale-95 lg:hover:bg-white/[0.12] xl:bottom-8 xl:right-8 ${
          unread > 0 && !chatOpen ? 'animate-pulse-ring' : ''
        }`}
      >
        <MessageCircle className="h-5 w-5 shrink-0" />
        {unread > 0 && !chatOpen && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-black text-white shadow-lg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {chatOpen && (
        <ChatPanel
          room={room}
          messages={messages}
          myPlayerId={me?.id}
          onClose={() => setChatOpen(false)}
          onSent={refreshMessages}
        />
      )}
    </div>
  )
}