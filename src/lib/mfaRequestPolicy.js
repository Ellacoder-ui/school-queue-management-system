// Prevent an SDK session switch from retargeting an in-flight MFA intent.
let lease = null
export async function withMfaRequest(binding, valid, action) {
  if (lease) throw new Error('MFA request already in progress.')
  const current = { ...binding, valid }; lease = current
  try { return await action() } finally { if (lease === current) lease = null }
}
export function guardMfaRequest(input, options = {}) {
  const url = new URL(input instanceof Request ? input.url : input)
  if (!/^\/auth\/v1\/factors(?:\/|$)/.test(url.pathname)) return
  if (!lease || !lease.valid()) throw new Error('MFA request scope unavailable.')
  try {
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined))
    const jwt = headers.get('authorization')?.replace(/^Bearer /, '')
    const claims = JSON.parse(atob(jwt.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')))
    if (claims.sub !== lease.actor || claims.session_id !== lease.session || claims.exp * 1000 <= Date.now()
      || lease.requiredAal && claims.aal !== lease.requiredAal) throw new Error()
  } catch { throw new Error('MFA request session changed.') }
}
