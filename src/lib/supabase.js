import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see .env.example')
}

export const supabase = createClient(url ?? '', anonKey ?? '')

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
