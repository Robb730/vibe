import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Lightweight Presence for "who is connected" in the lobby.
export function usePresence(roomId, playerId) {
  const [onlineIds, setOnlineIds] = useState([])

  useEffect(() => {
    if (!roomId || !playerId) return
    const channel = supabase.channel(`presence-${roomId}`, {
      config: { presence: { key: playerId } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        setOnlineIds(Object.keys(state))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ online_at: new Date().toISOString() })
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [roomId, playerId])

  return onlineIds
}

// Heartbeat liveness: keeps my players.last_seen fresh so closed tabs are
// pruned server-side (~90s grace) while refreshes never lose their seat.
// Only beats while seated; a fresh beat also fires on tab refocus.
export function useHeartbeat(roomId, active) {
  useEffect(() => {
    if (!roomId || !active) return
    let cancelled = false
    function beat() {
      supabase.rpc('heartbeat', { p_room_id: roomId }).then(() => {})
    }
    beat()
    const t = setInterval(() => {
      if (!cancelled) beat()
    }, 15_000)
    function onVisible() {
      if (document.visibilityState === 'visible' && !cancelled) beat()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [roomId, active])
}
