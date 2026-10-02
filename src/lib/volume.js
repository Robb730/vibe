// Clip volume (song clips only — phase chimes stay full volume).
// Persisted per device in localStorage, default 100%. Tiny pub/sub so the
// header mixer UI and every <audio> element stay in sync.

const KEY = 'vibe-volume'
const DEFAULT = 1

const listeners = new Set()

function clamp01(n) {
  if (!Number.isFinite(n)) return DEFAULT
  return Math.min(1, Math.max(0, n))
}

export function getVolume() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEFAULT
    return clamp01(parseFloat(raw))
  } catch {
    return DEFAULT
  }
}

export function setVolume(v) {
  const next = clamp01(v)
  try {
    localStorage.setItem(KEY, String(next))
  } catch {
    /* storage blocked: still apply in-memory for this session */
  }
  for (const fn of listeners) {
    try {
      fn(next)
    } catch {
      /* one bad listener must not break the rest */
    }
  }
}

export function subscribeVolume(fn) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
