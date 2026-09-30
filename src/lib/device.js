// Phone detection for the sound-permission modal (Room lobby).
// Coarse pointer covers Android phones/tablets and large iPhones;
// the UA test covers the rest. Window-guarded for safety.
export function isPhoneDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return true
  } catch {
    /* fall through to UA check */
  }
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent ?? '')
}

export const AUDIO_ENABLED_KEY = 'vibe-audio-enabled'
