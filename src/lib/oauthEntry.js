import { captureOAuthCallback } from './oauthConfig.js'
// Evaluated before the Auth client. This private in-memory entry never enters view state.
export const oauthEntry = typeof window === 'undefined' ? null : captureOAuthCallback(window.location, window.history)
