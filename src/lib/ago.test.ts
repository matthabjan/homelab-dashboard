import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago } from './ago.ts';

test('ago: minutes, hours with minutes under 10 h, then days', () => {
  const now = Date.UTC(2026, 0, 10);
  const m = 60_000;
  assert.deepEqual([30_000, 5 * m, 125 * m, 11 * 60 * m, 3 * 24 * 60 * m, -m].map((d) => ago(now - d, now)), ['now', '5 m', '2 h 05 m', '11 h', '3 d', 'now']);
});
