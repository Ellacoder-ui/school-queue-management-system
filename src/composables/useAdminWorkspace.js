import { onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { queueApi } from '../lib/queue.js'
import { createAdminWorkspace, emptyAdmin } from '../lib/adminWorkspace.js'
import { createRecoveryTask } from '../lib/revalidation.js'
import { STAFF_ACTIVATION_RELEASED } from '../lib/adminActivation.js'
export function useAdminWorkspace(auth, publicState, refreshPublic) {
  const state = shallowRef(emptyAdmin())
  let selectedDate = null
  const reportDate = () => selectedDate || publicState.value.context?.business_date
  const controller = createAdminWorkspace(queueApi, {
    contract: 'installed-directory',
    getAccess: () => { const actor = auth.getVerifiedActor(); return actor ? { actor, context: auth.state.value.context } : null },
    store: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) },
    withLock: body => {
      if (!navigator.locks?.request) throw new Error('Management locking unavailable')
      return navigator.locks.request('cqs-admin-management-v1', { ifAvailable: true }, lock => { if (!lock) throw new Error('Another management action is running'); return body() })
    },
    onState: value => { state.value = value }, afterWrite: async operation => { if(operation!=='request_staff_access')refreshPublic() },
  })
  // Keep these watchers separate: a shallow Auth ref in a multi-source watch
  // force-triggers it on every public snapshot, even when the date is unchanged.
  watch(() => JSON.stringify([auth.getVerifiedActor(),auth.state.value.status,auth.state.value.accountVersion,auth.state.value.context]), () => controller.syncAccess(reportDate()), { immediate: true, flush: 'sync' })
  const refresh = date => { if (typeof date === 'string') selectedDate = date; return controller.refresh(reportDate()) }
  const recovery = createRecoveryTask(() => { if(!state.value.busy)return controller.refresh(reportDate(), {background:true}) }, {visible:()=>document.visibilityState==='visible'})
  const visible = recovery.schedule
  const storage = event => { if (event.key?.startsWith('cqs-admin-intent-v1:')) controller.syncAccess(reportDate()) }
  onMounted(() => { window.addEventListener('online', visible); window.addEventListener('focus', visible); window.addEventListener('storage', storage); document.addEventListener('visibilitychange', visible) })
  onUnmounted(() => { recovery.stop(); window.removeEventListener('online', visible); window.removeEventListener('focus', visible); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); controller.stop() })
  return { state, refresh,
    perform: (operation,args) => { if(operation==='add_verified_staff'&&!STAFF_ACTIVATION_RELEASED)return;return controller.perform(operation,args) },
    retry: () => { if(state.value.operation==='add_verified_staff'&&!STAFF_ACTIVATION_RELEASED)return;return controller.retry() } }
}
