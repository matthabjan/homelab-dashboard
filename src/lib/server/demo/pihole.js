// Pi-hole: v6 (session login, summary, blocking state) and v5 (api.php summaryRaw). "issues": blocking is disabled.
const SID = 'demo-session-id';

export default {
  'POST /api/auth': ({ body }) => (body?.password ? { session: { valid: true, totp: false, sid: SID, validity: 1800 } } : { session: { valid: false } }),
  'GET /api/stats/summary': () => ({
    queries: { total: 31_402, blocked: 4_088, percent_blocked: 13.02, unique_domains: 2_114 },
    gravity: { domains_being_blocked: 162_418 }
  }),
  'GET /api/dns/blocking': ({ scenario }) => ({ blocking: scenario === 'issues' ? 'disabled' : 'enabled', timer: null }),
  'GET /admin/api.php': ({ scenario, url }) => (url.searchParams.get('auth')
    ? { dns_queries_today: 31_402, ads_blocked_today: 4_088, ads_percentage_today: 13.02, domains_being_blocked: 162_418, status: scenario === 'issues' ? 'disabled' : 'enabled' }
    : [])
};
