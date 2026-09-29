import { ArrowRight, Link2, Loader2, Music, Pencil, Play, Trophy, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, ensureAnonSession } from '../lib/supabase.js'
import VibeLogo from '../components/VibeLogo.jsx'
import Avatar from '../components/Avatar.jsx'
import Background from '../components/Background.jsx'
import AuthBanner from '../components/AuthBanner.jsx'

const STEPS = [
  { n: '01', icon: Link2, title: 'Create / Join', desc: 'Start a room or join with a code. No signup required.', color: 'bg-violet-600' },
  { n: '02', icon: Pencil, title: 'Write Prompts', desc: 'Everyone submits a prompt (anonymously).', color: 'bg-pink-600' },
  { n: '03', icon: Music, title: 'Pick Songs', desc: 'Answer every prompt with a song and a 10s clip.', color: 'bg-sky-600' },
  { n: '04', icon: Users, title: 'Guess', desc: 'Listen, vote, and guess who picked it.', color: 'bg-emerald-600' },
  { n: '05', icon: Trophy, title: 'See the Results', desc: 'Reveal the picker, score points, and see the leaderboard.', color: 'bg-amber-600' },
]

export default function Home() {
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [mode, setMode] = useState(null) // 'create' | 'join' | null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [authError, setAuthError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    ensureAnonSession().then(setAuthError)
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    if (!nickname.trim()) return setError('Enter a nickname first.')
    setBusy(true)
    setError(null)
    try {
      const { data, error } = await supabase.rpc('create_room', { p_nickname: nickname.trim() })
      if (error) throw error
      const roomCode = typeof data === 'string' ? data : data?.code
      navigate(`/room/${roomCode}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin(e) {
    e.preventDefault()
    if (!nickname.trim() || !code.trim()) return setError('Nickname + room code required.')
    setBusy(true)
    setError(null)
    try {
      const { error } = await supabase.rpc('join_room', {
        p_code: code.trim().toUpperCase(),
        p_nickname: nickname.trim(),
      })
      if (error) throw error
      navigate(`/room/${code.trim().toUpperCase()}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07070d]">
      <Background />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <VibeLogo />
        <nav className="hidden items-center gap-8 text-sm text-zinc-300 md:flex">
          <a href="#how" className="hover:text-white">How It Works</a>
          <a href="#how" className="hover:text-white">Features</a>
          <a href="#how" className="hover:text-white">About</a>
        </nav>
        <button
          onClick={() => setMode('create')}
          className="btn-light flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold"
        >
          Play Now <ArrowRight className="h-4 w-4" />
        </button>
      </header>

      <div className="relative px-6 pt-2">
        <AuthBanner authError={authError} />
      </div>

      {/* Hero */}
      <main className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-16 pt-10 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-400">
            The music <span className="rounded border border-zinc-700 px-1">+</span> prompt guessing game
          </p>
          <h1 className="font-display mt-4 text-4xl font-black leading-[1.02] sm:text-5xl md:text-6xl">
            Same vibes.
            <br />
            <span className="text-gradient">Different minds.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-zinc-400">
            Write a prompt. Pick a song. Guess who chose it. It&apos;s a simple
            idea, but it leads to great conversations, unexpected picks, and a
            lot of “wait, really?” moments.
          </p>
          <div className="mt-8 grid gap-3">
            <button
              onClick={() => setMode('create')}
              className="btn-light flex w-fit items-center gap-3 rounded-full px-7 py-3.5 font-bold"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-white"><Play className="ml-0.5 h-3 w-3" /></span>
              Create a Room <ArrowRight className="h-4 w-4" />
            </button>
            <button onClick={() => setMode('join')} className="flex w-fit items-center gap-2 px-1 py-2 text-sm font-semibold text-zinc-200 hover:text-white">
              <Users className="h-4 w-4" /> Join a Room <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Floating mock cards */}
        <div className="relative hidden h-[480px] select-none lg:block" aria-hidden>
          <div className="animate-floaty absolute left-6 top-2 w-64 rotate-[-6deg] rounded-3xl border border-white/10 bg-[#12121e]/95 p-4 shadow-2xl" style={{ '--tilt': '-6deg' }}>
            <div className="text-center">
              <VibeLogo size="sm" />
              <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-zinc-500">Room code</p>
              <p className="mx-auto mt-1 w-fit rounded-full bg-white/5 px-4 py-1 font-mono text-sm tracking-[0.4em]">K7F2Q</p>
            </div>
            <ul className="mt-4 grid gap-2.5 text-sm">
              {['You', 'Alex', 'Mika', 'Jesse'].map((n) => (
                <li key={n} className="flex items-center gap-2.5">
                  <Avatar name={n} size="sm" />
                  <span className="font-semibold">{n}</span>
                  {n === 'You' && <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px]">Host</span>}
                </li>
              ))}
            </ul>
            <div className="btn-primary mt-4 rounded-full py-2.5 text-center text-sm font-bold">Start Game</div>
          </div>

          <div className="animate-floaty absolute right-0 top-10 w-64 rotate-[5deg] rounded-3xl border border-white/10 bg-[#12121e]/95 p-4 shadow-2xl" style={{ '--tilt': '5deg', animationDelay: '-2s' }}>
            <p className="text-xs text-zinc-400">Your Prompt</p>
            <p className="font-semibold">watching the sunset</p>
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white/5 p-2.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-pink-500"><Music className="h-5 w-5 text-white" /></span>
              <div>
                <p className="text-sm font-bold">golden hour</p>
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">JVKE</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-500">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-black"><Play className="ml-px h-3 w-3" /></span>
              <span>0:40 / 0:10</span>
              <span className="ml-auto">0:00 / 0:30</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400" />
            </div>
          </div>

          <div className="animate-floaty absolute bottom-2 right-10 w-60 rotate-[-4deg] rounded-3xl border border-white/10 bg-[#12121e]/95 p-4 shadow-2xl" style={{ '--tilt': '-4deg', animationDelay: '-4s' }}>
            <p className="text-xs font-semibold">Who picked this? <span className="float-right text-zinc-500">?</span></p>
            <div className="mt-3 flex items-center justify-between">
              {['Alex', 'Mika', 'Jesse', 'You'].map((n) => (
                <span key={n} className="grid justify-items-center gap-1 text-[10px] text-zinc-400">
                  <Avatar name={n} size="sm" />
                  {n}
                </span>
              ))}
            </div>
          </div>

          <p className="handwritten absolute bottom-16 right-[-10px] text-right text-lg leading-tight text-zinc-400">
            good<br />music.<br />better<br />people.
          </p>
        </div>

        {/* Mobile join shortcut */}
        <div className="grid gap-3 lg:hidden">
          <div className="glass rounded-3xl p-4">
            <p className="text-sm font-bold">Try it now — no signup</p>
            <p className="mt-1 text-xs text-zinc-400">Create a room and share the link with 2+ friends.</p>
          </div>
        </div>
      </main>

      {/* How it works */}
      <section id="how" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <div>
            <h2 className="font-display text-3xl font-black">How It Works</h2>
            <p className="mt-2 text-sm text-zinc-400">7 simple steps. Endless fun.</p>
            <p className="handwritten mt-6 text-2xl text-zinc-500">∼∼</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-3xl border border-white/5 bg-white/[0.03] p-4">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-white ${s.color}`}><s.icon className="h-4 w-4" /></span>
                <p className="mt-3 font-mono text-xs text-zinc-500">{s.n}</p>
                <p className="mt-1 text-sm font-bold">{s.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modal */}
      {mode && (
        <div className="overlay-fade fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" onClick={() => setMode(null)}>
          <div key={mode} className="modal-pop glass-deep w-full max-w-sm rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <VibeLogo size="sm" />
              <button onClick={() => setMode(null)} aria-label="Close" className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <h3 className="font-display mt-4 text-xl font-black">{mode === 'create' ? 'Create a room' : 'Join a room'}</h3>
            <p className="mt-1 text-xs text-zinc-400">No signup — just a nickname. 3+ players to start.</p>
            <form onSubmit={mode === 'create' ? handleCreate : handleJoin} className="mt-4 grid gap-3">
              <label className="grid gap-1">
                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Nickname</span>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={20}
                  placeholder="e.g. Robb"
                  autoFocus
                  className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-violet-500"
                />
              </label>
              {mode === 'join' && (
                <label className="grid gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Room code</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    maxLength={5}
                    placeholder="K7F2Q"
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-center font-mono uppercase tracking-[0.4em] outline-none focus:border-violet-500"
                  />
                </label>
              )}
              {error && <p className="rounded-2xl bg-red-950/80 p-3 text-xs text-red-300">{error}</p>}
              <button disabled={busy} className="btn-primary flex items-center justify-center gap-2 rounded-full py-3 font-bold disabled:opacity-50">
                {busy ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {mode === 'create' ? 'Creating room' : 'Joining room'}<span className="reveal-dots" /></>
                ) : (
                  <>{mode === 'create' ? 'Create room' : 'Join room'} <ArrowRight className="h-4 w-4" /></>
                )}
              </button>
              <button type="button" onClick={() => setMode(mode === 'create' ? 'join' : 'create')} className="text-center text-xs text-zinc-400 hover:text-white">
                {mode === 'create' ? 'Have a code? Join instead' : 'No code? Create instead'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
