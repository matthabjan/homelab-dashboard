<script lang="ts">
  import type { Level } from '$lib/types';

  // Phones: the app's four destinations in the thumb zone, the same on every page. Home, Services and Alerts lead to
  // the dashboard's sections; Search opens the palette. Hidden above the phone breakpoint, where the header and the
  // page itself hold all four.
  interface Props {
    /** the destination shown; unset on pages that are none of them (Setup) */
    current?: 'home' | 'services' | 'alerts';
    /** how many items need attention, and how bad the worst is: the badge on Alerts */
    needCount?: number;
    level?: Level;
    /** opens the palette in place; without it Search is a link to the dashboard's palette */
    onsearch?: () => void;
  }
  let { current, needCount = 0, level = 'ok', onsearch }: Props = $props();
</script>

{#snippet searchInner()}
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  Search
{/snippet}

<nav class="tabs only-phone" aria-label="Sections">
  <a class="tab" href="/#top" aria-current={current === 'home' ? 'page' : undefined}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>
    Home
  </a>
  <a class="tab" href="/#services" aria-current={current === 'services' ? 'page' : undefined}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></svg>
    Services
  </a>
  {#if onsearch}
    <button class="tab" onclick={onsearch}>{@render searchInner()}</button>
  {:else}
    <a class="tab" href="/#search">{@render searchInner()}</a>
  {/if}
  <a class="tab" href="/#attention" aria-current={current === 'alerts' ? 'page' : undefined}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4" /></svg>
    Alerts
    {#if needCount}<span class="badge num lv-{level === 'crit' ? 'crit' : 'warn'}" aria-hidden="true">{needCount}</span><span class="sr">, {needCount} need{needCount === 1 ? 's' : ''} attention</span>{/if}
  </a>
</nav>

<style>
  .tabs {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: 6px max(8px, env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
    background: var(--glass); backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
    border-top: 1px solid var(--line);
  }
  .tab {
    position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 50px;
    border: 0; border-radius: 14px; background: none; color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer;
  }
  .tab:active { background: var(--surface-2); }
  .tab svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
  .tab[aria-current='page'] { color: var(--text); }
  .tab[aria-current='page'] svg { stroke-width: 2.3; }
  .badge {
    position: absolute; top: 2px; left: calc(50% + 5px); min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
    background: var(--lv); color: var(--surface); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
  }
</style>
