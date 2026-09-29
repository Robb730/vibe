// iTunes Search API — free, no key, CORS-friendly (unlike Deezer).
// https://itunes.apple.com/search?term=...&media=music&entity=song&limit=10

export async function searchSongs(term, limit = 10) {
  const q = encodeURIComponent(term.trim())
  if (!q) return []
  const res = await fetch(
    `https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=${limit}`
  )
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`)
  const json = await res.json()
  // Filter out tracks with no 30s preview — unplayable for the game.
  return (json.results ?? []).filter((t) => t.previewUrl);
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
