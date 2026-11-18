<script lang="ts">
  import type { Gauge } from '#lib/types';
  import Chart from './Chart.svelte';

  // One System reading as a chart card: its name and detail, the value now with the day's peak, then its last 24 h on
  // a labelled scale. Scrubbing the chart puts the value at that time in the legend; the chart shows the time.
  interface Props {
    g: Gauge;
    /** when the snapshot was made: the chart's right edge */
    now: number;
  }
  let { g, now }: Props = $props();
  let scrub = $state<{ v: number; ts: number } | null>(null);
  const pct = $derived(Math.max(0, Math.min(100, g.pct ?? 0)));
  // the history is in the headline's unit (% or °C), so a scrubbed point takes the headline's place
  const isPct = $derived(g.max === 100);
  const unitOf = $derived(isPct ? '%' : g.unit);
  const format = (v: number) => `${Math.round(v)} ${unitOf}`;
  /** the day's peak: the highest reading, not the highest 15-minute average */
  const peak = $derived.by(() => {
    const vs = (g.hi ?? g.series ?? []).filter((v): v is number => v != null);
    return vs.length > 1 ? Math.round(Math.max(...vs)) : null;
  });
</script>

<div class="tile lv-{g.level}">
  <div class="head">
    <span class="label">{g.label}</span>
    {#if g.sub}<span class="sub">{g.sub}</span>{/if}
  </div>
  <div class="val">
    <span class="num big">{scrub ? Math.round(scrub.v) : g.val}</span><span class="unit">{unitOf}</span>
    {#if peak != null}<span class="peak num">· peak {peak}</span>{/if}
  </div>
  {#if g.series && g.from}
    <!-- percentages start at 0 and fit their top (2B); a temperature fits both ends and keeps its limit in view -->
    <Chart
      values={g.series} lo={g.lo} hi={g.hi} from={g.from} to={now}
      min={isPct ? 0 : null} max={isPct ? 100 : null} minSpan={20} warn={g.warn} warnInView={!isPct}
      label={g.label} {format} bind:scrub
    />
  {:else}
    <!-- no history yet (a fresh install): the current fill as a bar -->
    <div class="bar"><div style:width="{pct}%"></div></div>
  {/if}
</div>

<style>
  .tile {
    --chart: var(--acc);
    display: flex; flex-direction: column; gap: 6px; min-width: 0;
    padding: 12px 14px 8px; border-radius: 14px; background: var(--surface-2);
  }
  .tile.lv-warn, .tile.lv-crit { --chart: var(--lv); }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .label { font-size: 13px; font-weight: 500; flex: none; }
  .sub { font-size: 12px; color: var(--muted); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .val { display: flex; align-items: baseline; gap: 3px; min-width: 0; white-space: nowrap; margin-bottom: 4px; }
  .num { font-variant-numeric: tabular-nums; }
  .big { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.15; }
  .unit { font-size: 12px; color: var(--muted); }
  .peak { margin-left: 6px; font-size: 12px; color: var(--muted); }
  .tile.lv-warn .big, .tile.lv-crit .big { color: var(--lv); }
  .bar { height: 6px; border-radius: 4px; background: var(--track); overflow: hidden; margin: 2px 0 6px; }
  .bar > div { height: 100%; border-radius: 4px; background: var(--chart); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
</style>
