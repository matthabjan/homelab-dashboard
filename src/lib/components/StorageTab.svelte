<script lang="ts">
  import type { Snapshot } from '#lib/types';
  import { grouped, moved } from '#lib/logic.ts';
  import Group from './Group.svelte';
  import BarRow from './BarRow.svelte';

  // Storage: grouped by the service that reports them; the order inside stays stable. A storage's row is its name and
  // fill, then its size (or why it is off) and the bar with a tick where it turns amber. An off row (unavailable,
  // detached) is grey, the bar at the last known fill.
  interface Props {
    storage: Snapshot['storage'];
    now: number;
  }
  let { storage, now }: Props = $props();
  const groups = $derived(grouped(storage));
</script>

{#each groups as g (g.name)}
  <Group name={g.name}>
    {#each g.rows as s (s.name)}
      {@const m = moved(s.trend, '%', now)}
      <BarRow
        name={s.name} level={s.level} value={s.pct != null ? `${Math.round(s.pct)}%` : '—'}
        meta={s.sub} aligned fill={s.pct ?? 0} tick={s.warn}
        title="{s.name} · {s.sub}{m ? ` · ${m.text}` : ''}"
      />
    {/each}
  </Group>
{/each}
