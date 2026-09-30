// Same-origin proxy for iTunes Search.
// Why: iOS Safari / iPads often surface direct cross-origin fetch to
// itunes.apple.com as generic `TypeError: Load failed` (ITP, Private Relay,
// content blockers, carrier-NAT rate limits). Same-origin avoids CORS entirely.
//
// GET /api/itunes-search?term=adele&limit=8
// -> { results: [{ trackId, trackName, artistName, artworkUrl60, artworkUrl100, previewUrl }] }

const ITUNES_BASE = 'https://itunes.apple.com/search'
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 8
const UPSTREAM_TIMEOUT_MS = 8000

function pickTrack(t) {
  return {
    trackId: t.trackId,
    trackName: t.trackName,
    artistName: t.artistName,
    artworkUrl60: t.artworkUrl60,
    artworkUrl100: t.artworkUrl100,
    previewUrl: t.previewUrl,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const term = String(req.query?.term ?? '').trim()
  const limit = Math.min(
    Math.max(parseInt(req.query?.limit ?? DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )

  if (term.length < 2) return res.status(200).json({ results: [] })

  const upstream =
    `${ITUNES_BASE}?term=${encodeURIComponent(term)}` +
    `&media=music&entity=song&limit=${limit}`

  // One retry for flaky mobile/shared networks before giving up.
  let upstreamRes = null
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      upstreamRes = await fetch(upstream, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (upstreamRes.ok) break
      lastErr = new Error(`upstream ${upstreamRes.status}`)
      upstreamRes = null
    } catch (err) {
      lastErr = err
      upstreamRes = null
    } finally {
      clearTimeout(timeout)
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400))
  }

  if (!upstreamRes) {
    const timedOut = lastErr?.name === 'AbortError'
    const upstreamStatus = /upstream (\d+)/.exec(lastErr?.message ?? '')?.[1]
    if (upstreamStatus) {
      return res.status(502).json({ error: `Song search upstream failed: ${upstreamStatus}` })
    }
    return res.status(504).json({
      error: timedOut ? 'Song search timed out. Try again.' : 'Song search unreachable. Try again.',
    })
  }

  try {
    const json = await upstreamRes.json()
    const results = (json.results ?? [])
      .filter((t) => t.previewUrl && t.trackId)
      .map(pickTrack)

    // Cache shared searches briefly to reduce Apple rate-limit hits
    // when many players on the same WiFi search at once.
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
    return res.status(200).json({ results })
  } catch {
    return res.status(502).json({ error: 'Song search upstream failed: bad response' })
  }
}
