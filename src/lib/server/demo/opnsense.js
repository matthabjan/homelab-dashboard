// OPNsense: cumulative WAN counters growing at a slowly changing rate (~70 / 10 Mbit/s),
// so the integration derives rates from consecutive polls just like in production.
// bytes so far = integral of rate(t) = bytesPerS · (1 + 0.3 · sin(t / 1 h))
const counter = (now, bytesPerS) => {
  const t = now / 1000, T = 3600;
  return String(Math.floor(bytesPerS * (t - 0.3 * T * Math.cos(t / T))));
};

export default {
  'GET /api/diagnostics/activity/getActivity': () => ({
    headers: ['last pid: 4242;  load averages:  0.12,  0.10,  0.08', '62 processes: 1 running, 61 sleeping', 'CPU:  1.2% user,  0.0% nice,  2.1% system,  0.4% interrupt, 96.3% idle']
  }),
  'GET /api/diagnostics/traffic/interface': ({ now }) => ({
    interfaces: { wan: { 'bytes received': counter(now, 9e6), 'bytes transmitted': counter(now, 1.2e6) } }
  })
};
