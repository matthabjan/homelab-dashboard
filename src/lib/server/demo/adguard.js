// AdGuard Home: a day of DNS queries with an evening peak.
export default {
  'GET /control/stats': () => ({
    num_dns_queries: 48_213,
    num_blocked_filtering: 8_871,
    avg_processing_time: 0.004,
    time_units: 'hours',
    dns_queries: Array.from({ length: 24 }, (_, i) => 1400 + Math.round(Math.sin((i - 6) / 3.8) * 900 + 900))
  }),
  'GET /control/status': () => ({ protection_enabled: true, running: true })
};
