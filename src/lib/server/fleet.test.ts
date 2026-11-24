// The fleet strip through its interface: probes per service and bucket in; the fleet's buckets and each service's out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleet, BUCKETS } from './fleet.ts';

const slow = (sid: string) => (sid === 'patient' ? 1000 : 250);
const row = (sid: string, b: number, fails: number, n = 10, maxms: number | null = 20) => ({ sid, b, fails, n, maxms });

test('no probes: 48 empty buckets and no service strips', () => {
  const r = fleet([], slow);
  assert.equal(r.fleet.length, BUCKETS);
  assert.ok(r.fleet.every((b) => b === 'none'));
  assert.equal(r.beats.size, 0);
});

test('a bucket is red from half its probes failing, amber from a tenth, green otherwise', () => {
  const r = fleet([row('a', 0, 0), row('a', 1, 1), row('a', 2, 4), row('a', 3, 5)], slow);
  assert.deepEqual(r.fleet.slice(0, 5), ['ok', 'warn', 'warn', 'crit', 'none']);
  assert.deepEqual(r.beats.get('a')?.slice(0, 5), ['ok', 'warn', 'warn', 'crit', 'none']);
});

test('the fleet bucket is the worst of its services; each service keeps its own', () => {
  const r = fleet([row('a', 7, 0), row('b', 7, 6), row('c', 7, 1), row('a', 8, 0), row('b', 8, 0)], slow);
  assert.deepEqual([r.fleet[7], r.fleet[8]], ['crit', 'ok']);
  assert.deepEqual([r.beats.get('a')?.[7], r.beats.get('b')?.[7], r.beats.get('c')?.[7], r.beats.get('c')?.[8]], ['ok', 'crit', 'warn', 'none']);
});

test('slow: a probe over twice the service\'s own limit turns its bucket amber', () => {
  const r = fleet([row('quick', 0, 0, 10, 501), row('quick', 1, 0, 10, 500), row('patient', 2, 0, 10, 1500), row('patient', 3, 0, 10, 2001)], slow);
  assert.deepEqual(r.fleet.slice(0, 4), ['warn', 'ok', 'ok', 'warn']);
});

test('bucket indexes are clamped: a query a minute older than the build still lands in the strip', () => {
  const r = fleet([row('a', 48.02, 5), row('a', -0.5, 0)], slow);
  assert.deepEqual([r.fleet[47], r.fleet[0]], ['crit', 'ok']);
});
