// Custom API: a media server's JSON status endpoint, with a nested object. "issues": it reports itself unhealthy.
export default {
  'GET /api/status': ({ scenario, now }) => ({
    healthy: scenario !== 'issues',
    sessions: { active: 3, transcoding: 1 },
    library: { items: 2841, sizeBytes: 3.9e12, lastScan: new Date(now - 2 * 3600_000).toISOString() },
    streams: [{ user: 'a' }, { user: 'b' }, { user: 'c' }]
  })
};
