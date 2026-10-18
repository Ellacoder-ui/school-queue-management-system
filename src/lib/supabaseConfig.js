// Phase 1 deliberately permits only the existing local stack, in every mode.
export function validateLocalPublicConfig(url, publicKey) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('A local Supabase URL is required.') }
  if (parsed.origin !== 'http://127.0.0.1:54321' || !['', '/'].includes(parsed.pathname) ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('Phase 1 requires local Supabase at http://127.0.0.1:54321.')
  }
  let permitted = typeof publicKey === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)
  if (!permitted && typeof publicKey === 'string' && publicKey.split('.').length === 3) {
    try {
      const payload = publicKey.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')
      permitted = JSON.parse(atob(payload)).role === 'anon'
    } catch { permitted = false }
  }
  if (!permitted) throw new Error('A publishable key or legacy public anon key is required; secret keys are forbidden.')
  return { url: parsed.origin, publicKey }
}
