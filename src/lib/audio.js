// Global clip playback for the song phases (guess + rank).
//
// One module-level <audio> element plays every clip, so an iOS playback
// token granted to it (via any in-gesture play) stays valid for all later
// timer-driven plays in both game modes. Importing this module installs a
// one-time first-gesture unlock.
//
// Mobile browsers (especially iOS Safari) reject timer-driven unmuted
// play() with NotAllowedError until the user has gestured once per page.
// Plain <audio> elements throughout (playback category: robust to the
// silent switch, unlike Web Audio).

import { routeElement, syncElementVolume, unlockMasterAudio } from './volume.js'

const UNLOCK_CHIME_SRC = '/sounds/songs-open.mp3'

let el = null
let gen = 0
let pauseTimer = null
let playingHandler = null
let unlocked = false

function ensureEl() {
  if (el) return el
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') return null
  try {
    el = new window.Audio()
    el.preload = 'auto'
  } catch {
    return null
  }
  return el
}

function clearTimer() {
  if (pauseTimer) {
    clearTimeout(pauseTimer)
    pauseTimer = null
  }
}

function detachPlaying() {
  if (el && playingHandler) {
    try {
      el.removeEventListener('playing', playingHandler)
    } catch {
      /* ignore */
    }
    playingHandler = null
  }
}

export function stopClip() {
  gen += 1
  clearTimer()
  detachPlaying()
  if (!el) return
  try {
    el.pause()
  } catch {
    /* not playable yet */
  }
}

// Play one 10s clip from song.clip_start. Seeks only after metadata is
// ready (synchronous seeks fail on cellular Safari). Reports blocked vs
// broken vs actually-playing via callbacks so callers show "tap anywhere"
// vs "no preview" and clear the pill the moment sound starts.
// Returns false when there is nothing to play.
export function playClip(song, { onBlocked, onBroken, onPlaying } = {}) {
  const target = ensureEl()
  if (!target || !song?.preview_url) return false
  gen += 1
  const myGen = gen
  clearTimer()
  detachPlaying()
  const alive = () => myGen === gen
  const startAt = song.clip_start ?? 0

  function finish() {
    clearTimer()
    pauseTimer = setTimeout(() => {
      if (alive()) {
        try {
          target.pause()
        } catch {
          /* ignore */
        }
      }
    }, 10_000)
  }

  function begin() {
    if (!alive()) return
    try {
      target.currentTime = startAt
    } catch {
      /* seek failed: play from 0 rather than staying silent */
    }
    playingHandler = () => {
      if (!alive()) return
      onPlaying?.()
    }
    try {
      target.addEventListener('playing', playingHandler)
    } catch {
      /* ignore */
    }
    let pr = null
    try {
      // Master volume: route through the gain stage when it's running
      // (iOS-proof), otherwise fall back to the element property.
      routeElement(target)
      syncElementVolume(target)
      pr = target.play()
    } catch {
      detachPlaying()
      onBlocked?.()
      return
    }
    if (pr && typeof pr.catch === 'function') {
      pr.catch((err) => {
        if (!alive()) return
        detachPlaying()
        if (err?.name === 'NotAllowedError') onBlocked?.()
        else onBroken?.()
      })
    }
    finish()
  }

  let abs = song.preview_url
  try {
    abs = new URL(song.preview_url, window.location.href).href
  } catch {
    /* relative URL: compare raw */
  }
  // Same clip already loaded: seek + play synchronously, which keeps the
  // iOS gesture token when called from a tap handler.
  try {
    if (target.src === abs && target.readyState >= 1) {
      begin()
      return true
    }
  } catch {
    /* fall through to reload */
  }
  try {
    target.src = song.preview_url
    target.load()
  } catch {
    onBroken?.()
    return false
  }
  let done = false
  const cleanup = () => {
    clearTimeout(metaTimer)
    try {
      target.removeEventListener('loadedmetadata', onMeta)
      target.removeEventListener('error', onErr)
    } catch {
      /* ignore */
    }
  }
  const onMeta = () => {
    if (done) return
    done = true
    cleanup()
    begin()
  }
  const onErr = () => {
    if (done) return
    done = true
    cleanup()
    if (alive()) onBroken?.()
  }
  const metaTimer = setTimeout(() => {
    if (done) return
    done = true
    cleanup()
    begin()
  }, 3000)
  try {
    target.addEventListener('loadedmetadata', onMeta)
    target.addEventListener('error', onErr)
  } catch {
    /* ignore */
  }
  return true
}

// Genuine in-gesture playback on the shared element: grants iOS the token
// for all later timer-driven plays. Falls back to the bundled chime when
// the element has no source yet.
function unlockNow() {
  const target = ensureEl()
  if (!target) return
  try {
    if (!target.src) {
      target.src = UNLOCK_CHIME_SRC
      try {
        target.load()
      } catch {
        /* ignore */
      }
    }
    const pr = target.play()
    if (pr && typeof pr.then === 'function') {
      pr.then(() => {
        try {
          target.pause()
        } catch {
          /* ignore */
        }
      }).catch(() => {})
    } else {
      try {
        target.pause()
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* element not ready: blocked UI covers this path */
  }
}

// Installed once at import: the first real user gesture anywhere unlocks
// audio for the whole session (both game modes, no modal needed).
if (typeof window !== 'undefined') {
  const unlockOnce = () => {
    if (unlocked) return
    unlocked = true
    unlockMasterAudio()
    unlockNow()
    window.removeEventListener('pointerdown', unlockOnce)
    window.removeEventListener('touchend', unlockOnce)
  }
  window.addEventListener('pointerdown', unlockOnce)
  window.addEventListener('touchend', unlockOnce)
}
