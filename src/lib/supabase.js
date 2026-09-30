import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see .env.example')
}

export const supabase = createClient(url ?? '', anonKey ?? '')

// Best-effort leave on tab close / background kill (mobile Safari fires
// pagehide, not beforeunload). keepalive fetch carries auth headers —
// sendBeacon can't — and survives page termination. leave_room no-ops when
// the row is already gone, so double-sends with the Leave button are safe.
export function leaveRoomBeacon(roomId) {
  if (!url || !anonKey || !roomId) return
  try {
    // Session token lives under sb-<ref>-auth-token (any Supabase host).
    let token = null
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && /^sb-.*-auth-token$/.test(k)) {
        token = JSON.parse(localStorage.getItem(k) ?? 'null')?.access_token ?? null
        if (token) break
      }
    }
    fetch(`${url}/rest/v1/rpc/leave_room`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_room_id: roomId }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* storage blocked (private mode): nothing to send */
  }
}

// Returns null on success, or a short error code for the UI banner:
// 'anon-disabled' | 'no-env' | message string.
export async function ensureAnonSession() {
  if (!url || !anonKey) return 'no-env'
  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      console.error('Anonymous sign-in failed:', error.message)
      if (/anonymous.*disabled/i.test(error.message)) return 'anon-disabled'
      return error.message
    }
  }
  return null
}
