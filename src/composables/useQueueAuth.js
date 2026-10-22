import { onMounted, onUnmounted, shallowRef } from 'vue'
import { createRecoveryTask } from '../lib/revalidation.js'
import { supabase, isGoogleProviderEnabled } from '../lib/supabase.js'
import { queueApi } from '../lib/queue.js'
import { createAuthController } from '../lib/authController.js'
import { createGoogleOAuthController, browserOAuthLock } from '../lib/googleOAuth.js'
import { oauthEntry } from '../lib/oauthEntry.js'
import { OAUTH_MARKER } from '../lib/oauthConfig.js'
import { useAccountMfa } from './useAccountMfa.js'

export function useQueueAuth() {
  const controller = createAuthController(supabase.auth, queueApi, { onState: next => { state.value = next } })
  const state = shallowRef(controller.getState())
  const mfa = useAccountMfa(supabase.auth, controller, state)
  const oauth = createGoogleOAuthController(supabase.auth, controller, {
    store: { getItem:key => window.localStorage.getItem(key), setItem:(key,value) => window.localStorage.setItem(key,value) },
    tabStore: { getItem:key => window.sessionStorage.getItem(key), setItem:(key,value) => window.sessionStorage.setItem(key,value) },
    origin:window.location.origin, navigate:url => window.location.assign(url),
    cleanPath:path => window.history.replaceState(null,'',path), providerEnabled:isGoogleProviderEnabled,
    lock:browserOAuthLock, onState:next => { oauthState.value=next },
  })
  const oauthState = shallowRef(oauth.getState())
  const storage = event => { if (event.key === OAUTH_MARKER) void oauth.storageChanged() }
  const recovery = createRecoveryTask(controller.revalidate, { visible: () => document.visibilityState === 'visible' })
  const online = recovery.schedule
  const offline = () => controller.offline()
  const visible = () => {
    recovery.schedule()
    if (oauth.returnedToApp()) controller.resume()
  }
  const historyNavigation = () => {
    if (!oauth.returnedToApp()) controller.resume()
  }
  let stopDenials
  onMounted(() => {
    controller.start({ suspended:!!oauthEntry })
    if (oauthEntry) void oauth.callback(oauthEntry)
    else oauth.pending()
    stopDenials = queueApi.onAuthorizationDenied(controller.protectedDenied)
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('storage',storage)
    window.addEventListener('focus', visible)
    window.addEventListener('popstate', historyNavigation)
    window.addEventListener('pageshow', historyNavigation)
  })
  onUnmounted(() => {
    recovery.stop(); stopDenials?.(); oauth.stop(); controller.stop()
    window.removeEventListener('online', online); window.removeEventListener('offline', offline)
    document.removeEventListener('visibilitychange', visible)
    window.removeEventListener('storage',storage)
    window.removeEventListener('focus', visible)
    window.removeEventListener('popstate', historyNavigation)
    window.removeEventListener('pageshow', historyNavigation)
  })
  return { state, oauthState, mfa, google:oauth.start,
    login: controller.login, logout:() => { oauth.cancel(); return controller.logout() }, refresh: controller.refresh,
    navigate: controller.navigate, protectedDenied: controller.protectedDenied, getVerifiedActor: controller.getVerifiedActor }
}
