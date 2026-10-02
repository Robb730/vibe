import { ArrowLeft, Check, ChevronDown, Clock, Copy, Crown, LogOut, MessageCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, ensureAnonSession, leaveRoomBeacon } from '../lib/supabase.js'
import { playPhaseSound } from '../lib/countdownSound.js'
import { useRoom } from '../hooks/useRoom.js'
import { useHeartbeat } from '../hooks/usePlayers.js'
import VibeLogo from '../components/VibeLogo.jsx'
import VibeLoader from '../components/VibeLoader.jsx'
import Avatar from '../components/Avatar.jsx'
import Background from '../components/Background.jsx'
import AuthBanner from '../components/AuthBanner.jsx'
import JoinGate from '../components/JoinGate.jsx'
import ChatPanel from '../components/ChatPanel.jsx'
import StartCountdown from '../components/StartCountdown.jsx'
import Toasts from '../components/Toasts.jsx'
import VolumeControl from '../components/VolumeControl.jsx'
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

// Flags telling "my own refresh" apart from "host removed me". Unload is
// session-scoped (survives refresh in the same tab, not new tabs); kicked
// is persistent (a kicked-then-refreshed tab must not auto-rejoin).
function unloadKey(roomId) {
  return `vibe-unloaded-${roomId}`
}
function kickedKey(roomId) {
  return `vibe-kicked-${roomId}`
}
function readFlag(store, key) {
  try {
    return store.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeFlag(store, key) {
  try {
    store.setItem(key, '1')
  } catch {
    /* storage blocked: fall back to in-memory state */
  }
}
function clearFlag(store, key) {
  try {
    store.removeItem(key)
  } catch {
    /* ignore */
  }
}

// One roster row, shared by the mobile expanded list and the desktop
// sidebar: avatar, name, ready pill (lobby), away dim, crown, score, kick.
function PlayerRow({ p, isMe, showReady, isHostRow, offline, canKick, armed, kickBusy, onKick }) {
  return (
    <li
      className={`flex items-center gap-2.5 rounded-2xl bg-zinc-900 px-2 py-1.5 ring-1 ring-inset ring-white/[0.06] lg:rounded-xl lg:bg-transparent lg:py-1.5 lg:pl-1.5 lg:ring-0 ${
        offline ? 'opacity-60' : ''
      }`}
    >
      <Avatar name={p.nickname} size="sm" />
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          isMe ? 'font-semibold text-white' : 'font-medium text-zinc-300'
        }`}
      >
        {isMe ? 'You' : p.nickname}
      </span>
      {showReady && (
        <span
          role="status"
          aria-label={`${isMe ? 'You are' : `${p.nickname} is`} ${p.is_ready ? 'ready' : 'not ready'}`}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${
            p.is_ready
              ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30'
              : 'bg-white/5 text-zinc-400 ring-white/10'
          }`}
        >
          {p.is_ready ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {p.is_ready ? 'Ready' : 'Waiting'}
        </span>
      )}
      {offline && <span className="shrink-0 text-[11px] text-zinc-600">away</span>}
      {isHostRow && <Crown className="h-3.5 w-3.5 shrink-0 text-violet-300" aria-label="Host" />}
      {p.score > 0 && <span className="shrink-0 text-xs tabular-nums text-zinc-500">{p.score}pt</span>}
      {canKick && (
        <button
          onClick={onKick}
          disabled={kickBusy}
          aria-label={armed ? `Confirm remove ${p.nickname}` : `Remove ${p.nickname}`}
          className={`flex h-8 shrink-0 items-center justify-center rounded-full transition active:bg-white/10 lg:hover:bg-white/5 disabled:opacity-50 ${
            armed ? 'w-auto px-2.5 text-[11px] font-bold text-red-300 lg:hover:text-red-200' : 'w-8 text-zinc-600 lg:hover:text-red-300'
          }`}
        >
          {armed ? 'Sure?' : <X className="h-4 w-4" />}
        </button>
      )}
    </li>
  )
}

