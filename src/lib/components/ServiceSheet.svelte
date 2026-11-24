<script lang="ts">
  import type { FeedItem, Job, Snapshot, Tile } from '#lib/types';
  import { ago, until, validFor } from '#lib/ago.ts';
  import { KIND, isProblem, pctTxt, since } from '#lib/format.ts';
  import Icon from './Icon.svelte';
  import Glyph from './Glyph.svelte';
  import Beats from './Beats.svelte';
  import EventList from './EventList.svelte';

  // A service's sheet: how it is, the way to it, its last 24 hours, what its widget reports, how it is checked and
  // what happened to it over the last week.
  interface Props {
    tile: Tile;
    /** its schedule, when the service is a job */
    job: Job | null;
    snap: Snapshot;
    now: number;
    target: string;
    /** the service was opened from here */
    onopened: (id: string) => void;
  }
  let { tile: t, job: j, snap, now, target, onopened }: Props = $props();

  // its activity: what is raised about it now, then its events of the last 7 days (fetched, since the snapshot only
  // carries the latest of all services; both leave out events that repeat an alert), refreshed when something changes
  let fetched = $state<{ sid: string; items: FeedItem[] } | null>(null);
  $effect(() => {
    const sid = t.id;
    void snap.lastChange;
    const ctl = new AbortController();
    fetch(`/api/events?sid=${encodeURIComponent(sid)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((items: FeedItem[]) => (fetched = { sid, items }))
      .catch(() => {});
    return () => ctl.abort();
  });
  const activity = $derived.by(() => {
    const raised = snap.attention.filter((a) => a.sid === t.id);
    const past = fetched?.sid === t.id ? fetched.items : snap.feed.filter((e) => e.sid === t.id && !('key' in e));
    return [...raised, ...past];
  });
  // the latest few events, the rest of the week on request; short again for every service opened
  const RECENT = 5;
  let all = $state(false);
  $effect(() => { void t.id; all = false; });
</script>

<div class="dash dash-c">
  <div class="sh-head">
    <span class="ic big"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={28} /></span>
    <span class="txt"><span class="state-w lv-{t.level}"><span class="dot lv-{t.level}" aria-hidden="true"></span>{t.status}</span><span class="d" class:hl={isProblem(t.lineLevel)}>{t.line}</span></span>
  </div>
  {#if t.href}<a class="primary wide" href={t.href} target={target} rel="noopener" onclick={() => onopened(t.id)}>Open {t.name} <Glyph name="out" size={13} stroke={2.4} /></a>{/if}
  {#if t.beats}
    <div class="sh-block">
      <div class="sh-row"><span class="st">Last 24 hours</span><span class="muted small">{[`${pctTxt(t.uptime24)} up`, (t.check === 'http' || t.check === 'tcp') && `p95 ${t.p95 == null ? '—' : Math.round(t.p95) + ' ms'}`].filter(Boolean).join(' · ')}</span></div>
      <Beats beats={t.beats} end={snap.generatedAt} label="{t.name} over the last 24 hours" />
      <div class="sh-row muted small num"><span>−24 h</span><span>now</span></div>
    </div>
  {/if}
  {#if t.stats.length}
    <div class="facts">
      {#each t.stats as s}<div class="fact lv-{s.level ?? 'none'}"><span class="muted k">{s.k}</span><span class="fv" class:hl={isProblem(s.level)}>{s.v}</span></div>{/each}
    </div>
  {/if}
  <dl class="kv">
    {#if j}
      <div><dt>Schedule</dt><dd>every {ago(0, j.every)} · grace {ago(0, j.grace)}</dd></div>
      <div><dt>Last run</dt><dd>{since(j.lastOk, now)}{#if j.lastFail && (!j.lastOk || j.lastFail > j.lastOk)} · failure reported {since(j.lastFail, now)}{/if}</dd></div>
      <div><dt>Next run</dt><dd>{until(j.due, now)} · {j.status}</dd></div>
    {:else if t.check}
      <div><dt>Check</dt><dd>{KIND[t.check] ?? t.check}</dd></div>
    {/if}
    {#if t.uptime7 != null}<div><dt>Uptime 7 d</dt><dd>{pctTxt(t.uptime7)}</dd></div>{/if}
    {#if t.cert}<div><dt>Certificate</dt><dd>{validFor(t.cert.days)}{t.cert.selfSigned ? ' · self-signed' : ''}</dd></div>{/if}
    {#if t.description}<div><dt>About</dt><dd>{t.description}</dd></div>{/if}
  </dl>
  <div class="sh-block">
    <div class="sh-row"><span class="st">Activity</span><span class="muted small">Last 7 days</span></div>
    {#if activity.length}
      <EventList id="svc-activity" items={all ? activity : activity.slice(0, RECENT)} {now} full />
      {#if activity.length > RECENT}
        <button class="link-btn" aria-expanded={all} aria-controls="svc-activity" onclick={() => (all = !all)}>{all ? 'Show fewer' : `Show all ${activity.length}`}</button>
      {/if}
    {:else}
      <p class="muted small">No events in the last 7 days.</p>
    {/if}
  </div>
</div>

<style>
  .primary.wide { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; box-sizing: border-box; min-height: 46px; border-radius: 12px; font-size: 14px; font-weight: 600; }
  .sh-head { display: flex; align-items: center; gap: 14px; }
  .state-w { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; }
  .facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
  .fact { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); min-width: 0; }
  .fact .k { font-size: 13px; }
  .fv { font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
  .kv { margin: 0; display: flex; flex-direction: column; }
  .kv > div { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }
  .kv dt { color: var(--muted); flex: none; }
  .kv dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
</style>
