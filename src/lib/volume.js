// Master volume for all game audio (song clips, previews, chimes).
// Persisted per device in localStorage, default 100%. Tiny pub/sub so the
// header mixer UI and every <audio> element stay in sync.
//
// iOS Safari ignores HTMLMediaElement.volume in JS (hardware buttons own
// it), so the mixer ALSO drives a master Web Audio GainNode. Game audio
// elements are routed source -> masterGain -> destination once the context
// is running (i.e. after a user gesture); before that they play direct
// with element.volume as fallback.

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
  // Live-apply to the master gain (smooth, no zipper clicks).
  try {
    if (master && ctx) {
      if (typeof master.gain.setTargetAtTime === 'function') {
        master.gain.setTargetAtTime(next, ctx.currentTime, 0.01)
      } else {
        master.gain.value = next
      }
    }
  } catch {
    /* context gone: element fallback in syncElementVolume covers it */
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

// ---------- Master gain stage (Web Audio) ----------

let ctx = null
let master = null
const sources = new WeakMap()

function ensureMaster() {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  try {
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = getVolume()
    master.connect(ctx.destination)
  } catch {
    ctx = null
    master = null
    return null
  }
  return ctx
}

// Call from user gestures (tap/click/input): creates + resumes the context.
// Never call this outside a gesture path — a suspended context would both
// warn in the console and swallow routed audio.
export function unlockMasterAudio() {
  try {
    const c = ensureMaster()
    if (c && typeof c.resume === 'function') {
      const pr = c.resume()
      if (pr && typeof pr.catch === 'function') pr.catch(() => {})
    }
  } catch {
    /* no Web Audio: element.volume fallback stays in charge */
  }
}

// Route one <audio> element through the master gain. No-op until the
// context is running; safe to call on every play (WeakMap-guarded, one
// MediaElementSource per element).
export function routeElement(el) {
  if (!el || !ctx || !master) return
  try {
    if (ctx.state !== 'running') return
  } catch {
    return
  }
  if (sources.has(el)) return
  try {
    const src = ctx.createMediaElementSource(el)
    src.connect(master)
    sources.set(el, src)
    // One-shot elements (chime clones): release the graph when done.
    el.addEventListener(
      'ended',
      () => {
        try {
          src.disconnect()
        } catch {
          /* ignore */
        }
        sources.delete(el)
      },
      { once: true },
    )
  } catch {
    /* already routed elsewhere: leave the element alone */
  }
}

// Single volume truth per element: routed elements obey the master gain
// (element stays at 1 to avoid double attenuation), direct elements use
// the property (desktop + pre-gesture fallback).
export function syncElementVolume(el) {
  if (!el) return
  try {
    el.volume = sources.has(el) ? 1 : getVolume()
  } catch {
    /* iOS ignores it: master gain covers routed playback */
  }
}
