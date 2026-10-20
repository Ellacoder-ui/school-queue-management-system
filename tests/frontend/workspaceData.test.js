import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceReader, validateWorkspaceRows, ticketLabel, activeTicket } from '../../src/lib/workspaceData.js'
const ticket = { id: 'test-ticket', service: 'ADJ', number: 3, business_date: '2026-10-18', status: 'WAITING', counter: null, issued_at: '2026-10-18T01:00:00Z' }
const access = (role = 'STUDENT', accountVersion = 1) => ({ status: 'ready', context: { enabled: true, role }, accountVersion })
const tick = () => new Promise(resolve => setImmediate(resolve))
test('workspace reads follow verified database role; no directory or mutation operation', async () => {
  const calls = [], api = { read: async operation => { calls.push(operation); return [] } }
  const reader = createWorkspaceReader(api)
  reader.setAccess({ status: 'anonymous' }); await tick(); assert.equal(calls.length, 0)
  for (const role of ['STUDENT', 'CASHIER', 'ADMIN']) { reader.setAccess(access(role)); await tick() }
  assert.deepEqual(calls, ['my_tickets', 'staff_queue', 'staff_queue']); reader.stop()
})
test('account change, logout and revoked access clear rows and discard late responses even without abort support', async () => {
  const pending = [], reader = createWorkspaceReader({ read: () => new Promise(resolve => pending.push(resolve)) })
  reader.setAccess(access()); reader.setAccess(access('STUDENT', 2))
  pending[1]([]); await tick(); pending[0]([ticket]); await tick(); assert.deepEqual(reader.getState().rows, [])
  reader.setAccess(access('STUDENT', 3)); reader.setAccess({ status: 'checking', accountVersion: 4 })
  pending[2]([ticket]); await tick(); assert.equal(reader.getState().status, 'idle'); assert.deepEqual(reader.getState().rows, [])
  reader.stop()
})
test('read failures clear stale rows and expose only unavailable status', async () => {
  let fail = false
  const reader = createWorkspaceReader({ read: async () => { if (fail) throw new Error('PRIVATE DATABASE DIAGNOSTIC'); return [ticket] } })
  reader.setAccess(access()); await tick(); assert.equal(reader.getState().rows.length, 1)
  fail = true; await reader.refresh(); assert.deepEqual(reader.getState(), { status: 'error', rows: [], updatedAt: null, refreshing:false }); reader.stop()
})
test('staff permission denial clears private rows and reports restricted access without claiming its cause',async()=>{
  const reader=createWorkspaceReader({read:async()=>{throw Object.assign(new Error('PRIVATE POLICY DETAILS'),{code:'42501'})}})
  reader.setAccess(access('ADMIN'));await tick()
  assert.deepEqual(reader.getState(),{status:'restricted',rows:[],updatedAt:null,refreshing:false});reader.stop()
})

test('background queue invalidations preserve the ready table, coalesce and discard an older response',async()=>{
  const pending=[],reader=createWorkspaceReader({read:()=>new Promise(resolve=>pending.push(resolve))})
  reader.setAccess(access());pending[0]([ticket]);await tick()
  const first=reader.refresh();assert.equal(reader.getState().status,'ready');assert.equal(reader.getState().refreshing,true)
  assert.equal(reader.refresh(),first)
  void reader.refresh({invalidate:true});void reader.refresh({invalidate:true})
  pending[1]([{...ticket,number:99}]);await tick();assert.equal(pending.length,3);assert.equal(reader.getState().rows[0].number,3)
  pending[2]([{...ticket,number:4}]);await first
  assert.equal(reader.getState().status,'ready');assert.equal(reader.getState().rows[0].number,4);assert.equal(reader.getState().refreshing,false);reader.stop()
})
test('read refreshes coalesce and unmounted views ignore late results', async () => {
  let calls = 0, resolve
  const reader = createWorkspaceReader({ read: () => { calls++; return new Promise(done => { resolve = done }) } })
  reader.setAccess(access()); void reader.refresh(); assert.equal(calls, 1)
  reader.stop(); resolve([ticket]); await tick(); assert.deepEqual(reader.getState().rows, [])
})
test('post-operation force refresh discards a snapshot that began before the write', async () => {
  const pending = [], reader = createWorkspaceReader({ read: () => new Promise(resolve => pending.push(resolve)) })
  reader.setAccess(access()); const fresh = reader.refresh({ force: true })
  pending[0]([ticket]); await tick(); assert.equal(reader.getState().status, 'loading')
  pending[1]([]); await fresh; assert.equal(reader.getState().status, 'ready'); assert.deepEqual(reader.getState().rows, [])
  reader.stop()
})
test('ticket DTOs preserve queue dates, omit unexpected private fields and include real FORFEITED status', () => {
  const result = validateWorkspaceRows([{ ...ticket, status: 'FORFEITED', email: 'PRIVATE' }], 'STUDENT')
  assert.equal(result[0].status, 'FORFEITED'); assert.equal(result[0].email, undefined)
  assert.equal(ticketLabel(ticket), 'ADJ-003'); assert.equal(activeTicket(result), null)
  assert.equal(activeTicket([ticket]), ticket)
})
test('malformed or duplicate DTOs cannot masquerade as an empty queue', () => {
  for (const rows of [null, {}, [ticket, ticket], [{ ...ticket, service: 'FAKE' }], [{ ...ticket, status: 'SKIPPED' }], [{ ...ticket, number: -1 }]]) assert.throws(() => validateWorkspaceRows(rows, 'STUDENT'))
})
