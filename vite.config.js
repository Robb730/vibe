import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

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

async function fetchUpstream(upstream) {
  // One retry for flaky mobile/shared networks; mirrors api/itunes-search.js.
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      const r = await fetch(upstream, { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (r.ok) return await r.json()
      lastErr = new Error(`upstream ${r.status}`)
    } catch (err) {
      lastErr = err
    } finally {
      clearTimeout(timeout)
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400))
  }
  throw lastErr ?? new Error('upstream failed')
}

// Dev-only emulation of the Vercel /api/itunes-search function so phone
// testing via `npm run dev -- --host 0.0.0.0` gets the same JSON contract
// as production (plain Vite has no serverless functions; without this the
// dev server answers /api with the function's JS source as text).
// Production is unaffected: Vercel serves /api via api/itunes-search.js.
function itunesDevProxy() {
  return {
    name: 'itunes-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        let pathname = ''
        let search = null
        try {
          const url = new URL(req.url, 'http://localhost')
          pathname = url.pathname
          search = url.searchParams
        } catch {
          return next()
        }
        if (pathname !== '/api/itunes-search') return next()
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        const term = String(search.get('term') ?? '').trim()
        const limit = Math.min(Math.max(parseInt(search.get('limit') ?? DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
        if (term.length < 2) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ results: [] }))
          return
        }
        const upstream =
          `${ITUNES_BASE}?term=${encodeURIComponent(term)}` +
          `&media=music&entity=song&limit=${limit}`
        try {
          const json = await fetchUpstream(upstream)
          const results = (json.results ?? []).filter((t) => t.previewUrl && t.trackId).map(pickTrack)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
          res.end(JSON.stringify({ results }))
        } catch (err) {
          const timedOut = err?.name === 'AbortError'
          res.statusCode = 504
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({ error: timedOut ? 'Song search timed out. Try again.' : 'Song search unreachable. Try again.' })
          )
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), itunesDevProxy()],
})
