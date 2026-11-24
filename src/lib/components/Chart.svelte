<script lang="ts">
  import { onMount } from 'svelte';

  // A 24 h chart with a scale you can read: three labelled values on the left over a faint grid, the time every 6 h
  // underneath, a smooth line over a fading fill and, where the owner has them, a band from each bucket's lowest to its
  // highest reading (a spike the 15-minute average flattens stays visible). A second series (`values2`: upload next to
  // download) is a plain line on the same scale, in --chart-2. A dashed line marks where the value turns amber; when
  // that is above the scale, a note in the corner says so instead.
  // Hover, touch-drag or the arrow keys scrub through it: the owner shows the values under the pointer in its legend
  // (`scrub`), the chart puts the time on its axis, so nothing covers the line.
  interface Props {
    values: (number | null)[];
    values2?: (number | null)[] | null;
    /** each bucket's lowest and highest reading of `values` (same length) */
    lo?: (number | null)[] | null;
    hi?: (number | null)[] | null;
    /** the first bucket's start and the last one's end (ms) */
    from: number;
    to: number;
    /** where the scale starts (0 for a percentage or a rate); null fits it to the data */
    min?: number | null;
    /** the scale never goes above this (100 for a percentage) */
    max?: number | null;
    /** the smallest span the scale shows, so a near-flat series stays flat instead of turning into noise */
    minSpan?: number;
    warn?: number | null;
    /** keep the warning line in view (a temperature far below its limit shows how much headroom is left) */
    warnInView?: boolean;
    /** what it shows, for screen readers: "CPU" */
    label: string;
    format: (v: number) => string;
    /** the axis labels; by default whole numbers, one decimal below 10 */
    tick?: (v: number) => string;
    /** the point under the pointer, null when not scrubbing */
    scrub?: { v: number; v2?: number | null; ts: number } | null;
  }
  let { values, values2 = null, lo = null, hi = null, from, to, min = null, max = null, minSpan = 0, warn = null, warnInView = false, label, format, tick, scrub = $bindable(null) }: Props = $props();

  const W = 300;
  const uid = $props.id();
  // the plot's height comes from CSS (--chart-h), so phones and the desktop sheet can differ with one markup
  let H = $state(120);
  const n = $derived(values.length);
  const isNum = (v: number | null | undefined): v is number => v != null;
  const nums = $derived(values.filter(isNum));
  const band = $derived(lo && hi && lo.length === n && hi.length === n ? { lo, hi } : null);

  /** the first of 1, 2, 2.5, 5 (× a power of ten) at least as big as `raw` */
  function niceStep(raw: number): number {
    const p = 10 ** Math.floor(Math.log10(raw || 1));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.9999) ?? 10 * p;
  }
  /** three ticks on nice values: the floor (0 when `min` says so), the middle, the top */
  const scale = $derived.by(() => {
    if (nums.length < 2) return null;
    const all = [...nums, ...(values2 ?? []).filter(isNum), ...(band ? band.hi.filter(isNum) : [])];
    const top = Math.max(...all, ...(warnInView && warn != null ? [warn] : []));
    const bottom = min ?? Math.min(...nums, ...(band ? band.lo.filter(isNum) : []), ...(values2 ?? []).filter(isNum));
    let step = niceStep(Math.max(top - bottom, minSpan, 1e-6) / 2);
    let start = min ?? Math.floor(bottom / step) * step;
    // flooring the start can leave the top out: widen the step until two of them cover it
    while (start + 2 * step < top) { step = niceStep(step * 1.01); start = min ?? Math.floor(bottom / step) * step; }
    let end = start + 2 * step;
    if (max != null && end > max) end = max;
    if (min == null && bottom >= 0 && start < 0) { start = 0; end = Math.max(end, 2 * step); }
    return { lo: start, hi: end, ticks: [start, (start + end) / 2, end] };
  });
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v: number) => (scale ? H - 1 - ((Math.max(scale.lo, Math.min(scale.hi, v)) - scale.lo) / (scale.hi - scale.lo || 1)) * (H - 2) : H);
  const tickText = (v: number) => (tick ? tick(v) : Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1));

  /** Monotone cubic (Fritsch–Carlson): smooth, but never overshoots a peak or dips below a valley. */
  function smooth(pts: [number, number][]): string {
    if (pts.length < 3) return 'M' + pts.map((p) => p.map((c) => c.toFixed(1)).join(',')).join('L');
    const k = pts.length;
    const d = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / (p[0] - pts[i][0]));
    const m = pts.map((_, i) => (i === 0 ? d[0] : i === k - 1 ? d[k - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
    for (let i = 0; i < k - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    let path = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < k - 1; i++) {
      const dx = (pts[i + 1][0] - pts[i][0]) / 3;
      path += `C${(pts[i][0] + dx).toFixed(1)},${(pts[i][1] + m[i] * dx).toFixed(1)} ${(pts[i + 1][0] - dx).toFixed(1)},${(pts[i + 1][1] - m[i + 1] * dx).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
    }
    return path;
  }

  /** a series' runs of recorded points: a gap (nothing recorded) breaks the line instead of bridging it */
  function runs(vs: (number | null)[]): [number, number][][] {
    const segs: [number, number][][] = [];
    let cur: [number, number][] = [];
    vs.forEach((v, i) => {
      if (v == null) { if (cur.length) segs.push(cur); cur = []; return; }
      cur.push([x(i), y(v)]);
    });
    if (cur.length) segs.push(cur);
    return segs;
  }
  /** the band: along the highs, back along the lows, per run where both are known */
  function bandPath(b: { lo: (number | null)[]; hi: (number | null)[] }): string {
    let path = '';
    let run: number[] = [];
    const flush = () => {
      if (run.length > 1) {
        const top = run.map((i) => `${x(i).toFixed(1)},${y(b.hi[i] as number).toFixed(1)}`);
        const bot = run.map((i) => `${x(i).toFixed(1)},${y(b.lo[i] as number).toFixed(1)}`).reverse();
        path += `M${top.join('L')}L${bot.join('L')}Z`;
      }
      run = [];
    };
    for (let i = 0; i < n; i++) { if (b.lo[i] != null && b.hi[i] != null) run.push(i); else flush(); }
    flush();
    return path;
  }
  const geo = $derived.by(() => {
    if (!scale) return null;
    const segs = runs(values);
    const line = segs.map(smooth).join('');
    const line2 = values2 ? runs(values2).map(smooth).join('') : null;
    const fill = segs.filter((s) => s.length > 1).map((s) => `${smooth(s)}L${s[s.length - 1][0].toFixed(1)},${H}L${s[0][0].toFixed(1)},${H}Z`).join('');
    const last = values.findLastIndex((v) => v != null);
    const warnY = warn != null && warn >= scale.lo && warn <= scale.hi ? y(warn) : null;
    return { line, line2, fill, band: band ? bandPath(band) : null, last, warnY, grid: scale.ticks.map(y) };
  });

  // the times on the axis are the viewer's, so they are drawn once the page runs in the browser
  let ready = $state(false);
  onMount(() => { ready = true; });
  const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  /** a label every 6 hours on the clock (00:00, 06:00, …), none crowding either end, and "now" at the right */
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
  const nearest = (i: number) => {
    for (let d = 0; d < n; d++) {
      if (values[i - d] != null) return i - d;
      if (values[i + d] != null) return i + d;
    }
    return -1;
  };
  let at = $state(-1);
  function pick(i: number) {
    at = nearest(Math.max(0, Math.min(n - 1, i)));
    const v = values[at];
    scrub = at >= 0 && v != null ? { v, v2: values2?.[at] ?? null, ts: tsOf(at) } : null;
  }
  function release() { at = -1; scrub = null; }
  function point(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pick(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
  }
  function key(e: KeyboardEvent) {
    const start = at >= 0 ? at : (geo?.last ?? n - 1);
    const to = { ArrowLeft: start - 1, ArrowRight: start + 1, Home: 0, End: n - 1 }[e.key];
    if (to == null) { if (e.key === 'Escape') release(); return; }
    e.preventDefault();
    pick(to);
  }

  const summary = $derived(nums.length ? `${label}, last ${Math.max(1, Math.round((to - from) / 3_600_000))} hours: low ${format(Math.min(...nums))}, high ${format(Math.max(...nums))}, now ${format(nums[nums.length - 1])}` : label);
  const left = (i: number) => `${(x(i) / W) * 100}%`;
</script>

{#if geo && scale}
  <div class="chart">
    <div class="yax" aria-hidden="true">
      {#each scale.ticks as t, i (i)}<span style:top="{geo.grid[i]}px">{tickText(t)}</span>{/each}
    </div>
    <!-- a slider for keyboards and screen readers: arrows move through the day, the value text says when and what -->
    <div
      class="plot" role="slider" tabindex="0" bind:clientHeight={H}
      aria-label={summary} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={at >= 0 ? at : geo.last}
      aria-valuetext={at >= 0 && values[at] != null ? `${hhmm(tsOf(at))}, ${format(values[at] as number)}` : summary}
      onpointermove={point} onpointerdown={point} onpointerleave={release} onpointercancel={release} onkeydown={key} onblur={release}
    >
      <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="fill-{uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--c)" stop-opacity="0.24" />
            <stop offset="1" stop-color="var(--c)" stop-opacity="0" />
          </linearGradient>
        </defs>
        {#each geo.grid as gy, i (i)}<line class="grid" x1="0" x2={W} y1={gy} y2={gy} />{/each}
        {#if geo.band}<path class="band" d={geo.band} />{/if}
        <path d={geo.fill} fill="url(#fill-{uid})" />
        {#if geo.warnY != null}<line class="warn" x1="0" x2={W} y1={geo.warnY} y2={geo.warnY} />{/if}
        {#if geo.line2}<path class="line two" d={geo.line2} />{/if}
        <path class="line" d={geo.line} />
      </svg>
      <!-- what the dashed line is; above the scale, a note says where it would be -->
      {#if geo.warnY != null && warn != null}<span class="warn-label" style:top="{geo.warnY}px">{format(warn)}</span>
      {:else if warn != null && warn > scale.hi}<span class="warn-label above">limit {format(warn)} ↑</span>{/if}
      {#if at >= 0}
        <span class="cross" style:left={left(at)}></span>
        {#if values2?.[at] != null}<span class="dot two" style:left={left(at)} style:top="{y(values2[at] as number)}px"></span>{/if}
        <span class="dot" style:left={left(at)} style:top="{y(values[at] as number)}px"></span>
      {:else if geo.last >= 0}
        <span class="dot now" style:left={left(geo.last)} style:top="{y(values[geo.last] as number)}px"></span>
      {/if}
    </div>
    <div class="xax" class:scrubbing={at >= 0} aria-hidden="true">
      {#each times as t (t.left)}<span style:left="{t.left}%">{t.text}</span>{/each}
      <span class="end">now</span>
      {#if at >= 0 && ready}<span class="at" style:left="clamp(18px, {left(at)}, calc(100% - 18px))">{hhmm(tsOf(at))}</span>{/if}
    </div>
  </div>
{/if}

<style>
  .chart { --c: var(--chart, var(--acc)); display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 6px; }
  .yax { position: relative; min-width: 2.4ch; font-size: var(--fs-11); line-height: 1; color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
  .yax span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; }
  .plot { position: relative; height: var(--chart-h, 120px); cursor: crosshair; touch-action: pan-y; outline: none; border-radius: var(--r-4); }
  .plot:focus-visible { box-shadow: 0 0 0 2px var(--acc); }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .grid { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .band { fill: var(--c); fill-opacity: 0.14; }
  .line { fill: none; stroke: var(--c); stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .line.two, .dot.two { --c: var(--chart-2, var(--acc-2)); }
  .line.two { stroke-width: 1.5; }
  .warn { stroke: var(--warn); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.75; vector-effect: non-scaling-stroke; }
  .warn-label { position: absolute; right: 0; transform: translateY(calc(-100% - 2px)); font-size: var(--fs-11); line-height: 1; font-variant-numeric: tabular-nums; color: var(--warn); opacity: 0.9; pointer-events: none; }
  .warn-label.above { top: 0; transform: translateY(calc(-100% - 3px)); }
  .cross { position: absolute; top: 0; bottom: 0; width: 1px; transform: translateX(-0.5px); background: color-mix(in srgb, var(--text) 35%, transparent); pointer-events: none; }
  .dot { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 2px var(--surface-2, var(--surface)); pointer-events: none; }
  /* the latest reading pulses once a few seconds, so "now" is easy to find */
  @media (prefers-reduced-motion: no-preference) {
    .dot.now::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--c); animation: ping 3s ease-out infinite; }
    @keyframes ping { 0% { transform: scale(1); opacity: 0.5; } 60%, 100% { transform: scale(2.6); opacity: 0; } }
  }
  /* times: every 6 h, "now" at the right; while scrubbing the others fade and the point's time sits under the cross */
  .xax { grid-column: 2; position: relative; height: 17px; font-size: var(--fs-11); line-height: 1; color: var(--muted); font-variant-numeric: tabular-nums; }
  .xax span { position: absolute; top: 5px; transform: translateX(-50%); white-space: nowrap; transition: opacity 0.15s; }
  .xax .end { left: auto; right: 0; transform: none; }
  .xax.scrubbing span:not(.at) { opacity: 0.25; }
  .xax .at { color: var(--text); font-weight: 500; }
</style>