// Roster presence: no beat in this window -> shown as away; the server
// prunes rows silent 90s+ (heartbeat RPC).
const OFFLINE_MS = 45_000

export default function Room() {
  const { code } = useParams()
  const [myUserId, setMyUserId] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [copied, setCopied] = useState(false)
  const [authError, setAuthError] = useState(null)

  // Single auth gate: useRoom only queries once the anon session exists,
  // so cold invite opens never query as role `anon` (which hides rows via
  // RLS and surfaces as "Room not found" / "Not in this room").
  const { room, players, rounds, votes, rankings, messages, loading, error, live, roomDeleted, refreshMessages, refreshAll } = useRoom(authReady ? code : null)

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

  // Hard leave on unload: explicit Leave, tab close, AND refresh all
  // delete the player row so the game heals and the crown always passes.
  // Refreshes reclaim their seat via auto-rejoin below (crown stays
  // passed). Beacon failures (crash/kill) fall back to the 90s heartbeat
  // prune. Mobile Safari fires pagehide, not beforeunload.
  const leftRef = useRef(false)
  useEffect(() => {
    const id = room?.id
    if (!id || roomDeleted) return undefined
    function beacon() {
      if (leftRef.current) return
      // Mark my own unload so the next load knows this was a refresh,
      // not a host kick (sessionStorage survives refresh, not new tabs).
      writeFlag(sessionStorage, unloadKey(id))
      leaveRoomBeacon(id)
    }
    window.addEventListener('pagehide', beacon)
    return () => {
      window.removeEventListener('pagehide', beacon)
    }
  }, [room?.id, roomDeleted])

  // Removed-by-host state. Persists across reloads so a kicked-then-
  // refreshed tab shows Rejoin instead of silently auto-rejoining.
  const [kicked, setKicked] = useState(false)
  const [rejoinError, setRejoinError] = useState(null)
  useEffect(() => {
    setKicked(false)
    setRejoinError(null)
  }, [code])

  // Ticker so offline badges go stale without waiting on realtime.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Host kick confirm state (two-tap, no modal).
  const [kickArm, setKickArm] = useState(null)
  const [kickBusy, setKickBusy] = useState(false)

  // Mobile roster: collapsed bar by default, tap to expand the full list.
  const [rosterOpen, setRosterOpen] = useState(false)

  // Auto-rejoin: the unload beacon deletes my row even on refresh, so a
  // mid-game reload reclaims the seat silently with the stored nickname.
  // join_room allows same-user rejoin even mid-game (crown stays passed).
  // A missing row with NO unload flag in this tab session means the host
  // removed me -> kicked screen (with a working Rejoin button) instead.
  const [rejoining, setRejoining] = useState(false)
  const rejoinTriedRef = useRef(null)
  const myPlayer = myUserId ? players.find((p) => p.user_id === myUserId) : null
  useEffect(() => {
    if (!authReady || loading || !room || roomDeleted || error) return
    if (myPlayer || rejoining) return
    // Lobby visitors must confirm their nickname via JoinGate — never
    // auto-join. Mid-game, a missing row means a lost seat, so reclaim it.
    if (room.phase === 'lobby') return
    if (rejoinTriedRef.current === room.id) return
    // Previously removed (flag survives reloads): don't auto-rejoin.
    if (readFlag(localStorage, kickedKey(room.id))) {
      setKicked(true)
      return
    }
    if (!readFlag(sessionStorage, unloadKey(room.id))) {
      writeFlag(localStorage, kickedKey(room.id))
      setKicked(true)
      return
    }
    let nick = ''
    try {
      nick = (localStorage.getItem('vibe-nickname') ?? '').trim().slice(0, 20)
    } catch {
      nick = ''
    }
    if (!nick) return
    rejoinTriedRef.current = room.id
    let cancelled = false
    setRejoining(true)
    supabase.rpc('join_room', { p_code: room.code, p_nickname: nick }).then(({ error: joinErr }) => {
      if (cancelled) return
      setRejoining(false)
      if (!joinErr) {
        clearFlag(sessionStorage, unloadKey(room.id))
        refreshAll()
      }
    })
    return () => {
      cancelled = true
    }
  }, [authReady, loading, room, roomDeleted, error, myPlayer, rejoining, refreshAll])

  // Heartbeat liveness: refreshes keep beating (seat kept); closed tabs go
  // quiet and the server prunes them after ~90s.
  useHeartbeat(room?.id, !!myPlayer && !roomDeleted)

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
  const me = myPlayer
  const isHost = !!me && me.id === room.host_id

  // Host removed me: dedicated screen with immediate Rejoin (kicks no
  // longer ban). The unload flag is absent, so auto-rejoin stood down.
  if (kicked) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <Background />
        <div className="relative grid max-w-sm justify-items-center gap-5 text-center">
          <VibeLogo size="sm" />
          <div>
            <p className="text-lg font-semibold">Removed by host</p>
            <p className="mt-1 text-sm text-zinc-500">
              The host removed you from room {room.code}. You can rejoin right away.
            </p>
          </div>
          {rejoinError && <p className="w-full rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{rejoinError}</p>}
          <div className="grid w-full gap-2">
            <button
              onClick={rejoinManually}
              disabled={rejoining}
              className="btn-primary flex h-12 items-center justify-center rounded-full px-7 text-sm font-bold disabled:opacity-50"
            >
              {rejoining ? 'Rejoining…' : 'Rejoin room'}
            </button>
            <Link
              to="/"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/10 px-7 text-sm font-semibold text-zinc-300 transition active:scale-[0.98] lg:hover:bg-white/5"
            >
              Back home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Manual rejoin after removal (or after a refresh left no nickname to
  // reclaim with): clears the flags and rejoins with the stored nickname.
  // No stored nickname -> fall through to the JoinGate form below.
  async function rejoinManually() {
    if (!room || rejoining) return
    let nick = ''
    try {
      nick = (localStorage.getItem('vibe-nickname') ?? '').trim().slice(0, 20)
    } catch {
      nick = ''
    }
    if (!nick) {
      setKicked(false)
      return
    }
    setRejoining(true)
    setRejoinError(null)
    const { error: joinErr } = await supabase.rpc('join_room', { p_code: room.code, p_nickname: nick })
    setRejoining(false)
    if (!joinErr) {
      clearFlag(localStorage, kickedKey(room.id))
      clearFlag(sessionStorage, unloadKey(room.id))
      rejoinTriedRef.current = null
      setKicked(false)
      refreshAll()
    } else {
      setRejoinError(joinErr.message)
    }
  }

  // Invite-link visitor with no player row: nickname gate first.
  // Refreshes land here after the unload beacon and are reclaimed by the
  // auto-rejoin above; reaching this gate mid-game otherwise means a
  // genuinely new session, which JoinGate handles.
  if (!me) {
    if (rejoining) {
      return (
        <div className="relative flex min-h-[100dvh] items-center justify-center bg-zinc-950">
          <Background />
          <div className="relative px-6">
            <VibeLoader message="Rejoining room" sub={code ? `Room ${String(code).toUpperCase()}` : 'Finding your vibe'} />
          </div>
        </div>
      )
    }
    return <JoinGate room={room} onJoined={() => { setKicked(false); clearFlag(localStorage, kickedKey(room.id)); rejoinTriedRef.current = null; refreshAll() }} />
  }

  // Host kick (two-tap confirm, no modal): removal only, they may rejoin.
  async function kick(p) {
    if (!room) return
    if (kickArm !== p.id) {
      setKickArm(p.id)
      setTimeout(() => setKickArm((cur) => (cur === p.id ? null : cur)), 3000)
      return
    }
    setKickArm(null)
    setKickBusy(true)
    const { error: kickErr } = await supabase.rpc('kick_player', { p_room_id: room.id, p_player_id: p.id })
    setKickBusy(false)
    if (kickErr) pushToast('leave', `Couldn't remove ${p.nickname}`)
    else pushToast('leave', `Removed ${p.nickname} — they can rejoin with the link`)
  }

  const inviteLink = `${window.location.origin}/room/${room.code}`
  const spotsLeft = Math.max(0, MAX_PLAYERS - players.length)

  // Roster helpers (mobile bar + shared rows).
  const isLobby = room.phase === 'lobby'
  const readyCount = players.filter((p) => p.id === room.host_id || p.is_ready).length
  function isOffline(p) {
    if (!p.last_seen) return false
    const seen = new Date(p.last_seen).getTime()
    return Number.isFinite(seen) && now - seen > OFFLINE_MS
  }
  const awayCount = players.filter(isOffline).length
  function rowProps(p) {
    const isMe = p.user_id === myUserId
    return {
      p,
      isMe,
      showReady: isLobby && p.id !== room.host_id,
      isHostRow: p.id === room.host_id,
      offline: isOffline(p),
      canKick: isHost && !isMe,
      armed: kickArm === p.id,
      kickBusy,
      onKick: () => kick(p),
    }
  }

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
            <VibeLogo size="sm" />
            <div className="ml-auto flex items-center gap-1">
              <VolumeControl iconClass={iconBtn} />
              <button
                onClick={async () => {
                  leftRef.current = true
                  try {
                    await supabase.rpc('leave_room', { p_room_id: room.id })
                  } catch {
                    /* going home anyway */
                  }
                  window.location.href = '/'
                }}
                aria-label="Leave room"
                className={`${iconBtn} px-3 text-sm`}
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Leave</span>
              </button>
            </div>
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

        {/* Roster: compact bar + expandable list on mobile, sidebar on desktop */}
        <aside className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-1">
          <div className="lg:hidden">
            <button
              onClick={() => setRosterOpen((v) => !v)}
              aria-expanded={rosterOpen}
              aria-label={rosterOpen ? 'Hide player list' : `Show player list, ${players.length} in room`}
              className="flex min-h-[3rem] w-full items-center gap-3 rounded-2xl bg-zinc-900 px-3 py-2 text-left ring-1 ring-inset ring-white/[0.06] transition active:scale-[0.99]"
            >
              <span className="flex shrink-0 -space-x-2">
                {players.slice(0, 5).map((p) => (
                  <span key={p.id} className="rounded-full ring-2 ring-zinc-950">
                    <Avatar name={p.nickname} size="sm" />
                  </span>
                ))}
                {players.length > 5 && (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-[11px] font-bold text-zinc-200 ring-2 ring-zinc-950">
                    +{players.length - 5}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                {players.length} player{players.length === 1 ? '' : 's'}
                {isLobby && (
                  <span className="font-normal text-zinc-500"> · {readyCount}/{players.length} ready</span>
                )}
                {awayCount > 0 && (
                  <span className="font-normal text-zinc-500"> · {awayCount} away</span>
                )}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${rosterOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {rosterOpen && (
              <ul className="mt-2 grid gap-1.5">
                {players.map((p) => (
                  <PlayerRow key={p.id} {...rowProps(p)} />
                ))}
              </ul>
            )}
          </div>

          <div className="mb-3 hidden items-baseline justify-between lg:flex">
            <p className="text-sm font-medium text-zinc-300">Players</p>
            <p className="text-xs tabular-nums text-zinc-600">
              {players.length} of {MAX_PLAYERS}
            </p>
          </div>
          <ul className="hidden lg:sticky lg:top-4 lg:grid lg:gap-0.5">
            {players.map((p) => (
              <PlayerRow key={p.id} {...rowProps(p)} />
            ))}
          </ul>
          {room.phase === 'lobby' && (
            <p className="mt-4 hidden text-xs leading-relaxed text-zinc-600 lg:block">
              {spotsLeft > 0 ? `${spotsLeft} spots open. ` : 'Room is full. '}
              The game starts with at least 3 players.
            </p>
          )}
          <p className="mt-3 break-words text-[11px] leading-relaxed text-zinc-600 lg:mt-4">
            Heads-up: closing or refreshing removes you from the game. Same-device refresh rejoins automatically, but host passes on.
          </p>
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