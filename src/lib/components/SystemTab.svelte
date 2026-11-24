<script lang="ts">
  import type { Snapshot } from '#lib/types';
  import { fmtMBs } from '#lib/format.ts';
  import Gauge from './Gauge.svelte';
  import MeterRow from './MeterRow.svelte';
  import Reading from './Reading.svelte';

  // System: what barely moves in a day (memory, disk fill) as meter rows in one box, then a chart for each reading
  // that does: CPU, disk I/O, temperature.
  interface Props {
    host: NonNullable<Snapshot['host']>;
    target: string;
    /** when the snapshot was made: the right edge of every history */
    now: number;
    /** how far back the charts go, in words */
    span: (from: number | null | undefined) => string;
  }
  let { host, target, now, span }: Props = $props();
  const meters = $derived(host.gauges.filter((g) => g.view === 'meter'));
  const charts = $derived(host.gauges.filter((g) => g.view === 'chart'));
</script>

{#if meters.length}<div class="meters">{#each meters as g (g.key)}<MeterRow {g} />{/each}</div>{/if}
<p class="span">{span(host.gauges.find((g) => g.from)?.from)}</p>
<div class="gauges">
  {#each charts.filter((g) => g.key === 'cpu') as g (g.key)}<Gauge {g} {now} />{/each}
  {#if host.io}
    {@const io = host.io}
    <Reading
      label="Disk I/O" source={io.source} {target} {now}
      names={['Read', 'Write']} current={[fmtMBs(io.read), fmtMBs(io.write)]} unit="MB/s"
      values={io.seriesRead} values2={io.seriesWrite} from={io.from}
      at={(v, v2) => [fmtMBs(v), fmtMBs(v2)]}
      format={(v) => `${fmtMBs(v)} MB/s read`}
    />
  {/if}
  {#each charts.filter((g) => g.key !== 'cpu') as g (g.key)}<Gauge {g} {now} />{/each}
</div>

<style>
  .meters { display: flex; flex-direction: column; padding: 0 14px; margin-bottom: 14px; border-radius: var(--r-14); background: var(--surface-2); }
  /* chart tiles like Network's, one per row in the sheet, side by side only where the card is wide */
  .gauges { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; }
  .span { margin: 0 0 10px; font-size: var(--fs-12); color: var(--muted); }
</style>
