// Also guard redirects and individual requests; no request/credential logging.
import { guardMfaRequest } from './mfaRequestPolicy.js'
export function createLocalFetch(fetchImpl = globalThis.fetch) {
  return (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin !== 'http://127.0.0.1:54321') throw new Error('Only the local Supabase gateway is permitted.')
    guardMfaRequest(input, options)
    const signals = [AbortSignal.timeout(30000), options.signal || (input instanceof Request ? input.signal : null)].filter(Boolean)
    return fetchImpl(input, { ...options, redirect: 'error', signal: AbortSignal.any(signals) })
  }
}
