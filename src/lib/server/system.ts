// The System panel: the machine's gauges (CPU, memory, disk, temperature), its facts and its disk I/O, from the
// Proxmox node or the machine the dashboard runs on. Heat is raised here; the Disk gauge's level comes from storage.ts,
// which judges every fill once. A busy CPU or full memory only colours its gauge, like a storage bar's amber: load
// comes and goes, so it raises nothing and never marks the strip's cell.
import type { Raised } from './attention.ts';
import type { Gauge, HostVitals, IoReading, Level, Service, Settings, Snapshot, Temps } from '#lib/types';

type Owner = Pick<Service, 'id' | 'name' | 'href'>;
/** A metric's 24 h history in `points` buckets (db.ts#series), as the snapshot reads it once a minute. */
export type History = (key: string, points: number) => { values: (number | null)[]; lo: (number | null)[]; hi: (number | null)[]; from: number };

/** What the panel is built from. */
export interface SystemInput {
  /** the Proxmox service whose node this is; unset for the local host */
  service?: Owner;
  /** the machine's vitals; null before the first poll */
  hw: HostVitals | null | undefined;
  /** the kernel's sensors, when host.temperature is on */
  temps: Temps | null;
  /** the Disk gauge's level, from storage.ts */
  diskLevel: Level | 'none';
  host: Settings['host'];
  thresholds: Pick<Settings['thresholds'], 'storageAmberPct' | 'cpuWarnPct' | 'memWarnPct' | 'tempMinC' | 'tempWarnC' | 'driveTempWarnC'>;
}

const level = (v: number | null | undefined, warn: number, crit: number): Level | 'none' => (v == null ? 'none' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok');

/** The node's disk read and write (MB/s) with their 24 h series, like Network's traffic. */
function ioReading(source: string, io: { read: number; write: number }, history: History): IoReading {
  const r = history('host.io.read', 96);
  const w = history('host.io.write', 96);
  const charted = r.values.filter((v) => v != null).length > 1;
  return { source, read: io.read, write: io.write, seriesRead: charted ? r.values : null, seriesWrite: charted ? w.values : null, from: charted ? r.from : null };
}

/** The panel (null without vitals or sensors) and what it raises: CPU and NVMe heat. */
export function system({ service, hw, temps, diskLevel, host: settings, thresholds: th }: SystemInput, history: History): { host: Snapshot['host']; raised: Raised[] } {
  const raised: Raised[] = [];
  if (!hw && !temps) return { host: null, raised };
  // 15-minute buckets: fine enough to scrub through, coarse enough to stay smooth; each with its lowest and highest
  // reading, so the chart's band keeps a spike the average flattens
  const hist = (key: string | undefined) => {
    if (!key) return { series: null };
    const s = history(key, 96);
    return s.values.filter((v) => v != null).length > 1 ? { series: s.values, lo: s.lo, hi: s.hi, from: s.from } : { series: null };
  };
  const gauges: Gauge[] = [];
  if (hw) {
    gauges.push({ key: 'cpu', label: 'CPU', val: hw.cpu == null ? '—' : Math.round(hw.cpu), unit: '%', pct: hw.cpu, level: level(hw.cpu, th.cpuWarnPct, th.cpuWarnPct + 15), sub: `${hw.cpus} threads`, ...hist('host.cpu'), view: 'chart', max: 100, warn: th.cpuWarnPct });
    // memory and disk fill barely move in a day: meter rows with a small line, not charts. The amounts are the detail
    gauges.push({ key: 'mem', label: 'Memory', val: Math.round(hw.memPct), unit: '%', pct: hw.memPct, level: level(hw.memPct, th.memWarnPct, th.memWarnPct + 12), sub: `${(hw.mem / 1024 ** 3).toFixed(1)} of ${Math.round(hw.maxmem / 1024 ** 3)} GiB`, ...hist('host.mem'), view: 'meter', max: 100, warn: th.memWarnPct });
    gauges.push({ key: 'disk', label: 'Disk', val: hw.disk.pct == null ? '—' : Math.round(hw.disk.pct), unit: '%', pct: hw.disk.pct, level: diskLevel, sub: hw.disk.name, ...hist(service ? hw.disk.metric : 'host.disk'), view: 'meter', max: 100, warn: th.storageAmberPct });
  }
  if (temps?.cpu != null) {
    const span = th.tempWarnC + 15 - th.tempMinC;
    const tp = Math.max(0, Math.min(100, ((temps.cpu - th.tempMinC) / span) * 100));
    // the chart's dashed line shows the limit and its legend the day's peak; without history yet there is no chart,
    // and the corner names the limit instead
    const tempHist = hist('host.temp');
    gauges.push({ key: 'temp', label: 'Thermals', val: Math.round(temps.cpu), unit: '°C', pct: tp, level: level(temps.cpu, th.tempWarnC, th.tempWarnC + 10), sub: tempHist.series ? 'CPU' : `limit ${th.tempWarnC} °C`, ...tempHist, view: 'chart', max: null, warn: th.tempWarnC });
    // the kernel's sensors are the Proxmox node's (the dashboard shares its kernel), so its tile carries them
    const whose = service ? { service } : { source: 'host' };
    if (temps.cpu >= th.tempWarnC) raised.push({ ...whose, key: 'cpu-temp', sev: temps.cpu >= th.tempWarnC + 10 ? 'crit' : 'warn', title: `CPU at ${Math.round(temps.cpu)} °C`, detail: `limit ${th.tempWarnC} °C` });
    temps.nvme.forEach((n, i) => { if (n >= th.driveTempWarnC) raised.push({ ...whose, key: `nvme-temp-${i}`, sev: 'warn', title: `NVMe at ${Math.round(n)} °C`, detail: 'drive is running hot' }); });
  }
  return {
    host: {
      name: settings.name || (hw?.node ?? 'host'),
      href: service?.href ?? null,
      facts: [
        ...(hw?.uptime ? [{ label: 'Uptime', value: hw.uptime }] : []),
        ...(hw?.guestsTotal != null ? [{ label: 'Guests', value: `${hw.guestsRunning} of ${hw.guestsTotal} running` }] : [])
      ],
      gauges,
      io: hw?.io ? ioReading(hw.node, hw.io, history) : null
    },
    raised
  };
}
