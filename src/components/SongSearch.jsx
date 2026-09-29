import { Loader2, Music, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { searchSongs } from '../lib/itunes.js'

// Live-as-you-type song search with a dropdown. Debounced; keyboard friendly.
export default function SongSearch({ onSelect, autoFocus }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const [active, setActive] = useState(-1)
  const boxRef = useRef(null)
  const listRef = useRef(null)
  const reqId = useRef(0)

  // Debounced live search.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      reqId.current++
      setResults([])
      setError(null)
      setOpen(false)
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      const myReq = ++reqId.current
      try {
        const songs = await searchSongs(q, 8)
        if (reqId.current !== myReq) return // stale response
        setResults(songs)
        setActive(-1)
        setOpen(true)
        setError(null)
      } catch (err) {
        if (reqId.current !== myReq) return
        setError(err.message)
        setOpen(true)
      } finally {
        if (reqId.current === myReq) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  // Close on outside tap + Escape.
  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function pick(t) {
    setOpen(false)
    onSelect(t)
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') return setOpen(false)
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(results[active])
    }
  }

  const showEmpty = !error && !searching && results.length === 0

  return (
    <div ref={boxRef} className="relative">
      <div className="flex h-14 items-center gap-3 rounded-2xl bg-zinc-900 pl-4 pr-2 ring-1 ring-inset ring-white/[0.06] transition focus-within:ring-white/25">
        <Search className="h-5 w-5 shrink-0 text-zinc-500" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="song-results"
          aria-autocomplete="list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => (results.length > 0 || error) && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search a song or artist"
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-zinc-600"
        />
        {searching ? (
          <Loader2 className="mr-2 h-5 w-5 shrink-0 animate-spin text-zinc-500" />
        ) : query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setOpen(false)
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-white/10 lg:hover:bg-white/5 lg:hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {open && (
        <ul
          id="song-results"
          ref={listRef}
          role="listbox"
          className="no-scrollbar absolute inset-x-0 top-full z-50 mt-2 max-h-[55dvh] overflow-y-auto rounded-2xl bg-zinc-900 p-1.5 shadow-2xl shadow-black/60 ring-1 ring-white/10"
        >
          {error ? (
            <li className="px-4 py-5 text-center text-sm text-red-300">{error}</li>
          ) : showEmpty ? (
            <li className="px-4 py-5 text-center text-sm text-zinc-500">No songs found. Try another search.</li>
          ) : (
            results.map((t, i) => (
              <li key={t.trackId} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => pick(t)}
                  onMouseMove={() => active !== i && setActive(i)}
                  className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition active:bg-white/10 ${
                    i === active ? 'bg-white/[0.07]' : ''
                  }`}
                >
                  {t.artworkUrl60 ? (
                    <img src={t.artworkUrl60} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg bg-zinc-800" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
                      <Music className="h-4 w-4 text-zinc-500" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{t.trackName}</span>
                    <span className="block truncate text-sm text-zinc-500">{t.artistName}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}