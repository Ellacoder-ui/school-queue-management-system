export const OAUTH_ORIGIN = 'http://127.0.0.1:5173'
export const OAUTH_CALLBACK = `${OAUTH_ORIGIN}/auth/callback`
export const OAUTH_MARKER = 'school-queue.google-flow.v1'
export const authenticatedAuthOptions = Object.freeze({
  persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce',
})

export function validateGoogleAuthorizationUrl(value) {
  const url = new URL(value)
  const expected = { provider:'google', redirect_to:OAUTH_CALLBACK, code_challenge_method:'s256', prompt:'select_account' }
  if (url.origin !== 'http://127.0.0.1:54321' || url.pathname !== '/auth/v1/authorize'
    || url.username || url.password || url.hash) throw new Error('Invalid authorization destination')
  const allowed = new Set([...Object.keys(expected), 'code_challenge'])
  for (const [key] of url.searchParams) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error('Invalid authorization parameters')
  for (const [key, value] of Object.entries(expected)) if (url.searchParams.get(key) !== value) throw new Error('Invalid authorization parameters')
  if (!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') || '')) throw new Error('PKCE S256 required')
  return url.href
}

export async function googleProviderEnabled(fetchImpl, publicKey) {
  const result = await fetchImpl('http://127.0.0.1:54321/auth/v1/settings', {
    headers: { apikey:publicKey }, redirect:'error',
  })
  if (!result.ok) throw new Error('Sign-in availability unavailable')
  const settings = await result.json()
  return settings.external?.google === true
}

export const isDevelopmentLoginPath = (development, path) => development === true && path === '/dev/login'

export function captureOAuthCallback(location, history) {
  const url = new URL(location.href)
  const callback = url.pathname === '/auth/callback'
  const secretKeys = ['code','error','error_code','error_description','access_token','refresh_token','id_token','provider_token']
  const fragment = new URLSearchParams(url.hash.slice(1))
  const sensitive = secretKeys.some(key => url.searchParams.has(key) || fragment.has(key))
  // Remove all callback parameters before SDK initialization; never persist the code.
  if (callback || sensitive) history.replaceState(null, '', url.pathname)
  if (!callback) return null
  const params = new URLSearchParams(url.search)
  for (const [key,value] of fragment) params.append(key,value)
  const allowed = new Set(['code','error','error_code','error_description'])
  const invalid = url.origin !== OAUTH_ORIGIN || [...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)
    || (params.has('code') && params.has('error')) || (params.has('code') && !params.get('code'))
  return { invalid, code:invalid ? null : params.get('code'),
    cancelled:!invalid && params.get('error') === 'access_denied', error:invalid || params.has('error') }
}
