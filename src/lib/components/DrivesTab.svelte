<script lang="ts">
  import type { Snapshot } from '#lib/types';
  import { grouped } from '#lib/logic.ts';
  import Group from './Group.svelte';
  import BarRow from './BarRow.svelte';

  // Drives: grouped by where they sit, like Storage. A drive's row is its model, temperature and (only when it is not
  // ok) its SMART verdict, then what it is and its life left as a labelled bar. The rest is in the tooltip.
  interface Props {
    drives: Snapshot['drives'];
  }
  let { drives }: Props = $props();
  type Drive = Snapshot['drives'][number];
  const groups = $derived(grouped(drives));
  /** the drive's meta without its place, which its group already says ("NVMe · 1 TB · pve" under "pve") */
  const metaOf = (d: Drive) => (d.meta.endsWith(` · ${d.group}`) ? d.meta.slice(0, -(d.group.length + 3)) : d.meta);
</script>

{#each groups as g (g.name)}
  <Group name={g.name}>
    {#each g.rows as d}
      <BarRow
        name={d.name} level={d.lifeLevel}
        facts={d.facts.map((f) => ({ text: `${f.v}${f.k ? ` ${f.k}` : ''}`, warn: f.level === 'warn' }))}
        pill={d.status !== 'ok' ? { text: d.status, level: d.level } : null}
        meta={metaOf(d)} life={d.life}
        title="{d.name} · {d.meta} · {d.detail}"
      />
    {/each}
  </Group>
{/each}
