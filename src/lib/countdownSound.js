// Game sound effects — user-provided files in public/sounds/.
//   public/sounds/prompts-open.mp3  (Go! / prompts open)
//   public/sounds/songs-open.mp3    (music stage entry)
// Missing files = silent, no errors. Browsers may block audio until the
// user has tapped once; failures are swallowed on purpose.

const PROMPTS_OPEN_SRC = '/sounds/prompts-open.mp3'
const SONGS_OPEN_SRC = '/sounds/songs-open.mp3'

const cache = new Map()
// Per-src last-play timestamps: swallows double-fires (StrictMode,
// realtime re-emits) while still allowing genuine replays minutes later.
const lastPlayed = new Map()
const MIN_REPLAY_MS = 2000

function shouldPlay(src) {
  const now = Date.now()
  const last = lastPlayed.get(src) ?? 0
  if (now - last < MIN_REPLAY_MS) return false
  lastPlayed.set(src, now)
  return true
}

function loadAudio(src) {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') return null
  if (!cache.has(src)) {
    try {
      const el = new window.Audio(src)
      el.preload = 'auto'
      cache.set(src, el)
    } catch {
      return null
    }
  }
  return cache.get(src) ?? null
}

function playSrc(src) {
  try {
    if (!shouldPlay(src)) return
    const base = loadAudio(src)
    if (!base) return
    // Clone so rapid triggers don't cut each other off.
    const el = base.cloneNode()
    el.play()?.catch?.(() => {})
  } catch {
    // silent fallback
  }
}

// Countdown ticks: no tick files provided, so 3-2-1 stays silent and
// Go! plays prompts-open.
export function playCountdownSound(kind) {
  if (kind === 'go') playSrc(PROMPTS_OPEN_SRC)
}

export function playPhaseSound(phase) {
  if (phase === 'songs') playSrc(SONGS_OPEN_SRC)
  else if (phase === 'prompts') playSrc(PROMPTS_OPEN_SRC)
}

export const GAME_SOUND_FILES = {
  promptsOpen: 'public/sounds/prompts-open.mp3',
  songsOpen: 'public/sounds/songs-open.mp3',
}
