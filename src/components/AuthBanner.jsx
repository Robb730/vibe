import { TriangleAlert } from 'lucide-react'

export default function AuthBanner({ authError }) {
  if (!authError) return null
  return (
    <div className="relative z-20 mx-auto flex w-full max-w-6xl items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-950/60 px-4 py-3 text-sm text-amber-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        {authError === 'anon-disabled' ? (
          <>Anonymous sign-ins are <strong>disabled</strong> in Supabase. Enable them under <strong>Authentication → Providers → Anonymous</strong>, then hard-refresh.</>
        ) : authError === 'no-env' ? (
          <>Missing <code className="font-mono">VITE_SUPABASE_URL</code> / <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>. Copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env</code> and restart dev.</>
        ) : (
          <>Auth error: {authError}</>
        )}
      </p>
    </div>
  )
}
