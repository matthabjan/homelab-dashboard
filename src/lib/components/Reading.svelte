<script lang="ts">
  import Chart from './Chart.svelte';

  // A Network reading as a tile like System's: what and where from, the current figures, then the last 24 h as a
  // chart (download filled, upload as a second line). Scrubbing the chart puts the figures at that time in the headline.
  interface Figures {
    /** the main figure, in --acc ("↓312", "51.0%") */
    a: string;
    /** a second figure, in --acc-2 ("↑40") */
    b?: string;
    unit: string;
  }
  interface Props {
    label: string;
    /** where it comes from, beside the label (and a link to it when `href` is set) */
    source?: string | null;
    href?: string | null;
    target: string;
    /** the figures now, and a line under them */
    current: Figures;
    detail?: string;
    values?: (number | null)[] | null;
    values2?: (number | null)[] | null;
    from?: number | null;
    now: number;
    /** the figures at a point of the chart */
    at: (v: number, v2: number | null) => Figures;
    /** for screen readers: one value said in words */
    format: (v: number) => string;
    min?: number | null;
    max?: number | null;
    minSpan?: number;
  }
  let { label, source, href, target, current, detail, values, values2, from, now, at, format, min = 0, max = null, minSpan = 1 }: Props = $props();
  let scrub = $state<{ v: number; v2?: number | null; ts: number } | null>(null);
  const shown = $derived(scrub ? at(scrub.v, scrub.v2 ?? null) : current);
  const charted = $derived((values ?? []).filter((v) => v != null).length > 1 && from != null);
  const hours = $derived(from ? Math.max(1, Math.round((now - from) / 3_600_000)) : 24);
  const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<div class="tile">
  <div class="head">
    <span class="label">{label}</span>
    {#if scrub}<span class="mono sub at">{hhmm(scrub.ts)}</span>
    {:else if source && href}<a class="sub src" href={href} target={target} rel="noopener">{source} ↗</a>
    {:else if source}<span class="sub">{source}</span>{/if}
  </div>
  <div class="val">
    <span class="mono num a">{shown.a}</span>
    {#if shown.b}<span class="mono num b">{shown.b}</span>{/if}
    <span class="mono unit">{shown.unit}</span>
  </div>
  {#if detail}<span class="detail muted">{detail}</span>{/if}
  {#if charted && values && from != null}
    <Chart {values} {values2} {from} to={now} {min} {max} {minSpan} height={52} {label} {format} bind:scrub />
    <div class="axis mono" aria-hidden="true"><span>−{hours} h</span><span>now</span></div>
  {/if}
</div>

<style>
  /* the System tile's look (Gauge.svelte), with up to two figures */
  .tile { --chart: var(--acc); --chart-2: var(--acc-2); display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 12px 14px 10px; border-radius: 14px; background: var(--surface-2); }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .label { font-size: 13px; font-weight: 500; flex: none; }
  .sub { font-size: 11px; color: var(--muted); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub.at { color: var(--text); }
  .src { color: var(--muted); text-decoration: none; font-size: 12px; }
  .src:hover { color: var(--acc); }
  .val { display: flex; align-items: baseline; gap: 8px; min-width: 0; white-space: nowrap; }
  .num { font-size: 24px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .a { color: var(--chart); }
  .b { color: var(--chart-2); }
  .unit { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; margin-left: -3px; }
  .detail { font-size: 12px; margin-top: -2px; }
  .axis { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); margin-top: -2px; }
</style>
