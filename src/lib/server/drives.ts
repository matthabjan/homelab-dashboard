// The Drives panel: one row per physical disk with what SMART says about it, and what is wrong with each, raised for
// the service that reported the drive as a predicate of the drive ("WD Red has 8% life left").
import { fmtHours, fmtSize } from './format.ts';
import type { Raised } from './attention.ts';
import type { Drive, Fact, Level, Service, Settings, Snapshot } from '#lib/types';

type Th = Pick<Settings['thresholds'], 'driveLifeWarnPct' | 'driveTempWarnC'>;
type Owner = Pick<Service, 'id' | 'name' | 'href'>;

/** One service's drives. */
export interface DriveReport {
  service: Owner;
  drives: Drive[];
}

/** A drive's row, and what is wrong with it. */
function driveStatus(d: Drive, where: string, th: Th) {
  /** severity, alert text, alert key */
  const problems: ['crit' | 'warn', string, string][] = [];
  if (d.health === 'failing') problems.push(['crit', 'is failing SMART', 'health']);
  if (d.health === 'warning') problems.push(['warn', 'has a past or minor SMART problem', 'health']);
  if (d.lifeLeft != null && d.lifeLeft <= th.driveLifeWarnPct) problems.push(['warn', `has ${d.lifeLeft}% life left`, 'life']);
  if (d.errors) problems.push(['warn', `has ${d.errors} media errors or bad sectors`, 'errors']);
  if (d.tempC != null && d.tempC >= th.driveTempWarnC) problems.push(['warn', `is at ${d.tempC} °C`, 'temp']);
  const level: Level = problems.some((p) => p[0] === 'crit') ? 'crit' : problems.length ? 'warn' : 'ok';
  const status = d.health === 'failing' ? 'failing' : level === 'warn' ? 'check' : d.health === 'unknown' ? '—' : 'ok';
  /** what the row lists when it is opened */
  const details = [
    { k: 'SMART', v: { failing: 'failing', warning: 'a past or minor problem', unknown: 'not reported', ok: 'passed' }[d.health] },
    ...(d.lifeLeft != null ? [{ k: 'Rated endurance left', v: `${d.lifeLeft}%` }] : []),
    ...(d.tempC != null ? [{ k: 'Temperature', v: `${d.tempC} °C` }] : []),
    ...(d.hours != null ? [{ k: 'Powered on', v: fmtHours(d.hours) }] : []),
    ...(d.written != null ? [{ k: 'Data written', v: fmtSize(d.written) }] : []),
    ...(d.errors ? [{ k: 'Media errors or bad sectors', v: String(d.errors) }] : [])
  ];
  /** shown next to the model; the rest is in `details` */
  const facts: Fact[] = [];
  if (d.tempC != null) facts.push({ k: '', v: `${d.tempC} °C`, level: d.tempC >= th.driveTempWarnC ? 'warn' : null });
  if (d.errors) facts.push({ k: 'errors', v: String(d.errors), level: 'warn' });
  const lifeLevel: Level = d.lifeLeft != null && d.lifeLeft <= th.driveLifeWarnPct ? 'warn' : 'ok';
  return {
    row: { name: d.model, group: where, meta: [d.kind, fmtSize(d.size), where].join(' · '), details, status, level, life: d.lifeLeft, lifeLevel, tempC: d.tempC, facts },
    problems
  };
}

/**
 * The rows, in the reports' order and by model within each, and their alerts. A disk passed through whole is
 * reported by the host and by the VM: it is listed once, for the first service that reports it.
 */
export function drives(reports: DriveReport[], th: Th): { rows: Snapshot['drives']; raised: Raised[] } {
  const rows: Snapshot['drives'] = [];
  const raised: Raised[] = [];
  const seenSerials = new Set<string>();
  for (const { service, drives } of reports) {
    for (const d of [...drives].sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true }))) {
      if (d.serial && seenSerials.has(d.serial)) continue;
      if (d.serial) seenSerials.add(d.serial);
      const { row, problems } = driveStatus(d, d.where ?? service.name, th);
      for (const [sev, text, key] of problems) raised.push({ sev, service, key: `drive-${d.serial ?? d.model}-${key}`, title: `${d.model} ${text}`, detail: row.meta });
      rows.push(row);
    }
  }
  return { rows, raised };
}
