<script lang="ts">
  import type { Settings } from '$lib/types';

  // The header every page shares: the brand (home), search, the live state, the monitoring link and Setup. On phones
  // search moves to the tab bar, so the header keeps room for the title.
  interface Props {
    title: string;
    logo: string | null;
    demo?: boolean;
    /** the page it sits on: Setup's button is pressed there and leads back to the dashboard */
    current: 'home' | 'setup';
    /** the stream's state, where the page follows it; `age` is how old the data is when stale */
    live?: { state: 'live' | 'reconnecting' | 'stale'; age?: string };
    deepLink?: Settings['deepLink'];
    target?: string;
    configProblems?: number;
    /** opens the palette in place; without it search is a link to the dashboard's palette */
    onsearch?: () => void;
  }
  let { title, logo, demo = false, current, live, deepLink = null, target = '_blank', configProblems = 0, onsearch }: Props = $props();

  const setupLabel = $derived(
    current === 'setup' ? 'Close Setup' : !configProblems ? 'Setup' : `Setup, ${configProblems} config problem${configProblems === 1 ? '' : 's'}`
  );
</script>

{#snippet searchInner()}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  <span class="ph">Open a service…</span>
  <kbd class="mono">/</kbd>
{/snippet}

<header class="top">
  <a class="brand" href="/" aria-label="{title} — home">
    {#if logo}<img src={logo} alt="" width="36" height="36" />{/if}
    <span class="bname">{title}</span>
  </a>
  {#if onsearch}
    <button class="search card" onclick={onsearch} aria-label="Search or jump to a service" aria-keyshortcuts="/ Control+K Meta+K">{@render searchInner()}</button>
  {:else}
    <a class="search card" href="/#search" aria-label="Search or jump to a service">{@render searchInner()}</a>
  {/if}
  <div class="right">
    {#if live}
      <span class="live" class:warn={live.state !== 'live'} role="status">
        <span class="pulse"></span>
        {#if live.state === 'reconnecting'}<span class="only-desktop">Reconnecting…</span><span class="only-phone">Retrying</span>{:else if live.state === 'stale'}<span class="only-desktop">Data {live.age} old</span><span class="only-phone">Stale</span>{:else}<span class="live-word">Live</span>{/if}
      </span>
    {/if}
    {#if demo}<span class="demo">demo</span>{/if}
    {#if deepLink?.href}
      <a class="deep lift" href={deepLink.href} {target} rel="noopener">
        {deepLink.name ?? 'Monitoring'}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
      </a>
    {/if}
    <a class="hbtn" class:on={current === 'setup'} href={current === 'setup' ? '/' : '/config'} aria-label={setupLabel} title={setupLabel}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></svg>
      {#if configProblems && current !== 'setup'}<span class="cfg-badge mono" aria-hidden="true">{configProblems}</span>{/if}
    </a>
  </div>
</header>

<style>
  .top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand img { width: 36px; height: 36px; border-radius: 11px; }
  .bname { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search { flex: 1 1 260px; max-width: 440px; margin-left: auto; display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 12px 0 14px; border: 0; border-radius: 12px; color: var(--muted); cursor: pointer; text-align: left; }
  .search:hover { color: var(--text); }
  .search .ph { flex: 1; }
  kbd { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--surface-2); }
  .right { display: flex; align-items: center; gap: 8px; }
  .live { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); white-space: nowrap; }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px var(--ok-soft); animation: breathe 3s ease-in-out infinite; }
  .live.warn .pulse { background: var(--warn); box-shadow: 0 0 0 4px var(--warn-soft); }
  .demo { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 5px; background: var(--surface-3); color: var(--text); }
  .hbtn { position: relative; display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); color: var(--text); }
  .hbtn.on { background: var(--text); color: var(--bg); }
  .hbtn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .cfg-badge { position: absolute; top: -4px; right: -4px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--warn); color: var(--bg); font-size: 10px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
  .deep { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; padding: 0 14px; min-height: 42px; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); }
  @keyframes breathe { 50% { box-shadow: 0 0 0 7px transparent; } }

  /* phones: brand, the live dot and Setup; search is in the tab bar */
  @media (max-width: 760px) {
    .search, .deep, .demo { display: none; }
    .top { flex-wrap: nowrap; gap: 8px; }
    .brand { flex: 1 1 auto; gap: 10px; }
    .right { margin-left: auto; gap: 6px; }
    .live { min-width: 28px; min-height: 28px; justify-content: center; }
    .live-word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .hbtn { width: 44px; height: 44px; border-radius: 14px; }
    .bname { font-size: 19px; }
  }
</style>
