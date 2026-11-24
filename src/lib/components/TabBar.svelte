<script lang="ts">
  import type { Level } from '#lib/types';
  import Glyph from './Glyph.svelte';

  // Phones: the app's four destinations in the thumb zone, the same on every page. Home, Services and Alerts are the
  // dashboard's views; Search opens the palette. Hidden above the phone breakpoint, where the header and the
  // page itself hold all four.
  interface Props {
    /** the destination shown; unset on pages that are none of them (Setup) */
    current?: 'home' | 'services' | 'alerts';
    /** how many items need attention, and how bad the worst is: the badge on Alerts */
    needCount?: number;
    level?: Level;
    /** on the dashboard: switches the view in place instead of following the link */
    onnav?: (view: 'home' | 'services' | 'alerts') => void;
    /** opens the palette in place; without it Search is a link to the dashboard's palette */
    onsearch?: () => void;
  }
  let { current, needCount = 0, level = 'ok', onnav, onsearch }: Props = $props();
  const nav = (view: 'home' | 'services' | 'alerts') => (e: MouseEvent) => {
    if (!onnav) return;
    e.preventDefault();
    onnav(view);
  };
</script>

{#snippet searchInner()}
  <Glyph bare name="search" />
  Search
{/snippet}

<nav class="tabs only-phone" aria-label="Sections">
  <a class="tab" href="/" onclick={nav('home')} aria-current={current === 'home' ? 'page' : undefined}>
    <Glyph bare name="home" />
    Home
  </a>
  <a class="tab" href="/#view-services" onclick={nav('services')} aria-current={current === 'services' ? 'page' : undefined}>
    <Glyph bare name="grid" />
    Services
  </a>
  {#if onsearch}
    <button class="tab" onclick={onsearch}>{@render searchInner()}</button>
  {:else}
    <a class="tab" href="/#search">{@render searchInner()}</a>
  {/if}
  <a class="tab" href="/#view-alerts" onclick={nav('alerts')} aria-current={current === 'alerts' ? 'page' : undefined}>
    <Glyph bare name="bell" />
    Alerts
    {#if needCount}<span class="badge num lv-{level === 'crit' ? 'crit' : 'warn'}" aria-hidden="true">{needCount}</span><span class="sr">, {needCount} need{needCount === 1 ? 's' : ''} attention</span>{/if}
  </a>
</nav>

<style>
  .tabs {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: 6px max(8px, env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
    /* nearly opaque: what scrolls under it must not read through the labels */
    background: color-mix(in srgb, var(--surface) 94%, transparent); backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
    border-top: 1px solid var(--line);
  }
  .tab {
    position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 50px;
    border: 0; border-radius: 14px; background: none; color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer;
  }
  .tab:active { background: var(--surface-2); }
  .tab :global(svg) { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
  .tab[aria-current='page'] { color: var(--text); }
  .tab[aria-current='page'] :global(svg) { stroke-width: 2.3; }
  .badge {
    position: absolute; top: 2px; left: calc(50% + 5px); min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
    background: var(--lv); color: var(--surface); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
  }
</style>
