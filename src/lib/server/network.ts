// The Network panel: WAN and LAN traffic with their 24 h series, and DNS statistics, from the widgets settings.network
// picks (default: a router's traffic before the FRITZ!Box's, the first widget with DNS statistics).
import type { History } from './system.ts';
import type { NetworkReading, Service, Settings, Snapshot, Traffic, WidgetState } from '#lib/types';

const H = 3600_000;
/** A service that has polled its widget at least once, with that result. */
export interface WidgetReport {
  s: Pick<Service, 'id' | 'name' | 'href'>;
  w: WidgetState;
}

/** The panel, or null when no widget reports traffic or DNS. `now` is the right edge of the series. */
export function network(widgets: WidgetReport[], pick: Settings['network'] | undefined, now: number, history: History): Snapshot['network'] {
  const netPick = pick?.service;
  const net = netPick
    ? widgets.find((x) => x.s.name === netPick && x.w.network)
    : widgets.find((x) => x.w.network && !x.w.network.fallback) || widgets.find((x) => x.w.network);
  const dnsPick = pick?.dns;
  const dns = widgets.find((x) => x.w.dns && (!dnsPick || x.s.name === dnsPick));
  const lan = widgets.find((x) => x.w.lan);
  /** Rates plus 24 h series for one reading, from the metrics `<key>.down` / `<key>.up`. */
  const traffic = (key: string, reading: NetworkReading, href: string | null): Traffic => {
    const sDown = history(`${key}.down`, 72);
    const sUp = history(`${key}.up`, 72);
    return { source: reading.source, href, down: reading.down, up: reading.up, seriesDown: sDown.values, seriesUp: sUp.values, downLo: sDown.lo, downHi: sDown.hi, spanH: Math.max(1, Math.round((now - sDown.from) / H)), from: sDown.from };
  };
  if (!net && !dns && !lan?.w.lan) return null;
  const nw = net?.w.network;
  return {
    ...(nw && net ? traffic(nw.fallback ? 'fritz' : 'net', nw, net.s.href) : { source: null, href: null, down: null, up: null, seriesDown: null, seriesUp: null, spanH: null, from: null }),
    lan: lan?.w.lan ? traffic('lan', lan.w.lan, lan.s.href) : null,
    dns: dns?.w.dns ? { ...dns.w.dns, href: dns.s.href, name: dns.s.name } : null
  };
}
