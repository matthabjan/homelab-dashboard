<script lang="ts">
  import type { Gauge } from '#lib/types';
  import Sparkline from './Sparkline.svelte';

  // A reading that barely moves in a day (memory, disk fill) as one row: name and detail, the value, a bar with a tick
  // where it turns amber, and a small line of its 24 h with the change over them. A full chart would be a flat line.
  interface Props {
    g: Gauge;
  }
  let { g }: Props = $props();
  const pct = $derived(Math.max(0, Math.min(100, g.pct ?? 0)));
  /** how far it moved over the day, in percentage points */
  const change = $derived.by(() => {
    const vs = (g.series ?? []).filter((v): v is number => v != null);
    if (vs.length < 2) return null;
    const d = vs[vs.length - 1] - vs[0];
    return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts`;
  });
</script>

<div class="meter lv-{g.level}" class:alert={g.level === 'warn' || g.level === 'crit'}>
  <span class="name">{g.label}{#if g.sub}<small>{g.sub}</small>{/if}</span>
  <span class="v num">{g.val}<span class="unit">{g.unit}</span></span>
  <span class="track" title={g.warn != null ? `amber from ${g.warn}%` : undefined}>
    <span class="fill" style:width="{pct}%"></span>
    {#if g.warn != null}<span class="tick" style:left="{g.warn}%"></span>{/if}
  </span>
  {#if change}
    <span class="day num"><span class="spark"><Sparkline values={g.series} min={null} minSpan={2} height={16} color="var(--fill)" /></span>24 h {change}</span>
  {/if}
</div>

<style>
  .meter { --fill: var(--acc); display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'n v' 'b d'; align-items: center; gap: 6px 14px; padding: 11px 0; }
  .meter + :global(.meter) { border-top: 1px solid var(--line); }
  .meter.alert { --fill: var(--lv); }
  .name { grid-area: n; display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: var(--fs-13); font-weight: 500; }
  .name small { font-size: var(--fs-12); font-weight: 400; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .v { grid-area: v; font-size: var(--fs-15); font-weight: 600; text-align: right; }
  .meter.alert .v { color: var(--lv); }
  .unit { margin-left: 2px; font-size: var(--fs-12); font-weight: 400; color: var(--muted); }
  .num { white-space: nowrap; }
  .track { grid-area: b; position: relative; height: 6px; border-radius: var(--r-4); background: var(--track); }
  .fill { position: absolute; inset: 0 auto 0 0; border-radius: var(--r-4); background: var(--fill); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .tick { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: var(--warn); opacity: 0.75; }
  .day { grid-area: d; display: flex; align-items: center; gap: 8px; font-size: var(--fs-11); color: var(--muted); }
  .spark { display: block; width: 56px; }
</style>
