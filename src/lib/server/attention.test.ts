// Attention through its interface: begin, raise, close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttention } from './attention.ts';
import type { FeedEvent } from '$lib/types';

const MIN = 60_000;
const T = Date.UTC(2026, 0, 1);
const pihole = { id: 'g-pi-hole', name: 'Pi-hole', href: 'https://pihole.home.arpa' };
const nas = { id: 'g-nas', name: 'NAS', href: null };

test('age: kept per key while the alert stays, even when its title carries a changing reading; new after it clears', () => {
  const attention = createAttention();
  const round = (now: number, pct: number | null) => {
    const r = attention.begin(now);
    if (pct != null) r.raise({ sev: 'warn', service: nas, key: 'storage-data', title: `data is ${pct}% full` });
    return r.close([]).items[0]?.ts;
  };
  assert.equal(round(T, 91), T);
  assert.equal(round(T + MIN, 92), T, 'same key, new reading: still dated when first seen');
  assert.equal(round(T + 2 * MIN, null), undefined);
  assert.equal(round(T + 3 * MIN, 92), T + 3 * MIN, 'back after clearing: a new alert');
  assert.equal(createAttention().begin(T + 4 * MIN).close([]).items.length, 0, 'another instance remembers nothing');
});

test('keys are scoped by service or source; a repeated key keeps the more severe alert', () => {
  const r = createAttention().begin(T);
  r.raise({ sev: 'warn', service: pihole, key: 'cert', title: 'Certificate expires in 9 d' });
  r.raise({ sev: 'warn', service: nas, key: 'cert', title: 'Certificate expires in 5 d' });
  r.raise({ sev: 'warn', source: 'host', key: 'cert', title: 'not a service' });
  r.raise({ sev: 'crit', service: nas, key: 'cert', title: 'Certificate expires in 2 d' });
  r.raise({ sev: 'warn', service: nas, key: 'cert', title: 'Certificate expires in 2 d, less severe' });
  assert.deepEqual(r.close([]).items.map((a) => [a.key, a.sev, a.title]), [
    ['g-nas|cert', 'crit', 'NAS: Certificate expires in 2 d'],
    ['g-pi-hole|cert', 'warn', 'Pi-hole: Certificate expires in 9 d'],
    ['host|cert', 'warn', 'not a service']
  ]);
});

test('naming: the service in front unless the title names it; links default to the service', () => {
  const r = createAttention().begin(T);
  r.raise({ sev: 'warn', service: pihole, key: 'blocking', title: 'Blocking is disabled' });
  r.raise({ sev: 'crit', service: pihole, key: 'check', title: 'Pi-hole is down', ts: T - 5 * MIN });
  r.raise({ sev: 'warn', source: 'config', key: 'services.yaml', title: 'services.yaml has an error', href: '/config#problems' });
  // equal severity and time: in the order raised
  assert.deepEqual(r.close([]).items.map((a) => [a.title, a.sid, a.service, a.href, a.ts]), [
    ['Pi-hole is down', 'g-pi-hole', 'Pi-hole', 'https://pihole.home.arpa', T - 5 * MIN],
    ['Pi-hole: Blocking is disabled', 'g-pi-hole', 'Pi-hole', 'https://pihole.home.arpa', T],
    ['services.yaml has an error', undefined, undefined, '/config#problems', T]
  ]);
});

test('order, needCount and headline: most severe first, then newest; info needs no attention', () => {
  const calm = createAttention().begin(T);
  calm.raise({ sev: 'info', service: nas, key: 'updates', title: '4 updates available' });
  const quiet = calm.close([]);
  assert.equal(quiet.needCount, 0);
  assert.deepEqual(quiet.headline, { level: 'ok', tag: 'All systems normal', title: 'Everything is running.' });

  const r = createAttention().begin(T);
  r.raise({ sev: 'warn', service: nas, key: 'old', title: 'older warning', ts: T - 10 * MIN });
  r.raise({ sev: 'info', service: nas, key: 'updates', title: '4 updates available' });
  r.raise({ sev: 'warn', service: nas, key: 'new', title: 'newer warning' });
  r.raise({ sev: 'crit', service: pihole, key: 'check', title: 'Pi-hole is down', ts: T - 20 * MIN });
  const c = r.close([]);
  assert.deepEqual(c.items.map((a) => a.title), ['Pi-hole is down', 'NAS: newer warning', 'NAS: older warning', 'NAS: 4 updates available']);
  assert.equal(c.needCount, 3);
  assert.deepEqual(c.headline, { level: 'crit', tag: '3 need attention', title: 'Pi-hole is down.' });
});

test("worst: a service's most severe crit or warn alert, with its bare title; info doesn't count", () => {
  const r = createAttention().begin(T);
  r.raise({ sev: 'info', service: nas, key: 'updates', title: '4 updates available' });
  assert.equal(createAttention().begin(T).close([]).worst('g-nas'), null);
  r.raise({ sev: 'warn', service: nas, key: 'storage-data', title: 'data is 91% full', detail: '7.3 / 8 TiB' });
  r.raise({ sev: 'crit', service: nas, key: 'drive-A-health', title: 'Disk A is failing SMART' });
  r.raise({ sev: 'crit', service: nas, key: 'drive-B-health', title: 'Disk B is failing SMART' });
  const c = r.close([]);
  assert.deepEqual(c.worst('g-nas'), { sev: 'crit', title: 'Disk A is failing SMART', detail: undefined });
  assert.equal(c.worst('g-pi-hole'), null);
});

test('feed: only attention while anything needs it; else alerts and events, without what an alert already says', () => {
  const event = (ts: number, title: string, sid: string | null = nas.id): FeedEvent => ({ ts, sev: 'ok', sid, title, detail: null, href: null });
  const events = [event(T - MIN, '4 updates available'), event(T - 2 * MIN, 'Backups completed', null), event(T - 3 * MIN, 'NAS recovered'), event(T - 9 * MIN, 'NAS recovered')];

  const busy = createAttention().begin(T);
  busy.raise({ sev: 'warn', service: nas, key: 'new', title: 'newer warning' });
  const b = busy.close(events);
  assert.deepEqual(b.feed, b.items);

  const calm = createAttention().begin(T);
  calm.raise({ sev: 'info', service: nas, key: 'updates', title: '4 updates available' });
  assert.deepEqual(calm.close(events).feed.map((x) => [x.title, x.ts]), [
    ['NAS: 4 updates available', T],
    ['Backups completed', T - 2 * MIN],
    ['NAS recovered', T - 3 * MIN]
  ], 'the event the alert logged and the older repeat are left out');
});

test('raising after close throws: every source raises before tiles are built', () => {
  const r = createAttention().begin(T);
  r.close([]);
  assert.throws(() => r.raise({ sev: 'warn', source: 'host', key: 'late', title: 'too late' }), /after close/);
});
