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
