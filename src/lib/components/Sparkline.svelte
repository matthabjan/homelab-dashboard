<script lang="ts">
  /** Minimal sparkline. `values` may contain nulls (gaps). `minSpan` keeps a near-flat series from being blown up into noise. */
  interface Props {
    values?: (number | null)[] | null;
    max?: number | null;
    min?: number | null;
    minSpan?: number;
    color?: string;
    area?: boolean;
    height?: number;
    dashed?: boolean;
    label?: string;
  }
  let { values = [], max = null, min = 0, minSpan = 0, color = 'var(--acc)', area = false, height = 24, dashed = false, label = '' }: Props = $props();

  const W = 200;
  const H = 48;
  const geo = $derived.by(() => {
    const vs = values ?? [];
    const nums = vs.filter((v): v is number => v != null);
    if (nums.length < 2) return null;
    let hi = max ?? Math.max(...nums) * 1.1;
    let lo = min ?? Math.min(...nums);
    if (hi - lo < minSpan) {
      lo = Math.max(0, (hi + lo - minSpan) / 2);
      hi = lo + minSpan;
    }
    const span = hi - lo || 1;
    const step = W / (vs.length - 1);
    const segs: [number, number][][] = [];
    let cur: [number, number][] = [];
    vs.forEach((v, i) => {
      if (v == null) { if (cur.length) segs.push(cur); cur = []; return; }
      const y = H - 2 - ((Math.min(v, hi) - lo) / span) * (H - 4);
      cur.push([i * step, y]);
    });
    if (cur.length) segs.push(cur);
    const line = segs.map((s) => 'M' + s.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L')).join('');
    const fill = segs
      .filter((s) => s.length > 1)
      .map((s) => `M${s[0][0].toFixed(1)},${H}L` + s.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + `L${s[s.length - 1][0].toFixed(1)},${H}Z`)
      .join('');
    return { line, fill };
  });
</script>

{#if geo}
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" style:height="{height}px" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}>
    {#if area}<path d={geo.fill} fill={color} fill-opacity="0.13" />{/if}
    <path d={geo.line} fill="none" stroke={color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" stroke-dasharray={dashed ? '3 3' : undefined} />
  </svg>
{/if}

<style>
  svg { width: 100%; display: block; overflow: visible; }
</style>
