import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Subscribes to a single room row + its players/rounds/votes via Realtime.
// NOTE: requires supabase/migrations/0003_realtime.sql (tables must be in the
// supabase_realtime publication, otherwise events never arrive).
// Returns `live` = true once the channel is SUBSCRIBED.
export function useRoom(code) {
  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [rounds, setRounds] = useState([])
  const [votes, setVotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    let channel = null

    async function fetchPlayers(roomId) {
      const { data } = await supabase.from('players').select('*').eq('room_id', roomId).order('joined_at')
      if (!cancelled) setPlayers(data ?? [])
    }

    async function fetchRounds(roomId) {
      const { data } = await supabase.from('rounds').select('*').eq('room_id', roomId).order('order_idx')
      if (!cancelled) setRounds(data ?? [])
    }

    async function fetchVotes(roomId) {
      const { data } = await supabase.from('votes').select('*, rounds!inner(room_id)').eq('rounds.room_id', roomId)
      if (!cancelled) setVotes((data ?? []).map(({ rounds: _r, ...rest }) => rest))
    }

    // PostgREST "single row" failure (zero rows, e.g. RLS filtered everything
    // because the anon session wasn't ready yet) -> friendly message.
    function friendlyRoomError(msg) {
      if (/coerce|single JSON|PGRST116|0 rows/i.test(msg ?? '')) {
        return 'Room not found — check the code and try again.'
      }
      return msg
    }

    async function fetchRoom() {
      return supabase
        .from('rooms')
        .select('*')
        .eq('code', code.toUpperCase())
        .single()
    }

    async function load() {
      setLoading(true)
      setLive(false)
      setError(null)

      // Gate on the anon session: without it we query as role `anon`,
      // RLS hides everything, and `.single()` throws the coercion error
      // even for rooms that exist (classic cold invite-link open).
      try {
        const { data } = await supabase.auth.getSession()
        if (!data.session) await supabase.auth.signInAnonymously()
      } catch {
        /* fall through; the query error below will surface */
      }
      if (cancelled) return

      let { data: roomRow, error: roomErr } = await fetchRoom()
      if (roomErr && !cancelled && /coerce|single JSON|PGRST116/i.test(roomErr.message ?? '')) {
        // Possibly raced the sign-in: retry once now that it settled.
        try {
          await supabase.auth.signInAnonymously()
        } catch {
          /* ignore */
        }
        if (!cancelled) ({ data: roomRow, error: roomErr } = await fetchRoom())
      }
      if (cancelled) return
      if (roomErr) {
        setError(friendlyRoomError(roomErr.message))
        setLoading(false)
        return
      }
      setRoom(roomRow)

      await Promise.all([fetchPlayers(roomRow.id), fetchRounds(roomRow.id), fetchVotes(roomRow.id)])
      if (cancelled) return
      setLoading(false)

      channel = supabase
        .channel(`room-${roomRow.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomRow.id}` }, (payload) => {
          if (payload.new) setRoom(payload.new)
          else fetchPlayers(roomRow.id).then(() => {
            // Room row deleted/reset — refetch everything to stay consistent.
            supabase.from('rooms').select('*').eq('id', roomRow.id).single().then(({ data }) => {
              if (!cancelled && data) setRoom(data)
            })
          })
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomRow.id}` }, () => {
          fetchPlayers(roomRow.id)
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomRow.id}` }, () => {
          fetchRounds(roomRow.id)
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, () => {
          fetchVotes(roomRow.id)
        })
        .subscribe((status) => {
          if (!cancelled) setLive(status === 'SUBSCRIBED')
        })
    }

    load()

    // Cheap resilience: refetch on tab focus in case events were missed.
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      supabase.from('rooms').select('*').eq('code', code.toUpperCase()).single().then(({ data }) => {
        if (!cancelled && data) {
          setRoom(data)
          fetchPlayers(data.id)
          fetchRounds(data.id)
          fetchVotes(data.id)
        }
      })
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) supabase.removeChannel(channel)
    }
  }, [code])

  return { room, players, rounds, votes, loading, error, live }
}
