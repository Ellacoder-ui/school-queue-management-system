const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
const exact = (x, keys) => x && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k))
export const adminMutations = new Set(['set_account', 'set_staff_access', 'configure_counter', 'remove_ineligible_counter_assignment', 'request_staff_access', 'add_verified_staff', 'assign_staff_by_email', 'manage_pending_staff'])
export function normalizeStaffEmail(value) {
  if (typeof value !== 'string') throw new Error('Invalid staff email')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid staff email')
  return email
}
// The installed two-argument staff-request RPC has no server request-key contract.
export const mutationCanReplay = operation => operation !== 'request_staff_access'
export function validateStaffDirectory(value) {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid staff directory')
  const seen = new Set()
  return value.map(row => {
    if (!exact(row, ['id','email','role','enabled','verified_factors','google_identity']) || !uuid(row.id) || seen.has(row.id)
      || !['STUDENT','CASHIER','ADMIN'].includes(row.role) || typeof row.enabled !== 'boolean'
      || !(row.email === null || typeof row.email === 'string' && row.email.length <= 320)
      || !Number.isSafeInteger(row.verified_factors) || row.verified_factors < 0
      || !Number.isSafeInteger(row.google_identity) || row.google_identity < 0) throw new Error('Invalid staff directory row')
    seen.add(row.id)
    return { id:row.id,email:row.email,role:row.role,enabled:row.enabled,verified_factors:row.verified_factors,google_identity:row.google_identity }
  })
}
export function validateInstalledStaff(configuration, value) {
  const directory = validateStaffDirectory(value)
  for (const name of ['accounts','services','counters','counter_services','staff_assignments']) if (!Array.isArray(configuration?.[name])) throw new Error('Invalid administration configuration')
  const c = configuration, codes = ['TP','SOA','PNEP','REF','ADJ'], ids = new Set(), numbers = new Set()
  if (c.accounts.length !== directory.length || c.counters.length !== 5 || c.services.length !== 5 || c.counter_services.length !== 5) throw new Error('Incomplete administration snapshot')
  for (const account of c.accounts) {
    const row = directory.find(x=>x.id===account.id)
    if (!row || ids.has(account.id) || row.role !== account.role || row.enabled !== account.enabled) throw new Error('Account snapshot changed')
    ids.add(account.id)
  }
  for (const counter of c.counters) {
    const service = c.services.find(s=>s.code===codes[counter.number-1])
    if (!uuid(counter.id) || numbers.has(counter.number) || !service || !uuid(service.id) || typeof counter.label !== 'string' || typeof counter.is_open !== 'boolean'
      || !c.counter_services.some(x=>x.counter_id===counter.id && x.service_id===service.id)) throw new Error('Invalid fixed counter route')
    numbers.add(counter.number)
  }
  for (const assignment of c.staff_assignments) if (!ids.has(assignment.account_id) || !c.counters.some(x=>x.id===assignment.counter_id)) throw new Error('Invalid cashier assignment')
  return { contract:'installed-staff-directory', directory, configuration: {
    accounts: directory.map(({id,role,enabled})=>({id,role,enabled})),
    counters:c.counters.map(({id,number,label,is_open})=>({id,number,label,is_open})),
    services:c.services.map(({id,code,name,enabled})=>({id,code,name,enabled})),
    counter_services:c.counter_services.map(({counter_id,service_id})=>({counter_id,service_id})),
    staff_assignments:c.staff_assignments.map(({account_id,counter_id})=>({account_id,counter_id}))
  } }
}
export function validateAdminMutation(operation, p) {
  if (!adminMutations.has(operation)) throw new Error('Unsupported administration action')
  if (operation === 'add_verified_staff' && (!exact(p,['p_user','p_email','p_identity_sha256','p_role','p_counter']) || !uuid(p.p_user) || normalizeStaffEmail(p.p_email)!==p.p_email || !/^[0-9a-f]{64}$/.test(p.p_identity_sha256) || !['ADMIN','CASHIER'].includes(p.p_role) || (p.p_role==='ADMIN' ? p.p_counter!==null : !uuid(p.p_counter)))) throw new Error('Invalid verified staff action')
  if (operation === 'assign_staff_by_email' && (!exact(p,['p_email','p_role','p_counter']) || normalizeStaffEmail(p.p_email)!==p.p_email || !['ADMIN','CASHIER'].includes(p.p_role) || (p.p_role==='ADMIN' ? p.p_counter!==null : !uuid(p.p_counter)))) throw new Error('Invalid email staff assignment')
  if (operation === 'manage_pending_staff' && (!exact(p,['p_invitation','p_action','p_email','p_role','p_counter'])
    || !uuid(p.p_invitation) || !['UPDATE','CANCEL'].includes(p.p_action)
    || (p.p_action==='CANCEL' ? p.p_email!==null||p.p_role!==null||p.p_counter!==null
      : normalizeStaffEmail(p.p_email)!==p.p_email||!['ADMIN','CASHIER'].includes(p.p_role)||(p.p_role==='ADMIN'?p.p_counter!==null:!uuid(p.p_counter))))) throw new Error('Invalid pending staff action')
  if (operation === 'set_account' && (!exact(p, ['p_user', 'p_role', 'p_enabled']) || !uuid(p.p_user) || !['STUDENT', 'CASHIER', 'ADMIN'].includes(p.p_role) || typeof p.p_enabled !== 'boolean')) throw new Error('Invalid account action')
  if (operation === 'set_staff_access' && (!exact(p, ['p_user', 'p_role', 'p_enabled', 'p_counter']) || !uuid(p.p_user)
    || !['CASHIER', 'ADMIN'].includes(p.p_role) || typeof p.p_enabled !== 'boolean'
    || (p.p_role === 'CASHIER' && p.p_enabled ? !uuid(p.p_counter) : p.p_counter !== null))) throw new Error('Invalid staff access action')
  if (operation === 'remove_ineligible_counter_assignment' && (!exact(p, ['p_counter', 'p_user'])
    || !uuid(p.p_counter) || !uuid(p.p_user))) throw new Error('Invalid counter assignment removal')
  if (operation === 'configure_counter' && (!exact(p, ['p_counter', 'p_open', 'p_services', 'p_cashiers']) || !uuid(p.p_counter) || typeof p.p_open !== 'boolean'
    || !Array.isArray(p.p_services) || p.p_services.length !== 1 || !['TP', 'SOA', 'PNEP', 'REF', 'ADJ'].includes(p.p_services[0])
    || !Array.isArray(p.p_cashiers) || p.p_cashiers.length > 100 || p.p_cashiers.some(x => !uuid(x)) || new Set(p.p_cashiers).size !== p.p_cashiers.length)) throw new Error('Invalid counter action')
  if (operation === 'request_staff_access' && (!exact(p, ['p_email', 'p_role']) || typeof p.p_email !== 'string' || p.p_email.length > 254
    || p.p_email !== p.p_email.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.p_email) || !['CASHIER', 'ADMIN'].includes(p.p_role))) throw new Error('Invalid staff request')
}
export function validateAdminReceipt(operation, value) {
  if (operation === 'add_verified_staff' && (!exact(value,['user','role','enabled','counter']) || !uuid(value.user) || !['ADMIN','CASHIER'].includes(value.role) || value.enabled!==true || (value.role==='ADMIN'?value.counter!==null:!uuid(value.counter)))) throw new Error('Invalid staff activation receipt')
  if (operation === 'assign_staff_by_email') {
    if (!exact(value,['status','user','email','role','counter']) && !exact(value,['status','invitation','email','role','counter'])) throw new Error('Invalid email staff receipt')
    if (typeof value.email!=='string'||normalizeStaffEmail(value.email)!==value.email||!['ADMIN','CASHIER'].includes(value.role)
      ||(value.role==='ADMIN'?value.counter!==null:!uuid(value.counter))
      ||(value.status==='ASSIGNED'?!uuid(value.user):value.status==='PENDING_FIRST_LOGIN'? !uuid(value.invitation):true)) throw new Error('Invalid email staff receipt')
  }
  if (operation === 'manage_pending_staff') {
    if (exact(value,['invitation','status'])&&uuid(value.invitation)&&value.status==='CANCELLED') return value
    if (!exact(value,['invitation','email','role','counter','status'])||!uuid(value.invitation)
      ||typeof value.email!=='string'||normalizeStaffEmail(value.email)!==value.email
      ||!['ADMIN','CASHIER'].includes(value.role)||(value.role==='ADMIN'?value.counter!==null:!uuid(value.counter))
      ||value.status!=='PENDING_FIRST_LOGIN') throw new Error('Invalid pending staff receipt')
  }
  if (operation === 'set_account' && (!exact(value, ['user', 'role', 'enabled']) || !uuid(value.user) || !['STUDENT', 'CASHIER', 'ADMIN'].includes(value.role) || typeof value.enabled !== 'boolean')) throw new Error('Invalid account receipt')
  if (operation === 'set_staff_access' && (!exact(value, ['user', 'role', 'enabled', 'counter']) || !uuid(value.user)
    || !['CASHIER', 'ADMIN'].includes(value.role) || typeof value.enabled !== 'boolean'
    || (value.role === 'CASHIER' && value.enabled ? !uuid(value.counter) : value.counter !== null))) throw new Error('Invalid staff access receipt')
  if (operation === 'remove_ineligible_counter_assignment' && (!exact(value, ['counter', 'user', 'role', 'enabled', 'removed'])
    || !uuid(value.counter) || !uuid(value.user) || !['STUDENT', 'CASHIER', 'ADMIN'].includes(value.role)
    || typeof value.enabled !== 'boolean' || value.role === 'CASHIER' && value.enabled || value.removed !== true)) {
    throw new Error('Invalid counter assignment removal receipt')
  }
  if (operation === 'configure_counter') {
    if (!exact(value, ['counter', 'open', 'services', 'cashiers'])) throw new Error('Invalid counter receipt')
    validateAdminMutation(operation, { p_counter: value.counter, p_open: value.open, p_services: value.services, p_cashiers: value.cashiers })
  }
  if (operation === 'request_staff_access' && (!exact(value, ['request_id', 'status']) || !uuid(value.request_id) || value.status !== 'PENDING_IDENTITY_REVIEW')) throw new Error('Invalid staff receipt')
  return value
}
