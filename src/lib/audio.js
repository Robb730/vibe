import { useEffect, useRef } from 'react'

// Shared clip playback for the song phases (guess + rank).
// Mobile browsers (especially iOS Safari) reject timer-driven unmuted
// play() with NotAllowedError until the user has gestured once per page.
// So: unlock on the first gesture with a REAL source (empty-element plays
// don't reliably grant the token), then every later timed play is allowed.
// While blocked, ANY natural tap retries the current clip in-gesture —
// no dedicated sound button anywhere.
//
// Plain <audio> elements throughout (playback category: robust to the
// silent switch, unlike Web Audio).

const genMap = new WeakMap()
const timerMap = new WeakMap()

function clearTimer(el) {
  const t = timerMap.get(el)
  if (t) {
    clearTimeout(t)
    timerMap.delete(el)
  }
}

export function stopClip(el) {
  if (!el) return
  genMap.set(el, (genMap.get(el) ?? 0) + 1)
  clearTimer(el)
  try {
    el.pause()
  } catch {
    /* not playable yet */
  }
}

// Play one 10s clip from song.clip_start. Seeks only after metadata is
// ready (synchronous seeks fail on cellular Safari); reports blocked vs
// broken via callbacks so callers show "tap anywhere" vs "no preview".
// Returns false when there is nothing to play.
export function playClip(el, song, { onBlocked, onBroken } = {}) {
  if (!el || !song?.preview_url) return false
  const gen = (genMap.get(el) ?? 0) + 1
  genMap.set(el, gen)
  clearTimer(el)
  const startAt = song.clip_start ?? 0
  const alive = () => genMap.get(el) === gen

  function finish() {
    clearTimer(el)
    timerMap.set(
      el,
      setTimeout(() => {
        if (alive()) {
          try {
            el.pause()
          } catch {
            /* ignore */
          }
        }
      }, 10_000)
    )
  }

  function begin() {
    if (!alive()) return
    try {
      el.currentTime = startAt
    } catch {
      /* seek failed: play from 0 rather than staying silent */
    }
    let pr = null
    try {
      pr = el.play()
    } catch {
      onBlocked?.()
      return
    }
    if (pr && typeof pr.catch === 'function') {
      pr.catch((err) => {
        if (!alive()) return
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
  // Same URL already loaded: seek + play synchronously, which keeps the
  // iOS gesture token when called from a tap handler.
  try {
    if (el.src === abs && el.readyState >= 1) {
      begin()
      return true
    }
  } catch {
    /* fall through to reload */
  }
  try {
    el.src = song.preview_url
    el.load()
  } catch {
    onBroken?.()
    return false
  }
  let done = false
  const cleanup = () => {
    clearTimeout(metaTimer)
    el.removeEventListener('loadedmetadata', onMeta)
    el.removeEventListener('error', onErr)
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
  el.addEventListener('loadedmetadata', onMeta)
  el.addEventListener('error', onErr)
  return true
}

// Synchronous play-then-pause inside a real user gesture. Grants iOS the
// playback token for later timer-driven plays. Pass a preview URL so the
// unlock is genuine playback, not an empty-element play.
export function unlockAudio(el, previewUrl) {
  if (!el) return
  try {
    if (previewUrl && !el.src) {
      el.src = previewUrl
      try {
        el.load()
      } catch {
        /* ignore */
      }
    }
    const pr = el.play()
    if (pr && typeof pr.then === 'function') {
      pr.then(() => {
        try {
          el.pause()
        } catch {
          /* ignore */
        }
      }).catch(() => {})
    } else {
      try {
        el.pause()
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* element not ready: blocked UI covers this path */
  }
}

// One-time first-gesture unlock. getPreviewUrl is read at gesture time so
// callers can supply whatever clip is current (first song of the group).
export function useAudioUnlock(audioRef, getPreviewUrl) {
  const cb = useRef(null)
  useEffect(() => {
    cb.current = getPreviewUrl
  })
  useEffect(() => {
    function unlock() {
      let src = null
      try {
        src = cb.current?.() ?? null
      } catch {
        src = null
      }
      unlockAudio(audioRef.current, src)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchend', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('touchend', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchend', unlock)
    }
  }, [audioRef])
}
