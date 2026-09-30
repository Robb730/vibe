// Song search via same-origin Vercel proxy, with direct-iTunes fallback for
// local `vite dev` (where /api doesn't exist).
// iOS Safari surfaces cross-origin network failures as generic
// `TypeError: Load failed`, so we map those to a friendly retry message.

const PROXY_TIMEOUT_MS = 10000
const DIRECT_TIMEOUT_MS = 10000

function isNetworkError(err) {
  const msg = String(err?.message ?? '').toLowerCase()
  return (
    err?.name === 'AbortError' ||
    err instanceof TypeError ||
    msg.includes('load failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed')
  )
}

function toFriendlyError(err, where) {
  if (err?.name === 'AbortError') {
    return new Error('Search timed out. Check your connection and try again.')
  }
  if (isNetworkError(err)) {
    // Log the raw error once for diagnostics; show friendly text in UI.
    console.warn(`[song-search] ${where} network failure:`, err?.message ?? err)
    return new Error("Couldn't reach song search. Check your connection and tap Retry.")
  }
  return err instanceof Error ? err : new Error('Song search failed. Try again.')
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    return res
  } finally {
    clearTimeout(t)
  }
}

function normalizeTracks(json) {
  const list = Array.isArray(json) ? json : (json.results ?? [])
  return list.filter((t) => t.previewUrl && t.trackId)
}

async function searchViaProxy(term, limit) {
  const url = `/api/itunes-search?term=${encodeURIComponent(term)}&limit=${limit}`
  const res = await fetchJsonWithTimeout(url, PROXY_TIMEOUT_MS)
  if (res.status === 404) {
    // Local `vite dev` without `vercel dev` — signal fallback.
    const err = new Error('proxy-missing')
    err.code = 'proxy-missing'
    throw err
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.error ?? ''
    } catch {
      // ignore JSON parse failure, use status below
    }
    throw new Error(detail || `Song search failed (${res.status}). Try again.`)
  }
  return normalizeTracks(await res.json())
}

async function searchDirect(term, limit) {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
    `&media=music&entity=song&limit=${limit}`
  const res = await fetchJsonWithTimeout(url, DIRECT_TIMEOUT_MS)
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`)
  return normalizeTracks(await res.json())
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function searchSongs(term, limit = 8) {
  const clean = term.trim()
  if (!clean) return []
  const safeLimit = Math.min(Math.max(limit || 8, 1), 8)

  // 1) Proxy first (same-origin: no CORS, no iOS "Load failed" on preflight).
  try {
    return await searchViaProxy(clean, safeLimit)
  } catch (proxyErr) {
    const missing = proxyErr?.code === 'proxy-missing'
    if (!missing && !isNetworkError(proxyErr)) throw proxyErr
    if (!missing) console.warn('[song-search] proxy failed, falling back to direct:', proxyErr?.message)

    // 2) Fallback: direct iTunes (covers `vite dev`), with one retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await searchDirect(clean, safeLimit)
      } catch (directErr) {
        const last = attempt === 1
        if (!last && isNetworkError(directErr)) {
          await sleep(500)
          continue
        }
        throw toFriendlyError(directErr, last ? 'direct-retry' : 'direct')
      }
    }
    throw toFriendlyError(new TypeError('Load failed'), 'direct-exhausted')
  }
}

export function trackToGameTrack(t) {
  return {
    track_id: String(t.trackId),
    title: t.trackName,
    artist: t.artistName,
    artwork_url: t.artworkUrl100?.replace('100x100', '300x300') ?? t.artworkUrl100,
    preview_url: t.previewUrl,
  }
}
