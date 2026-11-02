<script lang="ts">
  // An interactive 24 h area chart: a smooth line over a fading fill, a dashed line where the value turns amber, and
  // the latest point marked. Hover, touch-drag or the arrow keys scrub through it; the owner shows the point under
  // the pointer in its own headline (`scrub`), so the chart needs no tooltip and stays readable at tile size.
  // A second series (`values2`: upload next to download) is a plain line on the same scale, in --chart-2.
  interface Props {
    values: (number | null)[];
    values2?: (number | null)[] | null;
    /** the first bucket's start and the last one's end (ms) */
    from: number;
    to: number;
    /** fixed ends of the scale (a percentage: 0 and 100); null fits the data */
    min?: number | null;
    max?: number | null;
    /** the smallest span the scale shows, so a near-flat series stays flat instead of turning into noise */
    minSpan?: number;
    warn?: number | null;
    height?: number;
    /** what it shows, for screen readers: "CPU" */
    label: string;
    format: (v: number) => string;
    /** the point under the pointer, null when not scrubbing */
    scrub?: { v: number; v2?: number | null; ts: number } | null;
  }
  let { values, values2 = null, from, to, min = null, max = null, minSpan = 0, warn = null, height = 56, label, format, scrub = $bindable(null) }: Props = $props();

  const W = 300;
  const uid = $props.id();
  const n = $derived(values.length);
  const nums = $derived(values.filter((v): v is number => v != null));
  const nums2 = $derived((values2 ?? []).filter((v): v is number => v != null));

  const scale = $derived.by(() => {
    if (nums.length < 2) return null;
    let lo = min ?? Math.min(...nums, ...nums2);
    // the warning line is always in view (a temperature far below its limit shows how much headroom is left)
    let hi = max ?? Math.max(...nums, ...nums2, ...(warn != null ? [warn] : []));
    if (min == null && max == null) {
      const pad = (hi - lo) * 0.15;
      lo -= pad;
      hi += pad;
    }
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = min ?? mid - minSpan / 2;
      hi = max ?? lo + minSpan;
      if (min == null && lo < 0 && Math.min(...nums) >= 0) { lo = 0; hi = minSpan; }
    }
    return { lo, hi };
  });
  const H = $derived(height);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v: number) => (scale ? H - 2 - ((Math.max(scale.lo, Math.min(scale.hi, v)) - scale.lo) / (scale.hi - scale.lo || 1)) * (H - 6) : H);

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
  const geo = $derived.by(() => {
    if (!scale) return null;
    const segs = runs(values);
    const line = segs.map(smooth).join('');
    const line2 = values2 ? runs(values2).map(smooth).join('') : null;
    const fill = segs.filter((s) => s.length > 1).map((s) => `${smooth(s)}L${s[s.length - 1][0].toFixed(1)},${H}L${s[0][0].toFixed(1)},${H}Z`).join('');
    const last = values.findLastIndex((v) => v != null);
    const warnY = warn != null && warn >= scale.lo && warn <= scale.hi ? y(warn) : null;
    return { line, line2, fill, last, warnY };
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

  const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const summary = $derived(nums.length ? `${label}, last ${Math.max(1, Math.round((to - from) / 3_600_000))} hours: low ${format(Math.min(...nums))}, high ${format(Math.max(...nums))}, now ${format(nums[nums.length - 1])}` : label);
  const pos = (i: number) => ({ left: `${(x(i) / W) * 100}%`, top: `${y(values[i] as number)}px` });
</script>

{#if geo}
  <!-- a slider for keyboards and screen readers: arrows move through the day, the value text says when and what -->
  <div
    class="chart" style:height="{H}px" role="slider" tabindex="0"
    aria-label={summary} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={at >= 0 ? at : geo.last}
    aria-valuetext={at >= 0 && values[at] != null ? `${hhmm(tsOf(at))}, ${format(values[at] as number)}` : summary}
    onpointermove={point} onpointerdown={point} onpointerleave={release} onpointercancel={release} onkeydown={key} onblur={release}
  >
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="fill-{uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--c)" stop-opacity="0.28" />
          <stop offset="1" stop-color="var(--c)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={geo.fill} fill="url(#fill-{uid})" />
      {#if geo.warnY != null}<line class="warn" x1="0" x2={W} y1={geo.warnY} y2={geo.warnY} />{/if}
      {#if geo.line2}<path class="line two" d={geo.line2} />{/if}
      <path class="line" d={geo.line} />
    </svg>
    <!-- what the dashed line is: its value, at its right end -->
    {#if geo.warnY != null && warn != null}<span class="warn-label" style:top="{geo.warnY}px">{format(warn)}</span>{/if}
    {#if at >= 0}
      <span class="cross" style:left={pos(at).left}></span>
      {#if values2?.[at] != null}<span class="dot two" style:left={pos(at).left} style:top="{y(values2[at] as number)}px"></span>{/if}
      <span class="dot" style:left={pos(at).left} style:top={pos(at).top}></span>
    {:else if geo.last >= 0}
      <span class="dot now" style:left={pos(geo.last).left} style:top={pos(geo.last).top}></span>
    {/if}
  </div>
{/if}

<style>
  .chart { --c: var(--chart, var(--acc)); position: relative; width: 100%; cursor: crosshair; touch-action: pan-y; outline: none; border-radius: 6px; }
  .chart:focus-visible { box-shadow: 0 0 0 2px var(--acc); }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .line { fill: none; stroke: var(--c); stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .line.two, .dot.two { --c: var(--chart-2, var(--acc-2)); }
  .line.two { stroke-width: 1.5; }
  .warn-label { position: absolute; right: 0; transform: translateY(calc(-100% - 2px)); font-size: 10px; line-height: 1; font-variant-numeric: tabular-nums; color: var(--warn); opacity: 0.9; pointer-events: none; }
  .warn { stroke: var(--warn); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.7; vector-effect: non-scaling-stroke; }
  .cross { position: absolute; top: 0; bottom: 0; width: 1px; transform: translateX(-0.5px); background: color-mix(in srgb, var(--text) 30%, transparent); pointer-events: none; }
  .dot { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 2px var(--surface-2, var(--surface)); pointer-events: none; }
  /* the latest reading pulses once a few seconds, so "now" is easy to find */
  @media (prefers-reduced-motion: no-preference) {
    .dot.now::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--c); animation: ping 3s ease-out infinite; }
    @keyframes ping { 0% { transform: scale(1); opacity: 0.5; } 60%, 100% { transform: scale(2.6); opacity: 0; } }
  }
</style>
