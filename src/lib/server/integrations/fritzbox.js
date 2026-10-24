// FRITZ!Box — TR-064/UPnP on port 49000 (no login needed; "Statusinformationen über UPnP übertragen" must be enabled).
import { fmtDuration } from '../format.js';

async function soap(ctx, base, service, action) {
  const path = service === 'WANIPConnection' ? 'WANIPConn1' : 'WANCommonIFC1';
  const res = await ctx.request(`${base}/igdupnp/control/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': "text/xml; charset='utf-8'", SoapAction: `urn:schemas-upnp-org:service:${service}:1#${action}` },
    body:
      "<?xml version='1.0' encoding='utf-8'?><s:Envelope s:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/' xmlns:s='http://schemas.xmlsoap.org/soap/envelope/'>" +
      `<s:Body><u:${action} xmlns:u='urn:schemas-upnp-org:service:${service}:1' /></s:Body></s:Envelope>`,
    insecure: true,
    timeout: 6000
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} on ${action}`);
  const xml = await res.text();
  const out = {};
  for (const m of xml.matchAll(/<(New[\w]+)>([^<]*)<\/\1>/g)) out[m[1]] = m[2];
  return out;
}

export async function collect(w, ctx) {
  const u = new URL(w.url);
  const base = `${u.protocol}//${u.hostname}:${u.protocol === 'https:' ? 49443 : 49000}`;
  const [status, link, addon] = await Promise.all([
    soap(ctx, base, 'WANIPConnection', 'GetStatusInfo'),
    soap(ctx, base, 'WANCommonInterfaceConfig', 'GetCommonLinkProperties'),
    soap(ctx, base, 'WANCommonInterfaceConfig', 'GetAddonInfos').catch(() => ({}))
  ]);
  const connected = status.NewConnectionStatus === 'Connected';
  const maxDown = Number(link.NewLayer1DownstreamMaxBitRate || 0) / 1e6;
  const maxUp = Number(link.NewLayer1UpstreamMaxBitRate || 0) / 1e6;
  const down = addon.NewByteReceiveRate != null ? (Number(addon.NewByteReceiveRate) * 8) / 1e6 : null;
  const up = addon.NewByteSendRate != null ? (Number(addon.NewByteSendRate) * 8) / 1e6 : null;
  if (down != null) { ctx.metric('fritz.down', down); ctx.metric('fritz.up', up); }

  const alerts = connected ? [] : [{ sev: 'crit', title: 'Internet connection down', detail: `FRITZ!Box reports ${status.NewConnectionStatus || 'unknown'}` }];
  return {
    stats: [
      { k: 'internet', v: connected ? 'online' : 'offline', level: connected ? 'ok' : 'crit' },
      { k: 'max ↓ Mbit/s', v: String(Math.round(maxDown)) },
      { k: 'max ↑ Mbit/s', v: String(Math.round(maxUp)) }
    ],
    line: connected ? `Online · ${Math.round(maxDown)} / ${Math.round(maxUp)} Mbit/s · up ${fmtDuration(Number(status.NewUptime || 0) * 1000)}` : 'Internet offline',
    alerts,
    network: down != null ? { down, up, source: 'FRITZ!Box', fallback: true } : null
  };
}
