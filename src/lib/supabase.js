import { createClient } from '@supabase/supabase-js'
import { validateLocalPublicConfig } from './supabaseConfig.js'
import { createLocalFetch } from './localFetch.js'
import { authenticatedAuthOptions, googleProviderEnabled } from './oauthConfig.js'
import './oauthEntry.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

const missingVariables = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !supabasePublishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
].filter(Boolean)

if (missingVariables.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVariables.join(', ')}`)
}

const config = validateLocalPublicConfig(supabaseUrl, supabasePublishableKey)
const globalOptions = { fetch: createLocalFetch() }
export const supabase = createClient(config.url, config.publicKey, {
  global: globalOptions,
  auth: authenticatedAuthOptions,
})
export const isGoogleProviderEnabled = () => googleProviderEnabled(globalOptions.fetch, config.publicKey)
// The public display never inherits a stored user session or OAuth callback.
export const publicSupabase = createClient(config.url, config.publicKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: globalOptions,
})
