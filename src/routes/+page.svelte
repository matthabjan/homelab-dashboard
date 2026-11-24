<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate, pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import type { InfraPanel, SheetRef } from '#lib/types';
  import type { PageProps } from './$types';
  import '#lib/components/dash.css';
  import AppHeader from '#lib/components/AppHeader.svelte';
  import TabBar from '#lib/components/TabBar.svelte';
  import Palette from '#lib/components/Palette.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Glyph from '#lib/components/Glyph.svelte';
  import TopCard from '#lib/components/TopCard.svelte';
  import InfraStrip from '#lib/components/InfraStrip.svelte';
  import ServiceTiles from '#lib/components/ServiceTiles.svelte';
  import ActivityCard from '#lib/components/ActivityCard.svelte';
  import LinksCard from '#lib/components/LinksCard.svelte';
  import ServiceSheet from '#lib/components/ServiceSheet.svelte';
  import Infrastructure from '#lib/components/Infrastructure.svelte';
  import Beats from '#lib/components/Beats.svelte';
  import EventList from '#lib/components/EventList.svelte';
  import { ago } from '#lib/ago.ts';
  import { Live } from '#lib/live.svelte.ts';
  import { viewStep, type View } from '#lib/logic.ts';
  import { pctTxt } from '#lib/format.ts';

  // The page answers "is everything fine?" at a glance and gets you to a service in one tap: the sentence, what needs
  // attention listed once, a strip of the infrastructure, and a tile per service that both launches it and says how
  // it is. Everything else (strips, charts, readings) is one tap deeper, in a sheet. Each section is a component; the
  // page keeps what they share: the live snapshot, the sheets, the phone's views and search.
  let { data }: PageProps = $props();
  // svelte-ignore state_referenced_locally — only the first snapshot comes from load; the stream replaces it
  const stream = new Live(data.snapshot);
  onMount(() => stream.start());
  const snap = $derived(stream.snap);
  const now = $derived(stream.now);
  let paletteOpen = $state(false);

  const allServices = $derived(snap ? snap.groups.flatMap((g) => g.services) : []);
  const target = $derived(snap?.linkTarget || '_blank');
  // this dashboard's own pages (the config view) open in place; services as settings.linkTarget says
  const linkTarget = (href: string | null | undefined) => (!href ? undefined : href.startsWith('/') ? undefined : target);
  // what needs attention, the top item first: every warning and critical item (notes, such as pending updates, are
  // Activity's). Listed once, in the top card; the strip and the tiles only mark what is theirs
  const problems = $derived(snap?.needCount ? snap.attention.filter((a) => a.sev !== 'info') : []);

  // ---- sheets: details on demand ----
  // A stack: a sheet opened from inside another (Backups → a job) is a level deeper, with a back button to the one
  // below. Each level is a history entry (shallow routing), so the browser's and Android's back go up one level, and
  // closing (✕ or the phone's handle, the backdrop, a swipe down) pops them all.
  const stack = $derived<SheetRef[]>(page.state.sheets ?? []);
  const sheet = $derived(stack.at(-1) ?? null);
  const show = (s: SheetRef) => pushState('', { ...page.state, sheets: [...stack, s] });
  const back = () => history.back();
  const closeSheets = () => { if (stack.length) history.go(-stack.length); };
  const openCard = (c: InfraPanel) => show({ kind: 'infra', tab: c.id });
  const details = (id: string) => show({ kind: 'service', id });
  const sheetId = $derived(sheet?.kind === 'service' ? sheet.id : null);
  const sheetTile = $derived(sheetId ? allServices.find((t) => t.id === sheetId) ?? null : null);
  const sheetJob = $derived(sheetId ? (snap?.jobs ?? []).find((j) => j.id === sheetId) ?? null : null);
  const titleOf = (s: SheetRef | null | undefined) =>
    !s ? '' : s.kind === 'service' ? allServices.find((t) => t.id === s.id)?.name ?? '' : s.kind === 'infra' ? 'Infrastructure' : 'Activity';
  const backTo = $derived(stack.length > 1 ? titleOf(stack.at(-2)) : undefined);
  const sheetSub = $derived(
    sheet?.kind === 'service' ? [sheetTile?.group, sheetTile?.host].filter(Boolean).join(' · ')
    : sheet?.kind === 'activity' ? 'Last 24 hours' : ''
  );

  // the alert count on the tab title and, for the installed app, on its icon
  $effect(() => {
    const n = snap?.needCount ?? 0;
    document.title = n ? `(${n}) ${snap?.title}` : (snap?.title ?? document.title);
    const nav: Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> } = navigator;
    (n ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
  });

  // ---- phones: one view at a time (Home, Services, Alerts), picked in the tab bar ----
  // The view is history state (see viewStep). Each section names its views in `data-v` and the rule below hides the
  // rest; above the phone breakpoint every section shows and the view changes nothing.
  const view = $derived<View>(page.state.view ?? 'home');
  const VIEW_NAME: Record<View, string> = { home: '', services: 'Services', alerts: 'Alerts' };
  function setView(v: View) {
    const step = viewStep(view, v, !!page.state.viewPushed);
    if (step === 'stay') return scrollTo({ top: 0, behavior: 'smooth' });
    if (step === 'back') history.back();
    else if (step === 'reset') replaceState('', {});
    else if (step === 'push') pushState('', { view: v, viewPushed: true });
    else replaceState('', { ...page.state, view: v });
    scrollTo(0, 0);
  }

  // Another page's header and tab bar lead here by hash: /#search opens the palette, /#view-services and /#view-alerts
  // their view. The hash is dropped once it is acted on (none of them names an element, so nothing scrolls to it).
  afterNavigate(() => {
    const h = location.hash;
    const v: View | null = h === '#view-services' ? 'services' : h === '#view-alerts' ? 'alerts' : null;
    if (h === '#search') paletteOpen = true;
    else if (!v) return;
    try { replaceState('/', v ? { view: v } : {}); } catch {}
  });

  function onKey(e: KeyboardEvent) {
    // key events target the focused element (the body when nothing is focused)
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable;
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
      e.preventDefault();
      paletteOpen = true;
    }
  }

  /** a service was opened: counted for Most used */
  function opened(id: string) {
    try {
      fetch('/api/open', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    } catch {}
  }
</script>

<svelte:window onkeydown={onKey} />

{#if !snap}
  <main class="boot"><p class="muted">Starting up…</p></main>
{:else}
  <div class="page dash" id="top" data-view={view}>
    <AppHeader
      title={snap.title} logo={snap.logo} logoDark={snap.logoDark} demo={snap.demo} current="home" section={VIEW_NAME[view]} live={{ state: stream.header, age: ago(snap.generatedAt, now) }}
      deepLink={snap.deepLink} {target} configProblems={snap.configProblems} onsearch={() => (paletteOpen = true)}
    />

    {#if stream.degraded}
      {@const age = ago(snap.generatedAt, now)}
      <div class="banner" role="alert">
        <Glyph name="crit" size={18} />
        <span class="txt">
          <span class="t">{stream.offline ? 'You’re offline' : stream.lost ? 'Can’t reach the dashboard' : 'Updates have stopped'}</span>
          <span class="d">Showing the last known state, {age === 'now' ? 'just now' : age + ' old'}.</span>
        </span>
        {#if !stream.offline}<button onclick={() => stream.connect()}>Retry</button>{/if}
      </div>
    {/if}

    <TopCard {snap} {problems} degraded={stream.degraded} flash={stream.flash} {now} {target} {linkTarget} onview={setView} ondetails={details} onopened={opened} />

    {#if snap.infrastructure.length}<InfraStrip {snap} onopen={openCard} />{/if}

    <div class="lower">
      <ServiceTiles groups={snap.groups} flash={stream.flash} {target} ondetails={details} onopened={opened} />
      <div class="side">
        <ActivityCard feed={snap.feed} {now} onopen={show} />
        {#if snap.bookmarks.length}<LinksCard bookmarks={snap.bookmarks} {target} />{/if}
      </div>
    </div>

    <footer class="foot" data-v="home">
      <span class="muted small ver">
        <a href="https://github.com/matthabjan/homelab-dashboard/tree/main/docs" target="_blank" rel="noopener">Documentation</a>
        {#if snap.version}<span class="mono">v{snap.version}</span>{/if}
      </span>
    </footer>
  </div>

  <Sheet open={stack.length > 0} depth={stack.length} title={titleOf(sheet)} sub={sheetSub} {backTo} tall={sheet?.kind === 'infra'} onback={back} onclose={closeSheets}>
    {#if sheet?.kind === 'service' && sheetTile}
      <ServiceSheet tile={sheetTile} job={sheetJob} {snap} {now} {target} onopened={opened} />
    {:else if sheet?.kind === 'infra'}
      <Infrastructure panels={snap.infrastructure} host={snap.host} storage={snap.storage} drives={snap.drives} network={snap.network} {target} now={snap.generatedAt} clock={now} initial={sheet.tab} backups={snap.backups} lastChange={snap.lastChange} onbackup={details} />
    {:else if sheet?.kind === 'activity'}
      <div class="dash dash-c">
        <div class="sh-block">
          <div class="sh-row"><span class="st">All services</span><span class="muted small">{pctTxt(snap.fleetAvail)} uptime</span></div>
          <Beats beats={snap.fleet} end={snap.generatedAt} label="Availability of all services over the last 24 hours" />
        </div>
        <EventList items={snap.feed} {now} onopen={show} />
      </div>
    {/if}
  </Sheet>

  <TabBar current={view} needCount={snap.needCount} level={snap.verdict.level} onnav={setView} onsearch={() => (paletteOpen = true)} />

  <Palette bind:open={paletteOpen} services={allServices} bookmarks={snap.bookmarks} mostUsed={snap.mostUsed} {target} onopen={opened} />
{/if}

<style>
  .boot { min-height: 100vh; display: grid; place-items: center; }
  .page { max-width: 1240px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 56px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 16px; }
  /* services, and beside them activity and links */
  .lower { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .side { display: flex; flex-direction: column; gap: 16px; min-width: 0; position: sticky; top: 16px; }

  .foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px 24px; padding-top: 18px; border-top: 1px solid var(--line); }
  .ver { display: flex; align-items: center; gap: 14px; }
  .ver a { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line); }

  :global(html) { scroll-padding-top: 12px; }
  /* connection lost or data stale: say so, and stop showing status colour as if it were current */
  .banner {
    display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 16px; border-radius: 16px;
    background: var(--warn-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 40%, transparent); color: var(--text);
    animation: drop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .banner > :global(svg) { color: var(--warn); flex: none; }
  .banner .txt .t { font-weight: 600; }
  .banner .txt .d { font-size: 13px; color: var(--muted); }
  .banner button { min-height: 36px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); font-weight: 500; cursor: pointer; }
  /* the sections under the banner: the top card, the strip, and the services with activity and links */
  .page:has(.banner) > :global(section), .page:has(.banner) > .lower { filter: grayscale(0.7); opacity: 0.8; transition: filter 0.3s, opacity 0.3s; }
  @keyframes drop { from { opacity: 0; transform: translateY(-6px); } }

  /* narrower: activity goes under the services */
  @media (max-width: 1000px) {
    .lower { grid-template-columns: minmax(0, 1fr); }
    .side { position: static; }
  }
  /* phones: one view at a time, above the tab bar */
  @media (max-width: 760px) {
    .page { gap: 12px; padding-bottom: calc(86px + env(safe-area-inset-bottom)); }
    /* a section shows in the views its data-v names */
    .page[data-view='home'] :global([data-v]:not([data-v~='home'])),
    .page[data-view='services'] :global([data-v]:not([data-v~='services'])),
    .page[data-view='alerts'] :global([data-v]:not([data-v~='alerts'])) { display: none !important; }
    .banner button { min-height: 44px; min-width: 64px; }
  }
</style>
