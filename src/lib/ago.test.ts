import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, until, validFor } from './ago.ts';

test('ago: minutes, hours with minutes under 10 h, then days', () => {
  const now = Date.UTC(2026, 0, 10);
  const m = 60_000;
  assert.deepEqual([30_000, 5 * m, 125 * m, 11 * 60 * m, 3 * 24 * 60 * m, -m].map((d) => ago(now - d, now)), ['now', '5 m', '2 h 05 m', '11 h', '3 d', 'now']);
});

test('until: "in …" ahead, "now" once due', () => {
  const now = Date.UTC(2026, 0, 10);
  assert.deepEqual([until(now + 6 * 86_400_000, now), until(now, now), until(now - 60_000, now)], ['in 6 d', 'now', 'now']);
});

test('validFor: days, capped at 10 years; expired below zero', () => {
  assert.deepEqual([validFor(-1), validFor(0), validFor(74), validFor(3650), validFor(364676)], ['expired', 'valid 0 d', 'valid 74 d', 'valid 3650 d', 'valid > 10 y']);
});
