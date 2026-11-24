<script lang="ts">
  import type { Backups, FeedItem } from '#lib/types';
  import { ago } from '#lib/ago.ts';
  import { grouped } from '#lib/logic.ts';
  import { isProblem, since } from '#lib/format.ts';
  import Group from './Group.svelte';
  import BarRow from './BarRow.svelte';
  import EventList from './EventList.svelte';
  import Glyph from './Glyph.svelte';

  // Backups: the week, then the backups grouped like Storage and Drives: PBS by the service that reports it, then the
  // jobs. A row is a storage row: name and when it last ran; how often it should and a bar for the share of that gone
  // by (amber in the last tenth; full, in its colour and with a pill on a problem). A tap opens its service. What
  // happened is folded under them: Activity and each service's sheet list it too.
  interface Props {
    backups: Backups;
    /** when the snapshot was made */
    now: number;
    /** the page's clock, which the Recent list's times are measured from */
    clock: number;
    /** when something last happened: Recent is read again */
    lastChange: number | null;
    /** a row opens its service's sheet */
    onbackup?: (id: string) => void;
  }
  let { backups, now, clock, lastChange, onbackup }: Props = $props();

  /** PBS rows grouped by the service that reports them, then the jobs, in the order the server sorted them */
  const groups = $derived(grouped(backups.rows.map((r) => ({ ...r, group: r.source ?? 'Jobs' }))));
  const DAY = { none: 'nothing recorded', ok: 'fine', warn: 'warning', crit: 'late' };

  // Recent: the last 7 days of PBS and backup-job events, refreshed when something changes
  let events = $state<FeedItem[]>([]);
  let open = $state(false);
  $effect(() => {
    void lastChange;
    const ctl = new AbortController();
    fetch('/api/events?backups', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((items: FeedItem[]) => (events = items))
      .catch(() => {});
    return () => ctl.abort();
  });
</script>

<Group name="Last 7 days">
  <div class="week" role="img" aria-label="Backups over the last 7 days: {backups.days.map((d) => DAY[d]).join(', ')}">
    {#each backups.days as d, i (i)}<span class="lv-{d}" class:none={d === 'none'}></span>{/each}
  </div>
  <div class="week-l"><span>7 days ago</span><span>today</span></div>
</Group>
{#each groups as g (g.name)}
  <Group name={g.name}>
    {#each g.rows as r (r.id + r.title)}
      {@const bad = isProblem(r.level)}
      {@const share = r.last != null && r.every ? (now - r.last) / r.every : null}
      <BarRow
        name={r.title} level={bad ? r.level : share != null && share >= 0.9 ? 'warn' : r.level === 'none' ? 'off' : 'ok'}
        pill={bad ? { text: r.state, level: r.level } : null} value={since(r.last, now)}
        meta={r.every ? `every ${ago(0, r.every)}` : r.state} aligned fill={bad ? 100 : (share ?? 0) * 100}
        onclick={() => onbackup?.(r.id)}
        label="{r.title}: {r.state}, last run {since(r.last, now)}{r.every ? `, every ${ago(0, r.every)}` : ''}"
      />
    {/each}
  </Group>
{/each}
<section class="recent">
  <button class="recent-head" aria-expanded={open} disabled={!events.length} onclick={() => (open = !open)}>
    <span><span class="rt">Recent</span> <span class="muted">· {events.length ? `${events.length} ${events.length === 1 ? 'event' : 'events'} in 7 days` : 'nothing in 7 days'}</span></span>
    {#if events.length}<Glyph name="down" class={open ? 'chev open' : 'chev'} />{/if}
  </button>
  {#if open && events.length}<div class="recent-list"><EventList items={events} now={clock} /></div>{/if}
</section>

<style>
  /* the week as a box, Recent as a box that opens */
  .week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; padding: 6px 0 4px; }
  .week span { height: 14px; border-radius: 4px; background: var(--lv); opacity: 0.85; }
  .week span.none { background: var(--surface-3); opacity: 1; }
  .week-l { display: flex; justify-content: space-between; padding-bottom: 10px; font-size: 11px; color: var(--muted); }
  .recent { border-radius: 14px; background: var(--surface-2); }
  .recent-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border: 0; background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; border-radius: 14px; }
  .recent-head:disabled { cursor: default; }
  .recent-head:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  .rt { font-weight: 500; }
  .recent-head :global(.chev) { color: var(--muted); transition: transform 0.2s; }
  .recent-head :global(.chev.open) { transform: rotate(180deg); }
  .recent-list { padding: 0 14px 6px; }
</style>
