import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [messages, setMessages] = useState([])
  const [roomDeleted, setRoomDeleted] = useState(false)
  const roomIdRef = useRef(null)
  const cancelledRef = useRef(false)

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

    async function fetchMessages(roomId) {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(100)
      if (!cancelled) setMessages(data ?? [])
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
      setRoomDeleted(false)

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
      roomIdRef.current = roomRow.id

      await Promise.all([fetchPlayers(roomRow.id), fetchRounds(roomRow.id), fetchVotes(roomRow.id), fetchMessages(roomRow.id)])
      if (cancelled) return
      setLoading(false)

      channel = supabase
        .channel(`room-${roomRow.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomRow.id}` }, (payload) => {
          if (payload.eventType === 'DELETE' || !payload.new) {
            // Room row gone (last player left) — confirm, then flag closed.
            // maybeSingle avoids the .single() coercion error on zero rows.
            supabase.from('rooms').select('id').eq('id', roomRow.id).maybeSingle().then(({ data }) => {
              if (cancelled) return
              if (!data) setRoomDeleted(true)
              else fetchPlayers(roomRow.id)
            })
            return
          }
          setRoom(payload.new)
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
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomRow.id}` }, (payload) => {
          if (payload.new) setMessages((ms) => [...ms.slice(-99), payload.new])
          else fetchMessages(roomRow.id)
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
      cancelledRef.current = true
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) supabase.removeChannel(channel)
    }
  }, [code])

  // Manual refresh for chat (called after sending; converges with realtime).
  const refreshMessages = useCallback(() => {
    const id = roomIdRef.current
    if (!id) return
    supabase
      .from('messages')
      .select('*')
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (!cancelledRef.current) setMessages(data ?? [])
      })
  }, [])

  // Safety net: converge even if a realtime event is ever dropped or the
  // publication is missing. Cheap at this scale; realtime (<1s) dominates
  // when healthy.
  useEffect(() => {
    if (loading) return
    const t = setInterval(refreshMessages, 5000)
    return () => clearInterval(t)
  }, [loading, refreshMessages, code])

  return { room, players, rounds, votes, messages, loading, error, live, roomDeleted, refreshMessages }
}
