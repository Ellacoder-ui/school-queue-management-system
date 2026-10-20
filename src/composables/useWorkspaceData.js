import { onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { queueApi } from '../lib/queue.js'
import { createWorkspaceReader, emptyWorkspace } from '../lib/workspaceData.js'
import { createRecoveryTask } from '../lib/revalidation.js'

export function useWorkspaceData(authState, publicState) {
  const state = shallowRef(emptyWorkspace())
  const reader = createWorkspaceReader(queueApi, { onState: value => { state.value = value } })
  watch(authState, value => reader.setAccess(value), { immediate: true, flush: 'sync' })
  watch(() => publicState.value.queueVersion, () => void reader.refresh({ invalidate:true }))
  const recovery = createRecoveryTask(() => reader.refresh(), { visible:()=>document.visibilityState==='visible' })
  const refresh = recovery.schedule
  onMounted(() => { window.addEventListener('online', refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh) })
  onUnmounted(() => { recovery.stop(); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); reader.stop() })
  return { state, refresh: () => reader.refresh({ force: true }) }
}
