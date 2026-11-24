<script lang="ts">
  import { onMount } from 'svelte';

  // Counts per period as bars on a labelled scale from 0 (DNS queries per hour), each with a part of it in the second
  // colour (the blocked ones). Same axes and scrubbing as Chart.svelte: the owner's legend shows the bar under the
  // pointer, the time sits on the axis under it.
  interface Props {
    values: (number | null)[];
    /** the part of each bar in --chart-2 */
    parts?: (number | null)[] | null;
    from: number;
    to: number;
    label: string;
    format: (v: number) => string;
    scrub?: { v: number; v2?: number | null; ts: number } | null;
  }
  let { values, parts = null, from, to, label, format, scrub = $bindable(null) }: Props = $props();

  const W = 300;
  let H = $state(120);
  const n = $derived(values.length);
  const nums = $derived(values.filter((v): v is number => v != null));
  const niceStep = (raw: number) => {
    const p = 10 ** Math.floor(Math.log10(raw || 1));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.9999) ?? 10 * p;
  };
  const top = $derived(nums.length ? 2 * niceStep(Math.max(...nums, 1) / 2) : 1);
  const ticks = $derived([0, top / 2, top]);
  const y = (v: number) => H - (Math.min(v, top) / top) * H;
  const tickText = (v: number) => (v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : String(Math.round(v)));
  const bw = $derived(W / Math.max(1, n));
  const gap = $derived(Math.min(3, bw * 0.25));

  let ready = $state(false);
  onMount(() => { ready = true; });
  const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const times = $derived.by(() => {
    if (!ready || to <= from) return [];
    const out: { left: number; text: string }[] = [];
    const t0 = new Date(from);
    t0.setMinutes(0, 0, 0);
    t0.setHours(Math.ceil((t0.getHours() + (from > t0.getTime() ? 1 : 0)) / 6) * 6);
    for (let t = t0.getTime(); t < to; t += 6 * 3_600_000) {
      const left = (t - from) / (to - from);
      if (left > 0.06 && left < 0.86) out.push({ left: left * 100, text: hhmm(t) });
    }
    return out;
  });

  const tsOf = (i: number) => from + ((i + 0.5) / n) * (to - from);
  let at = $state(-1);
  function pick(i: number) {
    at = Math.max(0, Math.min(n - 1, i));
    const v = values[at];
    scrub = v != null ? { v, v2: parts?.[at] ?? null, ts: tsOf(at) } : null;
  }
  function release() { at = -1; scrub = null; }
  function point(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pick(Math.floor(((e.clientX - r.left) / r.width) * n));
  }
  function key(e: KeyboardEvent) {
    const start = at >= 0 ? at : n - 1;
    const to = { ArrowLeft: start - 1, ArrowRight: start + 1, Home: 0, End: n - 1 }[e.key];
    if (to == null) { if (e.key === 'Escape') release(); return; }
    e.preventDefault();
    pick(to);
  }
  const summary = $derived(nums.length ? `${label}, last ${Math.max(1, Math.round((to - from) / 3_600_000))} hours: low ${format(Math.min(...nums))}, high ${format(Math.max(...nums))}` : label);
</script>

{#if nums.length > 1}
  <div class="chart">
    <div class="yax" aria-hidden="true">{#each ticks as t, i (i)}<span style:top="{y(t)}px">{tickText(t)}</span>{/each}</div>
    <div
      class="plot" role="slider" tabindex="0" bind:clientHeight={H}
      aria-label={summary} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={at >= 0 ? at : n - 1}
      aria-valuetext={at >= 0 && values[at] != null ? `${hhmm(tsOf(at))}, ${format(values[at] as number)}` : summary}
      onpointermove={point} onpointerdown={point} onpointerleave={release} onpointercancel={release} onkeydown={key} onblur={release}
    >
      <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
        {#each ticks as t, i (i)}<line class="grid" x1="0" x2={W} y1={y(t)} y2={y(t)} />{/each}
        {#each values as v, i (i)}
          {#if v != null && v > 0}
            {@const p = Math.min(v, parts?.[i] ?? 0)}
            <rect class="bar" class:on={at === i} x={i * bw + gap / 2} y={y(v)} width={bw - gap} height={y(p) - y(v)} />
            {#if p > 0}<rect class="part" class:on={at === i} x={i * bw + gap / 2} y={y(p)} width={bw - gap} height={H - y(p)} />{/if}
          {/if}
        {/each}
      </svg>
    </div>
    <div class="xax" class:scrubbing={at >= 0} aria-hidden="true">
      {#each times as t (t.left)}<span style:left="{t.left}%">{t.text}</span>{/each}
      <span class="end">now</span>
      {#if at >= 0 && ready}<span class="at" style:left="clamp(18px, {((at + 0.5) / n) * 100}%, calc(100% - 18px))">{hhmm(tsOf(at))}</span>{/if}
    </div>
  </div>
{/if}

<style>
  /* Chart.svelte's frame */
  .chart { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 6px; }
  .yax { position: relative; min-width: 2.4ch; font-size: var(--fs-11); line-height: 1; color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
  .yax span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; }
  .plot { position: relative; height: var(--chart-h, 120px); cursor: crosshair; touch-action: pan-y; outline: none; border-radius: var(--r-4); }
  .plot:focus-visible { box-shadow: 0 0 0 2px var(--acc); }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .grid { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .bar { fill: var(--chart, var(--acc)); fill-opacity: 0.45; }
  .part { fill: var(--chart-2, var(--acc-2)); fill-opacity: 0.85; }
  .bar.on { fill-opacity: 0.8; }
  .part.on { fill-opacity: 1; }
  .xax { grid-column: 2; position: relative; height: 17px; font-size: var(--fs-11); line-height: 1; color: var(--muted); font-variant-numeric: tabular-nums; }
  .xax span { position: absolute; top: 5px; transform: translateX(-50%); white-space: nowrap; transition: opacity 0.15s; }
  .xax .end { left: auto; right: 0; transform: none; }
  .xax.scrubbing span:not(.at) { opacity: 0.25; }
  .xax .at { color: var(--text); font-weight: 500; }
</style>
