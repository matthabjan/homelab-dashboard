<script lang="ts">
  import type { Snippet } from 'svelte';

  // A box of the Infrastructure sheet: rows that belong together (a host's storages, a NAS's drives, the jobs), under
  // the name of what reports them.
  interface Props {
    name: string;
    children: Snippet;
  }
  let { name, children }: Props = $props();
</script>

<section class="group" aria-label={name}>
  <h3 class="ghead">{name}</h3>
  <div class="rows">{@render children()}</div>
</section>

<style>
  .group { padding: 10px 14px 2px; border-radius: 14px; background: var(--surface-2); }
  .rows { display: flex; flex-direction: column; }
  .ghead { font-size: 12px; font-weight: 500; color: var(--muted); margin: 0 0 1px; }
</style>
