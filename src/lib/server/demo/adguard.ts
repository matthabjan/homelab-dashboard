// AdGuard Home: a day of DNS queries with an evening peak.
import type { Fixtures } from '$lib/types';
import type { AdguardStats, AdguardStatus } from '../integrations/adguard.ts';

const QUERIES = Array.from({ length: 24 }, (_, i) => 1400 + Math.round(Math.sin((i - 6) / 3.8) * 900 + 900));

export default {
  'GET /control/stats': (): AdguardStats => ({
    num_dns_queries: 48_213,
    num_blocked_filtering: 8_871,
    avg_processing_time: 0.004,
    time_units: 'hours',
    dns_queries: QUERIES,
    // ads and trackers follow the day's browsing: a larger share blocked in the evening
    blocked_filtering: QUERIES.map((n, i) => Math.round(n * (0.15 + 0.06 * Math.sin((i - 8) / 3.8))))
  }),
  'GET /control/status': (): AdguardStatus => ({ protection_enabled: true, running: true })
} satisfies Fixtures;
