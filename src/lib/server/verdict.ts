// The top card's sentence. Healthy: how many services are up, jobs counted apart ("All 11 services up", "5 backup jobs
// on schedule"). One thing needs attention: that item, its detail, and the way to its service. Several do: how many
// and how bad ("12 things need attention", "3 critical · 9 warnings"), since the list beside the sentence names them
// and saying the first one twice told nothing.
import { plural } from './format.ts';
import type { Closed } from './attention.ts';
import type { Job, Snapshot, Tile } from '#lib/types';

export interface VerdictInput {
  tiles: Tile[];
  jobs: Job[];
  /** how many backup rows there are: with none of them a job, "backups current" says so */
  backupRows: number;
  /** a certificate with fewer days left is expiring */
  certWarnDays: number;
}

export function verdict({ tiles, jobs, backupRows, certWarnDays }: VerdictInput, att: Pick<Closed, 'headline' | 'needCount' | 'items'>): Snapshot['verdict'] {
  const probed = tiles.filter((t) => t.level !== 'unknown');
  const services = probed.filter((t) => t.check !== 'heartbeat');
  const servicesUp = services.filter((t) => t.status !== 'Down').length;
  const certWarn = tiles.filter((t) => t.cert && t.cert.days < certWarnDays).length;
  const onSchedule = jobs.filter((j) => j.state !== 'down').length;
  const jobWord = jobs.every((j) => j.backup) ? 'backup job' : 'job';

  const subParts: string[] = [];
  let title = att.headline.title.replace(/\.$/, '');
  let action: Snapshot['verdict']['action'] = null;
  if (att.needCount) {
    const top = att.items[0];
    if (att.needCount > 1) {
      const need = att.items.filter((a) => a.sev !== 'info');
      const nCrit = need.filter((a) => a.sev === 'crit').length;
      title = `${att.needCount} things need attention`;
      subParts.push([nCrit && `${nCrit} critical`, need.length - nCrit && plural(need.length - nCrit, 'warning')].filter(Boolean).join(' · '));
    } else {
      if (top.detail) subParts.push(top.detail);
      if (top.href) action = { label: `Open ${top.service ?? 'it'}`, href: top.href };
    }
    subParts.push(`${servicesUp} of ${services.length} services up`);
  } else {
    if (services.length === 1 && servicesUp === 1) title = `${services[0].name} is up`;
    else if (services.length) title = servicesUp === services.length ? `All ${services.length} services up` : `${servicesUp} of ${services.length} services up`;
    if (jobs.length) subParts.push(onSchedule === jobs.length ? `${plural(jobs.length, jobWord)} on schedule` : `${onSchedule} of ${plural(jobs.length, jobWord)} on schedule`);
    // an overdue backup raises an alert, so here they are current
    if (backupRows && !jobs.length) subParts.push('backups current');
    if (certWarn) subParts.push(`${plural(certWarn, 'certificate')} expiring`);
  }
  return { ...att.headline, title, sub: subParts.join(' · '), action };
}
