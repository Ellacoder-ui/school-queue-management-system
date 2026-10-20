// Coalesce focus, visibility and online recovery events; never schedule steady polling.
export function createRecoveryTask(run, { visible = () => true, setTimer = setTimeout, clearTimer = clearTimeout, delayMs = 80 } = {}) {
  let timer = null, stopped = false
  return {
    schedule() {
      if (stopped || timer !== null) return
      timer = setTimer(() => { timer = null; if (!stopped && visible()) void run() }, delayMs)
    },
    stop() { stopped = true; if (timer !== null) clearTimer(timer); timer = null },
  }
}
