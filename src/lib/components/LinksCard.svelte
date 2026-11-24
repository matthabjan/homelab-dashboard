<script lang="ts">
  import type { Snapshot } from '#lib/types';
  import { grouped } from '#lib/logic.ts';
  import Icon from './Icon.svelte';

  // A compact card: each link its icon beside its name, groups with their label, in bookmarks.yaml order.
  interface Props {
    bookmarks: Snapshot['bookmarks'];
    target: string;
  }
  let { bookmarks, target }: Props = $props();
  const groups = $derived(grouped(bookmarks));
</script>

<section class="card sec links" data-v="home" aria-labelledby="h-links">
  <h2 id="h-links">Links</h2>
  {#each groups as g (g.name)}
    <div class="lgroup">
      {#if g.name && groups.length > 1}<h3>{g.name}</h3>{/if}
      <div class="chipsrow">
        {#each g.rows as b (b.href + b.name)}
          <a class="lnk" href={b.href} target={target} rel="noopener">
            <span class="ic"><Icon src={b.icon} dark={b.iconDark} name={b.name} size={20} /></span>{b.name}
          </a>
        {/each}
      </div>
    </div>
  {/each}
</section>

<style>
  .lgroup { display: flex; flex-direction: column; gap: 4px; }
  .chipsrow { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0 -6px; }
  .lnk { display: inline-flex; align-items: center; gap: 9px; padding: 6px 12px 6px 6px; border-radius: var(--r-12); font-size: var(--fs-14); }
  .lnk:hover { background: var(--surface-2); }
  .lnk .ic { width: 30px; height: 30px; border-radius: var(--r-8); }
</style>
