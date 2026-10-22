import { onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { queueApi } from '../lib/queue.js'
import { createQueueActions } from '../lib/queueActions.js'
export function useQueueActions(auth, workspace, refreshPublic) {
  const state = shallowRef({ phase: 'idle', message: null, operation: null, result: null })
  const controller = createQueueActions(queueApi, {
    getAccess: () => { const actor = auth.getVerifiedActor(); return actor ? { actor, context: auth.state.value.context } : null },
    store: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) },
    withLock: body => {
      if (!navigator.locks?.request) throw new Error('Operation locking is unavailable')
      return navigator.locks.request('cqs-queue-operation-v1', { ifAvailable: true }, lock => { if (!lock) throw new Error('Another tab is processing a queue operation'); return body() })
    },
    online: () => navigator.onLine,
    onState: value => { state.value = value },
    onAuthorizationChanged: auth.protectedDenied,
    afterOperation: async operation => {
      await workspace.refresh()
      refreshPublic()
    },
  })
  watch(auth.state, () => controller.syncAccess(), { flush: 'sync' })
  const storage = event => { if (event.key?.startsWith('cqs-queue-intent-v1:')) controller.syncAccess() }
  onMounted(() => { controller.syncAccess(); window.addEventListener('storage', storage) })
  onUnmounted(() => { window.removeEventListener('storage', storage); controller.stop() })
  return { state, perform: controller.perform, retry: controller.retry, clearMessage: controller.clearMessage }
}
