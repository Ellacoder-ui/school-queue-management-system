// Protocol diagnostics contain only reviewed categories, never raw messages/params.
export function cdpError(method, protocol = {}) {
  const categories = new Map([
    ['Invalid InterceptionId.', 'invalid-interception-id'],
    ['Invalid InterceptionId', 'invalid-interception-id'],
    ['No resource with given identifier found', 'missing-resource'],
    ['Session with given id not found.', 'missing-session'],
    ['Target closed.', 'target-closed'],
  ])
  const error = new Error('Browser command failed; protocol details sanitized')
  error.cdp = {
    method: /^[A-Za-z]+\.[A-Za-z]+$/.test(method) ? method : 'unknown',
    code: Number.isInteger(protocol.code) ? protocol.code : null,
    category: categories.get(protocol.message) || 'unrecognized-protocol-error',
  }
  return error
}
