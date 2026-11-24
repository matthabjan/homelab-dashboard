<script lang="ts">
  import Chart from './Chart.svelte';
  import Bars from './Bars.svelte';

  // A reading of one or two series as a chart card like System's: what and where from, a legend (a dot, a name and
  // the value of each series, the unit, the day's peak), then the last 24 h on a labelled scale: download filled,
  // upload as a second line, or (`bars`) DNS queries per hour with the blocked part. Scrubbing puts the values at that
  // time in the legend.
  interface Props {
    label: string;
    /** where it comes from, beside the label (and a link to it when `href` is set) */
    source?: string | null;
    href?: string | null;
    target: string;
    /** the series' names in the legend ("Down", "Up"); without them the value stands alone */
    names?: [string, string?];
    /** the values now, as shown */
    current: [string, string?];
    unit: string;
    /** a line under the legend ("68k queries · 24 h") */
    detail?: string;
    values?: (number | null)[] | null;
    values2?: (number | null)[] | null;
    lo?: (number | null)[] | null;
    hi?: (number | null)[] | null;
    from?: number | null;
    now: number;
    /** the values at a point of the chart, as shown */
    at: (v: number, v2: number | null) => [string, string?];
    /** for screen readers: one value said in words */
    format: (v: number) => string;
    /** the day's peak, after the unit ("peak 24.6") */
    peak?: string | null;
    /** queries per hour as bars, `values2` the blocked part of each */
    bars?: boolean;
    min?: number | null;
    minSpan?: number;
  }
  let { label, source, href, target, names, current, unit, detail, values, values2, lo, hi, from, now, at, format, peak, bars = false, min = 0, minSpan = 1 }: Props = $props();
  let scrub = $state<{ v: number; v2?: number | null; ts: number } | null>(null);
  const shown = $derived(scrub ? at(scrub.v, scrub.v2 ?? null) : current);
  const charted = $derived((values ?? []).filter((v) => v != null).length > 1 && from != null);
</script>

<div class="tile">
  <div class="head">
    <span class="label">{label}</span>
    {#if source && href}<a class="sub src" href={href} target={target} rel="noopener">{source} ↗</a>
    {:else if source}<span class="sub">{source}</span>{/if}
  </div>
  <div class="legend">
    {#each shown as v, i (i)}
      {#if v != null}
        <span class="item s{i}">{#if names?.[i]}<span class="sw" aria-hidden="true"></span><span class="k">{names[i]}</span>{/if}<span class="num v">{v}</span></span>
      {/if}
    {/each}
    {#if unit}<span class="k">{unit}</span>{/if}
    {#if peak && !scrub}<span class="k num">· {peak}</span>{/if}
  </div>
  {#if detail}<span class="detail muted">{detail}</span>{/if}
  {#if charted && values && from != null}
    {#if bars}
      <Bars {values} parts={values2} {from} to={now} {label} {format} bind:scrub />
    {:else}
      <Chart {values} {values2} {lo} {hi} {from} to={now} {min} {minSpan} {label} {format} bind:scrub />
    {/if}
  {/if}
</div>

<style>
  /* the System tile's look (Gauge.svelte), with a legend for up to two series */
  .tile { --chart: var(--acc); --chart-2: var(--acc-2); display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 12px 14px 8px; border-radius: var(--r-14); background: var(--surface-2); }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .label { font-size: var(--fs-13); font-weight: 500; flex: none; }
  .sub { font-size: var(--fs-12); color: var(--muted); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .src { color: var(--muted); text-decoration: none; font-size: var(--fs-12); }
  .src:hover { color: var(--acc); }
  .legend { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; min-width: 0; margin-bottom: 4px; }
  .item { display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
  .sw { width: 8px; height: 8px; border-radius: 50%; align-self: center; background: var(--chart); }
  .s1 .sw { background: var(--chart-2); }
  .k { font-size: var(--fs-12); color: var(--muted); white-space: nowrap; }
  .v { font-size: var(--fs-20); font-weight: 600; letter-spacing: -0.01em; line-height: 1.15; color: var(--chart); }
  .s1 .v { color: var(--chart-2); }
  .detail { font-size: var(--fs-12); margin-top: -4px; }
</style>
