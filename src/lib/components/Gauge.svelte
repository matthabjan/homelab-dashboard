<script lang="ts">
  import type { Gauge } from '$lib/types';
  import Chart from './Chart.svelte';

  // One System reading: its value, then its last 24 h as a chart. Scrubbing the chart puts the reading at that
  // time in the headline (the time where the subtitle was), the way stock and health apps do it.
  interface Props {
    g: Gauge;
    /** when the snapshot was made: the chart's right edge */
    now: number;
  }
  let { g, now }: Props = $props();
  let scrub = $state<{ v: number; ts: number } | null>(null);
  const pct = $derived(Math.max(0, Math.min(100, g.pct ?? 0)));
  // the history is in the headline's unit (% or °C), so a scrubbed point takes the headline's place
  const unitOf = $derived(g.key === 'temp' ? '°C' : '%');
  const format = (v: number) => `${Math.round(v)} ${unitOf}`;
  const hours = $derived(g.from ? Math.max(1, Math.round((now - g.from) / 3_600_000)) : 24);
  const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<div class="tile lv-{g.level}">
  <div class="head">
    <span class="label">{g.label}</span>
    <span class="mono sub" class:at={scrub}>{scrub ? hhmm(scrub.ts) : g.sub ?? ''}</span>
  </div>
  <div class="val" aria-live="off">
    {#if scrub}<span class="mono num">{Math.round(scrub.v)}</span><span class="mono unit">{unitOf}</span>
    {:else}<span class="mono num">{g.val}</span><span class="mono unit">{g.unit}</span>{/if}
  </div>
  {#if g.series && g.from}
    <Chart values={g.series} from={g.from} to={now} min={g.max === 100 ? 0 : null} max={g.max === 100 ? 100 : null} minSpan={8} warn={g.warn} height={52} label={g.label} {format} bind:scrub />
    <div class="axis mono" aria-hidden="true"><span>−{hours} h</span><span>now</span></div>
  {:else}
    <!-- no history yet (a fresh install): the current fill as a bar -->
    <div class="bar"><div style:width="{pct}%"></div></div>
  {/if}
</div>

<style>
  .tile {
    --chart: var(--acc);
    display: flex; flex-direction: column; gap: 6px; min-width: 0;
    padding: 12px 14px 10px; border-radius: 14px; background: var(--surface-2);
  }
  .tile.lv-warn, .tile.lv-crit { --chart: var(--lv); }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .label { font-size: 13px; font-weight: 500; flex: none; }
  .sub { font-size: 11px; color: var(--muted); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub.at { color: var(--text); }
  .val { display: flex; align-items: baseline; gap: 5px; min-width: 0; white-space: nowrap; }
  .num { font-size: 24px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .unit { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
  .tile.lv-warn .num, .tile.lv-crit .num { color: var(--lv); }
  .axis { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); margin-top: -2px; }
  .bar { height: 6px; border-radius: 4px; background: var(--track); overflow: hidden; margin-top: 2px; }
  .bar > div { height: 100%; border-radius: 4px; background: var(--chart); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
</style>
