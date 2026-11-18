<script lang="ts">
  /**
   * Minimal sparkline. `values` may contain nulls (gaps). `minSpan` keeps a near-flat series from being blown up into
   * noise. Optionally a band (`lo`/`hi`: each bucket's lowest and highest reading), a second line (`values2`, in
   * --acc-2) and a dot on the latest reading.
   */
  interface Props {
    values?: (number | null)[] | null;
    values2?: (number | null)[] | null;
    lo?: (number | null)[] | null;
    hi?: (number | null)[] | null;
    max?: number | null;
    min?: number | null;
    minSpan?: number;
    color?: string;
    area?: boolean;
    dot?: boolean;
    height?: number;
    label?: string;
  }
  let { values = [], values2 = null, lo = null, hi = null, max = null, min = 0, minSpan = 0, color = 'var(--acc)', area = false, dot = false, height = 24, label = '' }: Props = $props();

  const W = 200;
  const H = 48;
  const isNum = (v: number | null | undefined): v is number => v != null;
  const geo = $derived.by(() => {
    const vs = values ?? [];
    const nums = vs.filter(isNum);
    if (nums.length < 2) return null;
    const band = lo && hi && lo.length === vs.length && hi.length === vs.length ? { lo, hi } : null;
    const tops = [...nums, ...(values2 ?? []).filter(isNum), ...(band ? band.hi.filter(isNum) : [])];
    let top = max ?? Math.max(...tops) * 1.1;
    let bottom = min ?? Math.min(...nums);
    if (top - bottom < minSpan) {
      bottom = Math.max(0, (top + bottom - minSpan) / 2);
      top = bottom + minSpan;
    }
    const span = top - bottom || 1;
    const step = W / (vs.length - 1);
    const y = (v: number) => H - 2 - ((Math.min(v, top) - bottom) / span) * (H - 4);
    const runs = (series: (number | null)[]) => {
      const segs: [number, number][][] = [];
      let cur: [number, number][] = [];
      series.forEach((v, i) => {
        if (v == null) { if (cur.length) segs.push(cur); cur = []; return; }
        cur.push([i * step, y(v)]);
      });
      if (cur.length) segs.push(cur);
      return segs;
    };
    const pts = (s: [number, number][]) => s.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
    const segs = runs(vs);
    const line = segs.map((s) => 'M' + pts(s)).join('');
    const line2 = values2 ? runs(values2).map((s) => 'M' + pts(s)).join('') : null;
    const fill = segs.filter((s) => s.length > 1).map((s) => `M${s[0][0].toFixed(1)},${H}L${pts(s)}L${s[s.length - 1][0].toFixed(1)},${H}Z`).join('');
    let bandPath = '';
    if (band) {
      const idx = vs.map((_, i) => i).filter((i) => band.lo[i] != null && band.hi[i] != null);
      if (idx.length > 1) bandPath = `M${idx.map((i) => `${(i * step).toFixed(1)},${y(band.hi[i] as number).toFixed(1)}`).join('L')}L${idx.reverse().map((i) => `${(i * step).toFixed(1)},${y(band.lo[i] as number).toFixed(1)}`).join('L')}Z`;
    }
    const last = vs.findLastIndex(isNum);
    return { line, line2, fill, band: bandPath, end: { x: (last * step) / W, y: y(vs[last] as number) / H } };
  });
</script>

{#if geo}
  <span class="spark" style:height="{height}px">
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}>
      {#if geo.band}<path d={geo.band} fill={color} fill-opacity="0.14" />{/if}
      {#if area}<path d={geo.fill} fill={color} fill-opacity={geo.band ? 0.08 : 0.13} />{/if}
      {#if geo.line2}<path d={geo.line2} fill="none" stroke="var(--acc-2)" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />{/if}
      <path d={geo.line} fill="none" stroke={color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>
    {#if dot}<span class="dot" style:left="{geo.end.x * 100}%" style:top="{geo.end.y * 100}%" style:background={color}></span>{/if}
  </span>
{/if}

<style>
  .spark { position: relative; display: block; width: 100%; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; }
  .dot { position: absolute; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface); pointer-events: none; }
  @media (prefers-reduced-motion: no-preference) {
    .dot::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: inherit; animation: ping 3s ease-out infinite; }
    @keyframes ping { 0% { transform: scale(1); opacity: 0.5; } 60%, 100% { transform: scale(2.6); opacity: 0; } }
  }
</style>
