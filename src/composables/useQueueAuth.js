import { onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { supabase, isGoogleProviderEnabled } from '../lib/supabase.js'
import { queueApi } from '../lib/queue.js'
import { createAuthController } from '../lib/authController.js'
import { createGoogleOAuthController, browserOAuthLock } from '../lib/googleOAuth.js'
import { oauthEntry } from '../lib/oauthEntry.js'
import { OAUTH_MARKER } from '../lib/oauthConfig.js'

export function useQueueAuth(publicState) {
  const controller = createAuthController(supabase.auth, queueApi, { onState: next => { state.value = next } })
  const state = shallowRef(controller.getState())
  const oauth = createGoogleOAuthController(supabase.auth, controller, {
    store: { getItem:key => window.localStorage.getItem(key), setItem:(key,value) => window.localStorage.setItem(key,value) },
    tabStore: { getItem:key => window.sessionStorage.getItem(key), setItem:(key,value) => window.sessionStorage.setItem(key,value) },
    origin:window.location.origin, navigate:url => window.location.assign(url),
    cleanPath:path => window.history.replaceState(null,'',path), providerEnabled:isGoogleProviderEnabled,
    lock:browserOAuthLock, onState:next => { oauthState.value=next },
  })
  const oauthState = shallowRef(oauth.getState())
  const storage = event => { if (event.key === OAUTH_MARKER) void oauth.storageChanged() }
  const online = () => controller.refresh()
  const offline = () => controller.offline()
  const visible = () => { if (document.visibilityState === 'visible') controller.refresh() }
  let poll, stopDenials
  watch(() => publicState.value.synchronized, ready => { if (ready) controller.refresh() })
  onMounted(() => {
    controller.start({ suspended:!!oauthEntry || oauth.shouldGate() })
    if (oauthEntry) void oauth.callback(oauthEntry)
    else oauth.pending()
    stopDenials = queueApi.onAuthorizationDenied(controller.protectedDenied)
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('storage',storage)
    poll = setInterval(() => { if (document.visibilityState === 'visible') controller.refresh() }, 60000)
  })
  onUnmounted(() => {
    clearInterval(poll); stopDenials?.(); oauth.stop(); controller.stop()
    window.removeEventListener('online', online); window.removeEventListener('offline', offline)
    document.removeEventListener('visibilitychange', visible)
    window.removeEventListener('storage',storage)
  })
  return { state, oauthState, google:oauth.start, reconcileOAuth:oauth.reconcile, cancelOAuth:oauth.cancel,
    login: controller.login, logout:() => { oauth.cancel(); return controller.logout() }, refresh: controller.refresh,
    navigate: controller.navigate, protectedDenied: controller.protectedDenied }
}
