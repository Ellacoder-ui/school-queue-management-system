import { onMounted, onUnmounted, shallowRef } from 'vue'
import { queueApi } from '../lib/queue.js'
import { createPublicQueueController } from '../lib/publicQueueController.js'

export function usePublicQueue() {
  const controller = createPublicQueueController(queueApi, { onState: next => { state.value = next } })
  const state = shallowRef(controller.getState())
  const online = () => { void controller.retry() }
  const offline = () => controller.offline()
  const visible = () => { if (document.visibilityState === 'visible') controller.refresh() }
  onMounted(() => {
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    controller.start()
    if (!navigator.onLine) controller.offline()
  })
  onUnmounted(() => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
    document.removeEventListener('visibilitychange', visible)
    void controller.stop()
  })
  return { state, retry: () => { void controller.retry() }, refresh: controller.refresh }
}
