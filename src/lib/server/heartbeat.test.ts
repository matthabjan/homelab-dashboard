// Heartbeats: the endpoint's check-in (token, 404, rate limit), the state rule, the backups merge; and TCP probes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type net from 'node:net';
import { checkIn, createLimiter, heartbeatState, kvKey, response, tokenMatches, tokenOf } from './heartbeat.ts';
import { tcpProbe } from './http.ts';
import { mergeBackups } from './snapshot.ts';
import { memoryKv } from './test-helpers.ts';
import type { HeartbeatRecord, HeartbeatState, Kv, Service } from '$lib/types';

const H = 3600_000;
const hb = { id: 'backups-nightly-restic', every: 24 * H, grace: H, token: 's3cret', backup: true };
// only what checkIn reads
const service = { id: hb.id, name: 'Nightly restic', heartbeat: hb } as unknown as Service;
const record = (kv: Kv, id: string) => kv.get<HeartbeatRecord>(kvKey(id));

test('check-in: right token records the run, wrong or missing token and unknown ids are 404', () => {
  const kv = memoryKv();
  const env = (now: number) => ({ services: [service], kv, now, allow: () => true });
  assert.equal(checkIn(env(1000), { id: hb.id, token: 's3cret', ok: true }).status, 200);
  assert.equal(record(kv, hb.id)?.lastOk, 1000);
  assert.equal(checkIn(env(2000), { id: hb.id, token: 'wrong', ok: true }).status, 404);
  assert.equal(checkIn(env(2000), { id: hb.id, token: null, ok: true }).status, 404);
  assert.equal(checkIn(env(2000), { id: 'nope', token: 's3cret', ok: true }).status, 404);
  assert.equal(record(kv, hb.id)?.lastOk, 1000, 'refused calls change nothing');
  assert.equal(checkIn(env(3000), { id: hb.id, token: 's3cret', ok: false }).status, 200);
  assert.deepEqual([record(kv, hb.id)?.lastOk, record(kv, hb.id)?.lastFail], [1000, 3000]);
  // an empty configured token never matches (the demo allows a heartbeat without one)
  const open = { ...service, heartbeat: { ...hb, token: '' } };
  assert.equal(checkIn({ services: [open], kv, now: 4000, allow: () => true }, { id: hb.id, token: '', ok: true }).status, 404);
});

test('check-in: more than one call per second per id is 429; calls without the token never use up the limit', () => {
  const kv = memoryKv();
  const allow = createLimiter();
  const call = (id: string, now: number, token: string | null = 's3cret') => checkIn({ services: [service], kv, now, allow }, { id, token, ok: true }).status;
  assert.equal(call(hb.id, 10_000), 200);
  assert.equal(call(hb.id, 10_500), 429);
  assert.equal(call(hb.id, 11_000), 200);
  assert.equal(call(hb.id, 12_000, 'wrong'), 404);
  assert.equal(call(hb.id, 12_100), 200, 'the wrong-token call before it did not count');
  assert.equal(call('unknown', 12_200), 404);
  assert.equal(call('unknown', 12_300), 404);
});

test('tokens: compared on digests, from Bearer or ?token=', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abc', 'abcd'), false, 'different lengths compare without throwing');
  assert.equal(tokenMatches('', ''), false);
  const url = new URL('https://dash.test/api/heartbeat/x?token=q');
  assert.equal(tokenOf(new Request(url, { headers: { Authorization: 'Bearer  h ' } }), url), 'h');
  assert.equal(tokenOf(new Request(url), url), 'q');
  assert.equal(tokenOf(new Request('https://dash.test/'), new URL('https://dash.test/')), null);
});

test('the endpoint answers plain text, ok with 200', async () => {
  assert.deepEqual([response(200).status, await response(200).text()], [200, 'ok\n']);
  assert.equal(response(404).status, 404);
  assert.equal(response(429).status, 429);
});

test('state: on time, overdue after every + grace, failure until the next success', () => {
  const t0 = 1_000_000_000;
  const at = (lastOk: number | null, lastFail: number | null, now: number) => heartbeatState(hb, { since: t0, lastOk, lastFail }, now);
  assert.equal(at(null, null, t0 + H).state, 'pending');
  assert.equal(at(null, null, t0 + 26 * H).state, 'down', 'never reported, past every + grace');
  assert.equal(at(t0, null, t0 + 24.5 * H).state, 'up', 'inside the grace');
  const late = at(t0, null, t0 + 25 * H + 1);
  assert.deepEqual([late.state, late.failed, late.overdueSince], ['down', false, t0 + 25 * H]);
  const failed = at(t0, t0 + H, t0 + 2 * H);
  assert.deepEqual([failed.state, failed.failed, failed.overdueSince], ['down', true, null]);
  assert.equal(at(t0 + 2 * H, t0 + H, t0 + 3 * H).state, 'up', 'a success after the failure');
});

test('TCP probe: connected is up with the connect time, refused and timeouts are down', async () => {
  const fake = (act: (s: EventEmitter) => void) => () => {
    const s = Object.assign(new EventEmitter(), { destroy() {}, setTimeout(ms: number, fn: () => void) { if (ms === 1) setImmediate(fn); } });
    setImmediate(() => act(s));
    // a stand-in for the socket net.connect returns: only what tcpProbe touches
    return s as unknown as net.Socket;
  };
  const up = await tcpProbe('h', 22, { connect: (fake((s) => s.emit('connect')) as typeof net.connect) });
  assert.equal(up.ok, true);
  assert.ok(typeof up.ms === 'number');
  const refused = await tcpProbe('h', 22, { connect: (fake((s) => s.emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))) as typeof net.connect) });
  assert.deepEqual(refused, { ok: false, ms: null, code: 'ECONNREFUSED' });
  const slow = await tcpProbe('h', 22, { connect: (fake(() => {}) as typeof net.connect), timeout: 1 });
  assert.deepEqual(slow, { ok: false, ms: null, code: 'ETIMEDOUT' });
});

test('backups: heartbeats marked backup add to PBS (overdue summed, oldest age the larger)', () => {
  const now = 100 * H;
  const beat = (state: HeartbeatState['state'], lastOk: number | null): HeartbeatState => ({ state, lastOk, lastFail: null, since: 0, failed: false, overdueSince: null });
  const pbs = { overdue: 1, oldestAge: 30 * H, known: true };
  assert.deepEqual(mergeBackups(pbs, [beat('down', now - 31 * H), beat('up', now - 6 * H)], now), { overdue: 2, oldestAge: 31 * H, known: true });
  assert.deepEqual(mergeBackups(undefined, [beat('up', now - 6 * H)], now), { overdue: 0, oldestAge: 6 * H, known: true });
  assert.equal(mergeBackups(pbs, [beat('pending', null)], now), pbs, 'a heartbeat that never ran adds nothing yet');
  assert.equal(mergeBackups(undefined, [], now), undefined);
});
