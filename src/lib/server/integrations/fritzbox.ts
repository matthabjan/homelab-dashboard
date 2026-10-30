// FRITZ!Box — TR-064/UPnP on port 49000 (no login needed; "Statusinformationen über UPnP übertragen" must be enabled).
import { card, fmtDuration } from '../format.ts';
import type { Alert, Context, Stat, Widget, WidgetResult } from '$lib/types';

// The TR-064 values read here: the <New…> elements of each SOAP answer, all text.

/** WANIPConnection#GetStatusInfo. */
export interface FritzStatusInfo {
  /** Connected, Connecting, Disconnected, … */
  NewConnectionStatus?: string;
  /** seconds */
  NewUptime?: string;
}

/** WANCommonInterfaceConfig#GetCommonLinkProperties, bit/s. */
export interface FritzLinkProperties {
  NewLayer1DownstreamMaxBitRate?: string;
  NewLayer1UpstreamMaxBitRate?: string;
}

/** WANCommonInterfaceConfig#GetAddonInfos (AVM extension), bytes/s. */
export interface FritzAddonInfos {
  NewByteReceiveRate?: string;
  NewByteSendRate?: string;
}

/** The answer's <New…> elements, read as T (not checked). */
async function soap<T>(ctx: Context, base: string, service: string, action: string): Promise<T> {
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
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<(New[\w]+)>([^<]*)<\/\1>/g)) out[m[1]] = m[2];
  return out as T;
}

export async function collect(w: Widget, ctx: Context): Promise<WidgetResult> {
  const u = new URL(w.url);
  const base = `${u.protocol}//${u.hostname}:${u.protocol === 'https:' ? 49443 : 49000}`;
  const [status, link, addon] = await Promise.all([
    soap<FritzStatusInfo>(ctx, base, 'WANIPConnection', 'GetStatusInfo'),
    soap<FritzLinkProperties>(ctx, base, 'WANCommonInterfaceConfig', 'GetCommonLinkProperties'),
    soap<FritzAddonInfos>(ctx, base, 'WANCommonInterfaceConfig', 'GetAddonInfos').catch((): FritzAddonInfos => ({}))
  ]);
  const connected = status.NewConnectionStatus === 'Connected';
  const maxDown = Number(link.NewLayer1DownstreamMaxBitRate || 0) / 1e6;
  const maxUp = Number(link.NewLayer1UpstreamMaxBitRate || 0) / 1e6;
  const down = addon.NewByteReceiveRate != null ? (Number(addon.NewByteReceiveRate) * 8) / 1e6 : null;
  const up = addon.NewByteSendRate != null ? (Number(addon.NewByteSendRate) * 8) / 1e6 : null;
  if (down != null) { ctx.metric('fritz.down', down); ctx.metric('fritz.up', up); }

  const alerts: Alert[] = connected ? [] : [{ sev: 'crit', key: 'wan-down', title: 'Internet connection down', detail: `FRITZ!Box reports ${status.NewConnectionStatus || 'unknown'}` }];
  // the connection only when it is down
  const facts: [Stat, string][] = [];
  if (!connected) facts.push([{ k: 'internet', v: 'offline', level: 'crit' }, 'Internet offline']);
  const rates = `${Math.round(maxDown)} / ${Math.round(maxUp)}`;
  facts.push([{ k: 'max ↓ / ↑ Mbit/s', v: rates }, `${rates} Mbit/s`]);
  const uptime = fmtDuration(Number(status.NewUptime || 0) * 1000);
  if (connected) facts.push([{ k: 'up', v: uptime }, `up ${uptime}`]);
  return {
    ...card(facts),
    alerts,
    network: down != null ? { down, up, source: 'FRITZ!Box', fallback: true } : null
  };
}
