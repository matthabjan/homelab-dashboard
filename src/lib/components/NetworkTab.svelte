<script lang="ts">
  import type { Snapshot, Traffic } from '#lib/types';
  import { fmtCount, fmtRate } from '#lib/format.ts';
  import Reading from './Reading.svelte';

  // Network: WAN, LAN and DNS as tiles like System's, stacked in the sheet, side by side when the card is wide.
  interface Props {
    network: NonNullable<Snapshot['network']>;
    target: string;
    now: number;
    /** how far back the charts go, in words */
    span: (from: number | null | undefined) => string;
  }
  let { network, target, now, span }: Props = $props();
  /** the day's highest reading of a series, the band's when it has one */
  const peakOf = (vs: (number | null)[] | null | undefined) => {
    const ns = (vs ?? []).filter((v): v is number => v != null);
    return ns.length > 1 ? Math.max(...ns) : null;
  };
</script>

{#snippet traffic(t: Traffic, what: string)}
  <!-- one traffic reading as a tile: download filled with its band, upload as a second line, both in Mbit/s -->
  {@const top = peakOf(t.downHi ?? t.seriesDown)}
  <Reading
    label={what} source={t.source} href={t.href} {target} {now}
    names={['Down', 'Up']} current={[fmtRate(t.down), fmtRate(t.up)]} unit="Mbit/s" peak={top != null ? `peak ${fmtRate(top)}` : null}
    values={t.seriesDown} values2={t.seriesUp} lo={t.downLo} hi={t.downHi} from={t.from}
    at={(v, v2) => [fmtRate(v), fmtRate(v2)]}
    format={(v) => `${fmtRate(v)} Mbit/s down`}
  />
{/snippet}

<p class="span">{span(network.from ?? network.lan?.from)}</p>
<div class="net">
  {#if network.source}{@render traffic(network, 'WAN')}{/if}
  {#if network.lan}{@render traffic(network.lan, 'LAN')}{/if}
  {#if network.dns}
    {@const d = network.dns}
    <!-- DNS: queries per hour as bars with the blocked part, over the server's statistics interval when it reports
         one per hour (AdGuard); without that, just the figures -->
    <Reading
      label="DNS" source={d.name} href={d.href} {target} {now}
      names={['Queries', 'Blocked']} current={[fmtCount(d.queries), `${d.blockedPct.toFixed(1)}%`]} unit=""
      detail={d.period ? `Last ${d.period}` : undefined}
      bars values={d.series} values2={d.blockedCounts} from={d.series && d.stepMs ? now - d.series.length * d.stepMs : null}
      at={(v, v2) => [fmtCount(v), v ? `${(((v2 ?? 0) / v) * 100).toFixed(1)}%` : '—']}
      format={(v) => `${fmtCount(v)} queries`}
    />
  {/if}
</div>

<style>
  .span { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
  .net { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; }
</style>
