// Only the original local endpoint or the two explicitly fenced disposable projects.
// Isolated launchers verify Docker/config/volume identity before passing these fields.
export function localTestTarget() {
  const project = process.env.QUEUE_ISOLATED_PROJECT_ID
  const match = project?.match(/^sq-routing-(fresh|upgrade)-[0-9a-f]{8}$/)
  if (project && !match) throw new Error('Unrecognized isolated identity')
  const dbPort = match ? (match[1] === 'fresh' ? '56322' : '55322') : '54322'
  const apiPort = match ? (match[1] === 'fresh' ? '56321' : '55321') : '54321'
  const api = `http://127.0.0.1:${apiPort}`
  if (process.env.QUEUE_E2E_API !== api || process.env.PGHOST !== '127.0.0.1'
    || process.env.PGHOSTADDR !== '127.0.0.1' || process.env.PGPORT !== dbPort || process.env.PGDATABASE !== 'postgres')
    throw new Error('Expected exact fenced loopback endpoints')
  return {api, dbPort, apiPort, isolated:!!match, project}
}
