import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, fakeId } from './vector_socket_fixture.mjs';

test('only fixed synthetic container metadata and logs are available', () => {
  assert.equal(classify('GET', '/v1.49/containers/json?all=false'), 'list');
  assert.equal(classify('GET', `/v1.49/containers/${fakeId}/json`), 'inspect');
  assert.equal(classify('GET', `/v1.49/containers/${fakeId}/logs?stdout=true`), 'logs');
  assert.equal(classify('GET', '/v1.49/events?filters={}'), 'events');
});
test('retained and unknown container identifiers are denied', () => {
  for (const id of ['supabase_vector_school-queue-local', 'b6d521af', 'b'.repeat(64), fakeId.slice(0, 12)]) {
    assert.equal(classify('GET', `/containers/${id}/logs`), 'denied');
    assert.equal(classify('GET', `/containers/${id}/json`), 'denied');
  }
});
test('all mutation methods are denied', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'CONNECT'])
    for (const path of ['/containers/create', '/_ping', `/containers/${fakeId}/logs`]) assert.equal(classify(method, path), 'denied');
});
test('volume, exec, image, archive and raw daemon endpoints are denied', () => {
  for (const path of ['/volumes', '/images/json', '/info', '/containers/json/extra', `/containers/${fakeId}/archive`, '/exec/test/json'])
    assert.equal(classify('GET', path), 'denied');
});
test('ambiguous and credential-bearing request targets are denied', () => {
  for (const path of ['http://secret@host/version', '//host/version', '/v1.49/containers/%61/json', '/version#x', '/version?token=canary', '/_ping?x=1', '/version\n'])
    assert.equal(classify('GET', path), 'denied');
});
test('encoded Docker filter values work without allowing encoded paths or unknown query keys', () => {
  assert.equal(classify('GET', '/v1.49/containers/json?all=false&filters=%7B%22label%22%3A%5B%5D%7D'), 'list');
  assert.equal(classify('GET', '/v1.49/events?filters=%7B%22event%22%3A%5B%22start%22%5D%7D'), 'events');
  for (const path of ['/containers/json?token=canary', '/containers/json?filters=1&filters=2', '/containers/%6ason', `/containers/${fakeId}/logs?credentials=canary`])
    assert.equal(classify('GET', path), 'denied');
});
