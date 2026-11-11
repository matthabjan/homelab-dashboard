<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate, pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import type { FeedItem, InfraPanel, SheetRef, Snapshot } from '$lib/types';
  import type { PageProps } from './$types';
  import Icon from '$lib/components/Icon.svelte';
  import Infrastructure from '$lib/components/Infrastructure.svelte';
  import AppHeader from '$lib/components/AppHeader.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import Palette from '$lib/components/Palette.svelte';
  import Beats from '$lib/components/Beats.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import { ago, until, validFor } from '$lib/ago.ts';

  // The page answers "is everything fine?" at a glance and gets you to a service in one tap: the sentence, what needs
  // attention listed once, a strip of the infrastructure, and a tile per service that both launches it and says how
  // it is. Everything else (strips, charts, readings) is one tap deeper, in a sheet.
  let { data }: PageProps = $props();
  // svelte-ignore state_referenced_locally — only the first snapshot comes from load; the stream replaces it
  let snap = $state(data.snapshot);
  let live = $state<'connecting' | 'live' | 'reconnecting'>('connecting');
  let now = $state(Date.now());
  let paletteOpen = $state(false);

  const allServices = $derived(snap ? snap.groups.flatMap((g) => g.services) : []);
  const stale = $derived(snap && now - snap.generatedAt > snap.staleAfter);
  // the stream has been down past a short grace (a server restart is a blip), or the device is offline
  let lost = $state(false);
  let offline = $state(false);
  // a status page must not keep saying "all good" on old data: the page greys out instead
  const degraded = $derived(!!stale || lost || offline);
  // services (and 'verdict') whose level changed in the last update, briefly highlighted
  let flash = $state(new Set<string>());
  function changes(prev: Snapshot, next: Snapshot) {
    const was = new Map(prev.groups.flatMap((g) => g.services).map((t) => [t.id, t.level]));
    const ids = next.groups.flatMap((g) => g.services).filter((t) => was.has(t.id) && was.get(t.id) !== t.level).map((t) => t.id);
    if (prev.verdict.level !== next.verdict.level) ids.push('verdict');
    return ids;
  }
  let unflash: ReturnType<typeof setTimeout> | undefined;
  /** a new snapshot from the stream; whatever changed level is highlighted for a moment */
  function receive(next: Snapshot) {
    const ids = snap ? changes(snap, next) : [];
    snap = next;
    if (!ids.length) return;
    flash = new Set(ids);
    clearTimeout(unflash);
    unflash = setTimeout(() => (flash = new Set()), 2400);
  }
  const target = $derived(snap?.linkTarget || '_blank');
  // this dashboard's own pages (the config view) open in place; services as settings.linkTarget says
  const linkTarget = (href: string | null | undefined) => (!href ? undefined : href.startsWith('/') ? undefined : target);
  const isProblem = (level: string) => level === 'crit' || level === 'warn';
  const pctTxt = (v: number | null, d = 2) => (v == null ? '—' : v >= 99.995 ? '100%' : v.toFixed(d) + '%');
  /** "2 h ago", "just now" */
  const since = (ts: number | null) => (ts == null ? 'never' : ago(ts, now) === 'now' ? 'just now' : `${ago(ts, now)} ago`);
  // the header's live state: the stream down, the data old, or current
  const liveState = $derived<'live' | 'reconnecting' | 'stale'>(live === 'reconnecting' ? 'reconnecting' : stale ? 'stale' : 'live');

  // ---- what the page shows, from the snapshot ----
  // what needs attention, the top item first: every warning and critical item (notes, such as pending updates, are
  // Activity's). Listed once, here; the strip and the tiles only mark what is theirs
  const problems = $derived(snap?.needCount ? snap.attention.filter((a) => a.sev !== 'info') : []);
  const nCrit = $derived(problems.filter((a) => a.sev === 'crit').length);
  let sev = $state<'all' | 'crit' | 'warn'>('all');
  const listed = $derived(problems.filter((a) => sev === 'all' || a.sev === sev));
  // wide screens show the first few; the phone's Alerts view lists them all
  const TRIAGE = 5;
  let triageAll = $state(false);
  $effect(() => { if (!problems.some((a) => a.sev === sev)) sev = 'all'; });

  // the services: every service and job in its group, or only those with a problem
  let only = $state<'all' | 'problems'>('all');
  const nBad = $derived(allServices.filter((t) => isProblem(t.level)).length);
  $effect(() => { if (!nBad) only = 'all'; });
  const groups = $derived(
    (snap?.groups ?? []).map((g) => ({ ...g, services: g.services.filter((t) => only === 'all' || isProblem(t.level)) })).filter((g) => g.services.length)
  );
  // the Links card: bookmarks by group, in bookmarks.yaml order
  const linkGroups = $derived.by(() => {
    const groups: { name: string; links: Snapshot['bookmarks'] }[] = [];
    for (const b of snap?.bookmarks ?? []) {
      const g = groups.find((x) => x.name === b.group) ?? groups[groups.push({ name: b.group, links: [] }) - 1];
      g.links.push(b);
    }
    return groups;
  });
  const jobById = $derived(new Map((snap?.jobs ?? []).map((j) => [j.id, j])));

  // the infrastructure strip: a cell per area, worded and judged on the server (the same panels are the sheet's tabs),
  // each with a small picture of its figure drawn from what the sheet charts
  const cards = $derived(snap?.infrastructure ?? []);
  const fullest = $derived(Math.max(0, ...(snap?.storage ?? []).filter((r) => r.level !== 'off').map((r) => r.pct ?? 0)));

  // Activity: what happened first; the notes (pending updates and the like) fold into one row under it
  const notes = $derived((snap?.feed ?? []).filter((a) => 'key' in a && a.sev === 'info'));
  const happened = $derived((snap?.feed ?? []).filter((a) => !('key' in a && a.sev === 'info')));
  const FEED = 5;

  // ---- sheets: details on demand ----
  // A stack: a sheet opened from inside another (Backups → a job) is a level deeper, with a back button to the one
  // below. Each level is a history entry (shallow routing), so the browser's and Android's back go up one level, and
  // closing (✕ or the phone's handle, the backdrop, a swipe down) pops them all.
  const stack = $derived<SheetRef[]>(page.state.sheets ?? []);
  const sheet = $derived(stack.at(-1) ?? null);
  const sheetOpen = $derived(stack.length > 0);
  const show = (s: SheetRef) => pushState('', { ...page.state, sheets: [...stack, s] });
  const back = () => history.back();
  const closeSheets = () => { if (stack.length) history.go(-stack.length); };
  const openCard = (c: InfraPanel) => show({ kind: 'infra', tab: c.id });
  const details = (id: string) => show({ kind: 'service', id });
  const sheetId = $derived(sheet?.kind === 'service' ? sheet.id : null);
  const sheetTile = $derived(sheetId ? allServices.find((t) => t.id === sheetId) ?? null : null);
  const sheetJob = $derived(sheetId ? jobById.get(sheetId) ?? null : null);
  // the service sheet's activity: what is raised about it now, then its events of the last 7 days (fetched, since the
  // snapshot only carries the latest of all services; both leave out events that repeat an alert), refreshed when
  // something changes
  let svcEvents = $state<{ sid: string; items: FeedItem[] } | null>(null);
  $effect(() => {
    const sid = sheetId;
    void snap?.lastChange;
    if (!sid || !sheetOpen) return;
    const ctl = new AbortController();
    fetch(`/api/events?sid=${encodeURIComponent(sid)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((items: FeedItem[]) => (svcEvents = { sid, items }))
      .catch(() => {});
    return () => ctl.abort();
  });
  // the Backups tab's recent list: the last 7 days of PBS and backup-job events, refreshed when something changes
  let backupEvents = $state<FeedItem[]>([]);
  // the latest few, the rest of the week on request; each time the sheet opens it starts short
  const RECENT = 5;
  // the lines a note shows under it (pending packages) before "N more"
  const ITEMS = 5;
  let recentAll = $state(false);
  $effect(() => { if (sheet?.kind !== 'infra') recentAll = false; });
  // the same for a service's activity: short again for every service opened
  let svcAll = $state(false);
  $effect(() => { void sheetId; svcAll = false; });
  $effect(() => {
    void snap?.lastChange;
    if (sheet?.kind !== 'infra' || !sheetOpen) return;
    const ctl = new AbortController();
    fetch('/api/events?backups', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((items: FeedItem[]) => (backupEvents = items))
      .catch(() => {});
    return () => ctl.abort();
  });
  const sheetActivity = $derived.by(() => {
    if (!snap || !sheetId) return [];
    const raised = snap.attention.filter((a) => a.sid === sheetId);
    const past = svcEvents?.sid === sheetId ? svcEvents.items : snap.feed.filter((e) => e.sid === sheetId && !('key' in e));
    return [...raised, ...past];
  });
  const titleOf = (s: SheetRef | null | undefined) =>
    !s ? '' : s.kind === 'service' ? allServices.find((t) => t.id === s.id)?.name ?? '' : s.kind === 'infra' ? 'Infrastructure' : 'Activity';
  const sheetTitle = $derived(titleOf(sheet));
  const backTo = $derived(stack.length > 1 ? titleOf(stack.at(-2)) : undefined);
  const sheetSub = $derived(
    sheet?.kind === 'service' ? [sheetTile?.group, sheetTile?.host].filter(Boolean).join(' · ')
    : sheet?.kind === 'activity' ? 'Last 24 hours' : ''
  );

  // A long press on a tile opens its details (touch and pen; the button at the tile's end does the same for everyone).
  // The click that follows the press is swallowed, so the service isn't launched as well.
  function longpress(node: HTMLElement, open: () => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fired = false, touch = false, x = 0, y = 0;
    const down = (e: PointerEvent) => {
      touch = e.pointerType !== 'mouse';
      fired = false;
      if (!touch) return;
      x = e.clientX; y = e.clientY;
      timer = setTimeout(() => { fired = true; open(); }, 450);
    };
    const move = (e: PointerEvent) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) clearTimeout(timer); };
    const cancel = () => clearTimeout(timer);
    const click = (e: MouseEvent) => { if (fired) { e.preventDefault(); fired = false; } };
    // the browser's own long-press menu would cover the sheet
    const menu = (e: Event) => { if (touch) e.preventDefault(); };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('click', click);
    node.addEventListener('contextmenu', menu);
    return {
      destroy() {
        clearTimeout(timer);
        node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', cancel);
        node.removeEventListener('pointercancel', cancel); node.removeEventListener('click', click); node.removeEventListener('contextmenu', menu);
      }
    };
  }

  /** (re)open the stream now: the banner's Retry, coming back online. Set once mounted */
  let connect = () => {};
  onMount(() => {
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const connected = () => { live = 'live'; lost = false; clearTimeout(grace); grace = undefined; };
    connect = () => {
      clearTimeout(retry);
      es?.close();
      es = new EventSource('/api/stream');
      es.onopen = connected;
      es.onmessage = (e: MessageEvent<string>) => { receive(JSON.parse(e.data)); connected(); };
      es.onerror = () => {
        live = 'reconnecting';
        es?.close();
        grace ??= setTimeout(() => (lost = true), 8000);
        retry = setTimeout(connect, 4000);
      };
    };
    connect();
    const tick = setInterval(() => (now = Date.now()), 15_000);
    const vis = () => { if (document.visibilityState === 'visible') { now = Date.now(); if (live === 'reconnecting') connect(); } };
    const net = () => { offline = !navigator.onLine; if (!offline && live === 'reconnecting') connect(); };
    document.addEventListener('visibilitychange', vis);
    addEventListener('online', net);
    addEventListener('offline', net);
    net();
    now = Date.now();
    return () => {
      es?.close(); clearInterval(tick); clearTimeout(retry); clearTimeout(grace); clearTimeout(unflash);
      document.removeEventListener('visibilitychange', vis); removeEventListener('online', net); removeEventListener('offline', net);
    };
  });

  // the alert count on the tab title and, for the installed app, on its icon
  $effect(() => {
    const n = snap?.needCount ?? 0;
    document.title = n ? `(${n}) ${snap?.title}` : (snap?.title ?? document.title);
    const nav: Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> } = navigator;
    (n ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
  });

  // ---- phones: one view at a time (Home, Services, Alerts), picked in the tab bar ----
  // The view is history state. Leaving Home adds an entry, so back returns to Home and then leaves the app; switching
  // between the other two replaces it. Above the phone breakpoint every section shows and the view changes nothing.
  type View = NonNullable<App.PageState['view']>;
  const view = $derived<View>(page.state.view ?? 'home');
  const VIEW_NAME: Record<View, string> = { home: '', services: 'Services', alerts: 'Alerts' };
  function setView(v: View) {
    if (v === view) return scrollTo({ top: 0, behavior: 'smooth' });
    if (v === 'home') {
      if (page.state.viewPushed) history.back();
      else replaceState('', {});
    } else if (view === 'home') pushState('', { view: v, viewPushed: true });
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

  function opened(id: string) {
    try {
      fetch('/api/open', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    } catch {}
  }

  const ICONS: Record<FeedItem['sev'], string> = {
    crit: 'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    warn: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    info: 'M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    ok: 'M20 6 9 17l-5-5'
  };
  const KIND: Record<string, string> = { http: 'HTTP', tcp: 'TCP', container: 'Container state', heartbeat: 'Heartbeat' };
</script>

<svelte:window onkeydown={onKey} />

{#snippet arrow()}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>{/snippet}

<!-- one event or alert in a list: what happened, about which service, and when -->
<!-- a row of Activity (`tap`: it opens the sheet that tells more, when there is one) or of a sheet's events (`full`:
     with what the note is about, e.g. the pending packages) -->
{#snippet event(a: FeedItem, { tap = false, full = false } = {})}
  {@const to = tap ? a.open : null}
  <li class="ev lv-{a.sev}">
    <svelte:element this={to ? 'button' : 'div'} class="ev-row" class:tap={!!to} onclick={to ? () => show($state.snapshot(to)) : undefined} role={to ? undefined : 'group'}>
      <span class="ev-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS[a.sev] ?? ICONS.info} /></svg></span>
      <span class="txt"><span class="t">{a.title}</span>{#if a.detail}<span class="d muted">{a.detail}</span>{/if}</span>
      <span class="num muted small when">{ago(a.ts, now)}</span>
      {#if to}<svg class="ev-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>{/if}
    </svelte:element>
    {#if full && a.items?.length}
      <ul class="ev-items mono">
        {#each a.items.slice(0, ITEMS) as line, i (i)}<li>{line}</li>{/each}
      </ul>
      {#if a.items.length > ITEMS}
        <details class="ev-more"><summary class="link-btn">{a.items.length - ITEMS} more</summary><ul class="ev-items mono">{#each a.items.slice(ITEMS) as line, i (i)}<li>{line}</li>{/each}</ul></details>
      {/if}
    {/if}
  </li>
{/snippet}

{#if !snap}
  <main class="boot"><p class="muted">Starting up…</p></main>
{:else}
  <div class="page" id="top" data-view={view}>
    <AppHeader
      title={snap.title} logo={snap.logo} logoDark={snap.logoDark} demo={snap.demo} current="home" section={VIEW_NAME[view]} live={{ state: liveState, age: ago(snap.generatedAt, now) }}
      deepLink={snap.deepLink} {target} configProblems={snap.configProblems} onsearch={() => (paletteOpen = true)}
    />

    {#if degraded}
      {@const age = ago(snap.generatedAt, now)}
      <div class="banner" role="alert">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS.crit} /></svg>
        <span class="txt">
          <span class="t">{offline ? 'You’re offline' : lost ? 'Can’t reach the dashboard' : 'Updates have stopped'}</span>
          <span class="d">Showing the last known state, {age === 'now' ? 'just now' : age + ' old'}.</span>
        </span>
        {#if !offline}<button onclick={() => connect()}>Retry</button>{/if}
      </div>
    {/if}

    <!-- the answer first: one sentence. While something needs attention, what to do about the top item, and beside it
         everything that needs attention, once; otherwise the most used services -->
    <section data-v="home alerts" class="card top lv-{degraded ? 'none' : snap.verdict.level}" class:calm={!problems.length} class:flash={flash.has('verdict')} aria-label="Overall status">
      <div class="verdict" data-v="home">
        <div class="vrow">
          <span class="mark" aria-hidden="true">
            {#if snap.verdict.level === 'ok'}<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>{:else}<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01" /></svg>{/if}
          </span>
          <div class="say">
            {#if degraded}<span class="tag">Last known state</span>{/if}
            <h1>{snap.verdict.title}</h1>
            {#if snap.verdict.sub || snap.lastChange}
              <p class="muted">{[snap.verdict.sub, !snap.needCount && snap.lastChange ? `last change ${since(snap.lastChange)}` : ''].filter(Boolean).join(' · ')}</p>
            {/if}
          </div>
        </div>
        {#if problems.length || snap.verdict.action}
          {@const first = problems[0]}
          <div class="acts">
            <!-- phones lead to the whole list when there is more than one problem; wide screens have it beside this -->
            {#if problems.length > 1}<button class="btn primary only-phone" onclick={() => setView('alerts')}>Review all {problems.length} problems</button>{/if}
            {#if first?.sid}{@const sid = first.sid}<button class="btn primary" class:only-desktop={problems.length > 1} onclick={() => details(sid)}>See details</button>{/if}
            {#if snap.verdict.action}
              <a class="btn" class:primary={!first?.sid} href={snap.verdict.action.href} target={linkTarget(snap.verdict.action.href)} rel="noopener">{snap.verdict.action.label} {@render arrow()}</a>
            {/if}
          </div>
        {/if}
      </div>

      {#if problems.length}
        <div class="triage" data-v="alerts">
          <div class="thead">
            <h2>Needs attention</h2>
            {#if nCrit && nCrit < problems.length}
              <div class="chips" role="group" aria-label="Show">
                <button class="chip" aria-pressed={sev === 'all'} onclick={() => (sev = 'all')}>All {problems.length}</button>
                <button class="chip" aria-pressed={sev === 'crit'} onclick={() => (sev = 'crit')}><span class="dot lv-crit" aria-hidden="true"></span>{nCrit} critical</button>
                <button class="chip" aria-pressed={sev === 'warn'} onclick={() => (sev = 'warn')}><span class="dot lv-warn" aria-hidden="true"></span>{problems.length - nCrit} warning{problems.length - nCrit === 1 ? '' : 's'}</button>
              </div>
            {:else}
              <span class="muted small num">{problems.length}</span>
            {/if}
          </div>
          <ul class="rows" id="triage">
            {#each listed as a, i (a.key)}
              <li class="lv-{a.sev}" class:extra={i >= TRIAGE && !triageAll} class:flash={!!a.sid && flash.has(a.sid)}>
                <!-- a row opens the service's details; one that isn't about a service (the config) leads where it says -->
                <svelte:element
                  this={a.sid ? 'button' : a.href ? 'a' : 'div'} class="arow" class:tap={!!a.sid || !!a.href}
                  href={!a.sid && a.href ? a.href : undefined} target={!a.sid ? linkTarget(a.href) : undefined}
                  onclick={a.sid ? () => details(a.sid ?? '') : undefined} role={a.sid || a.href ? undefined : 'group'}
                >
                  <span class="dot lv-{a.sev}" aria-hidden="true"></span>
                  <span class="t"><span class="sr">{a.sev === 'crit' ? 'Critical: ' : 'Warning: '}</span>{a.title}</span>
                  <span class="w num">{ago(a.ts, now)}</span>
                  {#if a.detail}<span class="d">{a.detail}</span>{/if}
                </svelte:element>
              </li>
            {/each}
          </ul>
          {#if listed.length > TRIAGE}
            <button class="link-btn more" aria-expanded={triageAll} aria-controls="triage" onclick={() => (triageAll = !triageAll)}>{triageAll ? 'Show fewer' : `Show all ${listed.length}`}</button>
          {/if}
        </div>
      {:else}
        <p class="muted quiet only-phone" data-v="alerts">Nothing needs attention.</p>
      {/if}

      <!-- wide: while something needs attention the card holds only that. Phones: Home always has the most used -->
      {#if snap.mostUsed.length}
        <div class="most" class:need={problems.length > 0} data-v="home">
          <h2 class="k">Most used</h2>
          <div class="apps">
            {#each snap.mostUsed as t (t.id)}
              <a class="app lift" href={t.href} target={target} rel="noopener" onclick={() => opened(t.id)} aria-label="{t.name}{isProblem(t.level) ? `, ${t.status}` : ''}">
                <span class="ic big lv-{t.level}"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={28} />{#if isProblem(t.level)}<span class="pmark" aria-hidden="true"></span>{/if}</span>
                <span class="an" class:one={!/\s/.test(t.name)}>{t.name}</span>
              </a>
            {/each}
          </div>
        </div>
      {/if}
    </section>

    {#if cards.length}
      <!-- infrastructure and backups in one strip: a cell per area with its figure, a small picture of it and a line of
           context. A problem colours the figure and adds its shape; the cell opens the area's tab of the sheet -->
      <section class="card infra" data-v="home" aria-labelledby="h-infra">
        <h2 id="h-infra" class="sr">Infrastructure</h2>
        {#each cards as c (c.id)}
          <button class="cell lv-{c.level}" class:alert={isProblem(c.level)} onclick={() => openCard(c)}>
            <span class="clab">{c.label}{#if c.where}<span class="kw">{c.where}</span>{/if}{#if isProblem(c.level)}<span class="dot lv-{c.level}" aria-hidden="true"></span><span class="sr">, {c.level === 'crit' ? 'critical' : 'warning'}</span>{/if}</span>
            <span class="fig">
              {#if c.stats}
                {#each c.stats as st, i (i)}<span class="ist"><span class="isv" class:hl={isProblem(st.level)} style:--lv={isProblem(st.level) ? `var(--${st.level})` : undefined}>{st.v}</span>{#if st.k}<span class="isk">{st.k}</span>{/if}</span>{/each}
              {:else}
                <span class="v">{c.value}</span>{#if c.unit}<span class="u">{c.unit}</span>{/if}
              {/if}
            </span>
            <span class="viz" aria-hidden="true">
              {#if c.id === 'system'}
                <Sparkline values={snap.host?.gauges[0]?.series} area minSpan={30} height={28} />
              {:else if c.id === 'storage'}
                <span class="meter"><span style:width="{Math.min(100, fullest)}%"></span></span>
              {:else if c.id === 'drives'}
                <span class="pips">{#each snap.drives.slice(0, 10) as d, i (i)}<span class="lv-{d.level}" class:bad={isProblem(d.level)}></span>{/each}</span>
              {:else if c.id === 'network'}
                <Sparkline values={snap.network?.seriesDown ?? snap.network?.lan?.seriesDown} area minSpan={10} height={28} />
              {:else}
                <span class="days">{#each snap.backups.days as d, i (i)}<span class="lv-{d}" class:none={d === 'none'} class:bad={isProblem(d)}></span>{/each}</span>
              {/if}
            </span>
            {#if c.sub}<span class="s">{c.sub}</span>{/if}
          </button>
        {/each}
      </section>
    {/if}

    <div class="lower">
      <!-- one tile per service and job: it opens the service, and its line says how it is. The button at its end (and a
           long press) opens the details; what has nothing to open opens its details at once -->
      <section data-v="services" class="card sec services" aria-labelledby="h-services">
        <div class="thead">
          <h2 id="h-services">Services</h2>
          {#if nBad}
            <div class="chips" role="group" aria-label="Show">
              <button class="chip" aria-pressed={only === 'all'} onclick={() => (only = 'all')}>All {allServices.length}</button>
              <button class="chip" aria-pressed={only === 'problems'} onclick={() => (only = 'problems')}><span class="dot lv-warn" aria-hidden="true"></span>Problems {nBad}</button>
            </div>
          {/if}
        </div>
        {#each groups as g (g.name)}
          <div class="sgroup">
            <h3>{g.name}</h3>
            <ul class="tiles">
              {#each g.services as t (t.id)}
                {@const bad = isProblem(t.level)}
                <li class="tile lv-{t.level}" class:alert={bad} class:flash={flash.has(t.id)}>
                  {#snippet inner()}
                    <span class="ic"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={24} /></span>
                    <span class="tx"><span class="t">{t.name}</span><span class="d" class:hl={isProblem(t.lineLevel ?? '')}>{t.line || t.status}</span></span>
                  {/snippet}
                  {#if t.href}
                    <a class="tmain" href={t.href} target={target} rel="noopener" onclick={() => opened(t.id)} use:longpress={() => details(t.id)}>{@render inner()}</a>
                  {:else}
                    <button class="tmain" onclick={() => details(t.id)}>{@render inner()}</button>
                  {/if}
                  <button class="inf" onclick={() => details(t.id)} aria-label="Details of {t.name}{bad ? `, ${t.status}` : ''}" title="Details">
                    {#if bad}<span class="dot lv-{t.level}" aria-hidden="true"></span>
                    {:else}<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {:else}
          <p class="muted">No services in <code>services.yaml</code> yet.</p>
        {/each}
      </section>

      <div class="side">
        <section class="card sec activity" data-v="home" aria-labelledby="h-activity">
          <div class="thead"><h2 id="h-activity">Activity</h2>{#if happened.length > FEED}<button class="link-btn" onclick={() => show({ kind: 'activity' })}>Show all</button>{:else}<span class="muted small">Last 24 hours</span>{/if}</div>
          {#if happened.length}
            <ul class="evs">{#each happened.slice(0, FEED) as a (a.ts + a.title)}{@render event(a, { tap: true })}{/each}</ul>
          {:else}
            <p class="muted small">No changes in the last 24 hours.</p>
          {/if}
          {#if notes.length}
            <!-- pending updates and other notes: one row, opened on request, so they don't crowd out what happened -->
            <details class="notes">
              <summary><span class="ev-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS.info} /></svg></span><span class="t">{notes.length} note{notes.length === 1 ? '' : 's'}</span><span class="muted small">updates and the like</span><svg class="nchev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
              <ul class="evs">{#each notes as a (a.ts + a.title)}{@render event(a, { tap: true })}{/each}</ul>
            </details>
          {/if}
        </section>

        {#if snap.bookmarks.length}
          <!-- a compact card: each link its icon beside its name, groups with their label -->
          <section class="card sec links" data-v="home" aria-labelledby="h-links">
            <h2 id="h-links">Links</h2>
            {#each linkGroups as g (g.name)}
              <div class="lgroup">
                {#if g.name && linkGroups.length > 1}<h3>{g.name}</h3>{/if}
                <div class="chipsrow">
                  {#each g.links as b (b.href + b.name)}
                    <a class="lnk" href={b.href} target={target} rel="noopener">
                      <span class="ic"><Icon src={b.icon} dark={b.iconDark} name={b.name} size={20} /></span>{b.name}
                    </a>
                  {/each}
                </div>
              </div>
            {/each}
          </section>
        {/if}
      </div>
    </div>

    <footer class="foot" data-v="home">
      <span class="muted small ver">
        <a href="https://github.com/matthabjan/homelab-dashboard/tree/main/docs" target="_blank" rel="noopener">Documentation</a>
        {#if snap.version}<span class="mono">v{snap.version}</span>{/if}
      </span>
    </footer>
  </div>

  <!-- the Backups tab of the Infrastructure sheet: here, since its rows open service sheets -->
  {#snippet backupsTab()}
    {#if snap}
      {#if snap.backups.oldestAge != null}
        <div class="facts">
          <div class="fact"><span class="muted k">Oldest backup</span><span class="fv">{ago(now - snap.backups.oldestAge, now)}</span>{#if snap.backups.oldestName}<span class="muted small">{snap.backups.oldestName}</span>{/if}</div>
          <div class="fact lv-{snap.backups.level}"><span class="muted k">Overdue</span><span class="fv" class:hl={!!snap.backups.overdue}>{snap.backups.overdue}</span></div>
        </div>
      {/if}
      {#if snap.backups.rows.length}
        <ul class="jobs">
          {#each snap.backups.rows as r (r.id + r.title)}
            <li>
              <button class="job" onclick={() => details(r.id)}>
                <span class="txt"><span class="t">{r.title}</span><span class="d muted">{r.detail} · last run {since(r.last)}</span></span>
                <span class="jr"><span class="state-w lv-{r.level}"><span class="dot lv-{r.level}" aria-hidden="true"></span>{r.state}</span><span class="muted small">{r.due != null ? `next ${until(r.due, now)}` : r.source}</span></span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="sh-block">
        <div class="sh-row"><span class="st">Recent</span><span class="muted small">Last 7 days</span></div>
        {#if backupEvents.length}
          <ul class="evs" id="backup-recent">{#each recentAll ? backupEvents : backupEvents.slice(0, RECENT) as a (a.ts + a.title)}{@render event(a)}{/each}</ul>
          {#if backupEvents.length > RECENT}
            <button class="link-btn" aria-expanded={recentAll} aria-controls="backup-recent" onclick={() => (recentAll = !recentAll)}>{recentAll ? 'Show fewer' : `Show all ${backupEvents.length}`}</button>
          {/if}
        {:else}
          <p class="muted small">No backup events in the last 7 days.</p>
        {/if}
      </div>
    {/if}
  {/snippet}

  <Sheet open={sheetOpen} depth={stack.length} title={sheetTitle} sub={sheetSub} {backTo} tall={sheet?.kind === 'infra'} onback={back} onclose={closeSheets}>
    {#if sheet?.kind === 'service' && sheetTile}
      {@const t = sheetTile}
      {@const j = sheetJob}
      <div class="sh-head">
        <span class="ic big"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={28} /></span>
        <span class="txt"><span class="state-w lv-{t.level}"><span class="dot lv-{t.level}" aria-hidden="true"></span>{t.status}</span><span class="d" class:hl={isProblem(t.lineLevel ?? '')}>{t.line}</span></span>
      </div>
      {#if t.href}<a class="primary wide" href={t.href} target={target} rel="noopener" onclick={() => opened(t.id)}>Open {t.name} {@render arrow()}</a>{/if}
      {#if t.beats}
        <div class="sh-block">
          <div class="sh-row"><span class="st">Last 24 hours</span><span class="muted small">{[`${pctTxt(t.uptime24)} up`, (t.check === 'http' || t.check === 'tcp') && `p95 ${t.p95 == null ? '—' : Math.round(t.p95) + ' ms'}`].filter(Boolean).join(' · ')}</span></div>
          <Beats beats={t.beats} end={snap.generatedAt} label="{t.name} over the last 24 hours" />
          <div class="sh-row muted small num"><span>−24 h</span><span>now</span></div>
        </div>
      {/if}
      {#if t.stats.length}
        <div class="facts">
          {#each t.stats as s}<div class="fact lv-{s.level ?? 'none'}"><span class="muted k">{s.k}</span><span class="fv" class:hl={isProblem(s.level ?? '')}>{s.v}</span></div>{/each}
        </div>
      {/if}
      <dl class="kv">
        {#if j}
          <div><dt>Schedule</dt><dd>every {ago(0, j.every)} · grace {ago(0, j.grace)}</dd></div>
          <div><dt>Last run</dt><dd>{since(j.lastOk)}{#if j.lastFail && (!j.lastOk || j.lastFail > j.lastOk)} · failure reported {since(j.lastFail)}{/if}</dd></div>
          <div><dt>Next run</dt><dd>{until(j.due, now)} · {j.status}</dd></div>
        {:else if t.check}
          <div><dt>Check</dt><dd>{KIND[t.check] ?? t.check}</dd></div>
        {/if}
        {#if t.uptime7 != null}<div><dt>Uptime 7 d</dt><dd>{pctTxt(t.uptime7)}</dd></div>{/if}
        {#if t.cert}<div><dt>Certificate</dt><dd>{validFor(t.cert.days)}{t.cert.selfSigned ? ' · self-signed' : ''}</dd></div>{/if}
        {#if t.description}<div><dt>About</dt><dd>{t.description}</dd></div>{/if}
      </dl>
      <div class="sh-block">
        <div class="sh-row"><span class="st">Activity</span><span class="muted small">Last 7 days</span></div>
        {#if sheetActivity.length}
          <ul class="evs" id="svc-activity">{#each svcAll ? sheetActivity : sheetActivity.slice(0, RECENT) as a (a.ts + a.title)}{@render event(a, { full: true })}{/each}</ul>
          {#if sheetActivity.length > RECENT}
            <button class="link-btn" aria-expanded={svcAll} aria-controls="svc-activity" onclick={() => (svcAll = !svcAll)}>{svcAll ? 'Show fewer' : `Show all ${sheetActivity.length}`}</button>
          {/if}
        {:else}
          <p class="muted small">No events in the last 7 days.</p>
        {/if}
      </div>
    {:else if sheet?.kind === 'infra'}
      <Infrastructure panels={snap.infrastructure} host={snap.host} storage={snap.storage} drives={snap.drives} network={snap.network} {target} now={snap.generatedAt} initial={sheet.tab} backups={backupsTab} />
    {:else if sheet?.kind === 'activity'}
      <div class="sh-block">
        <div class="sh-row"><span class="st">All services</span><span class="muted small">{pctTxt(snap.fleetAvail)} uptime</span></div>
        <Beats beats={snap.fleet} end={snap.generatedAt} label="Availability of all services over the last 24 hours" />
      </div>
      <ul class="evs">{#each snap.feed as a (a.ts + a.title)}{@render event(a, { tap: true })}{/each}</ul>
    {/if}
  </Sheet>

  <TabBar current={view} needCount={snap.needCount} level={snap.verdict.level} onnav={setView} onsearch={() => (paletteOpen = true)} />

  <Palette bind:open={paletteOpen} services={allServices} bookmarks={snap.bookmarks} mostUsed={snap.mostUsed} {target} onopen={opened} />
{/if}

<style>
  .boot { min-height: 100vh; display: grid; place-items: center; }
  .page { max-width: 1240px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 56px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 16px; }
  .small { font-size: 13px; }
  h2 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
  h2.k, .k { font-size: 13px; font-weight: 500; color: var(--muted); letter-spacing: 0; }
  h3 { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; }
  .thead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
  .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .txt .t { font-size: 15px; font-weight: 500; }
  .txt .d { font-size: 13.5px; overflow-wrap: anywhere; }
  .hl { color: color-mix(in srgb, var(--lv) 85%, var(--text)); }
  /* a filter: which of a list shows */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 11px; border: 0; border-radius: 999px; background: var(--surface-2); color: var(--muted); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: background-color 0.15s, color 0.15s; }
  .chip:hover { color: var(--text); }
  .chip[aria-pressed='true'] { background: var(--text); color: var(--bg); }
  .chip[aria-pressed='true'] .dot { background: currentColor; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 0 16px; border: 0; border-radius: 12px; background: var(--surface-2); color: var(--text); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .btn:hover { background: var(--surface-3); }
  .btn.primary, .primary { background: var(--text); color: var(--bg); }
  .primary.wide { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; box-sizing: border-box; min-height: 46px; border-radius: 12px; font-size: 14px; font-weight: 600; }

  /* top: the sentence and what to do, and beside it what needs attention (or, when calm, the most used services) */
  .top { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); }
  .top.calm { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
  .verdict { padding: 28px 30px; display: flex; flex-direction: column; justify-content: center; gap: 18px; min-width: 0; }
  .vrow { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
  .mark { width: 46px; height: 46px; margin-top: 1px; border-radius: 50%; background: var(--lv-soft); color: var(--lv); display: flex; align-items: center; justify-content: center; flex: none; }
  .mark svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .top.lv-none .mark { color: var(--muted); }
  .say { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
  .tag { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: clamp(26px, 2.9vw, 34px); line-height: 1.1; font-weight: 700; letter-spacing: -0.025em; text-wrap: balance; }
  .say p { margin: 0; font-size: 14.5px; }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; }
  .triage { padding: 20px 22px 14px; border-left: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .rows li + li { border-top: 1px solid var(--line); }
  .rows li.extra { display: none; }
  .rows li.flash { border-radius: 10px; }
  /* a problem: its shape, what it is in full, how long it has been raised, and the detail under it */
  .arow { width: 100%; box-sizing: border-box; display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: baseline; gap: 2px 10px; padding: 10px 6px; border: 0; border-radius: 10px; background: none; color: var(--text); font: inherit; text-align: left; }
  .arow.tap { cursor: pointer; transition: background-color 0.15s; }
  .arow.tap:hover { background: var(--surface-2); }
  .arow.tap:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  .arow .dot { align-self: center; justify-self: center; }
  .arow .t { font-size: 14.5px; font-weight: 500; overflow-wrap: anywhere; }
  .arow .w { font-size: 12.5px; color: var(--muted); }
  .arow .d { grid-column: 2; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
  .quiet { margin: 0; padding: 0 20px 20px; font-size: 14px; }
  .most { display: flex; flex-direction: column; gap: 6px; padding: 20px 26px 20px 8px; }
  .most .k { padding-left: 10px; }
  @media not all and (max-width: 760px) { .most.need { display: none; } }
  .apps { display: flex; flex-wrap: wrap; gap: 4px; }
  .app { width: 92px; display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 10px 2px; border-radius: 14px; text-align: center; font-size: 13px; }
  .app:hover { background: var(--surface-2); }
  /* a name wraps at its spaces onto two lines at most; a single word too long for the tile ends in an ellipsis, never split */
  .an { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: normal; word-break: normal; line-height: 1.25; max-width: 100%; }
  .an.one { display: block; white-space: nowrap; text-overflow: ellipsis; }
  .ic { position: relative; width: 38px; height: 38px; border-radius: 11px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex: none; }
  .ic.big { width: 50px; height: 50px; border-radius: 15px; }
  /* a most used service with a problem: one small marker, its colour from the level */
  .pmark { position: absolute; top: -3px; right: -3px; width: 12px; height: 12px; border-radius: 50%; background: var(--lv); box-shadow: 0 0 0 2px var(--surface); }

  /* infrastructure and backups: one strip, a cell per area: label, figure, a small picture of it, context */
  .infra { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); padding: 6px; }
  .cell { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 14px 16px; border: 0; border-radius: 14px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background-color 0.15s; }
  .cell:hover { background: var(--surface-2); }
  .cell:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  /* a rule between cells, left out next to a hovered one */
  .cell + .cell::before { content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; border-left: 1px solid var(--line); }
  .cell:hover::before, .cell:hover + .cell::before { display: none; }
  /* a cell of several figures (System: CPU, RAM, temperature) gets the room to keep them on one line */
  .cell:has(.ist + .ist + .ist) { grid-column: span 2; }
  .clab { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 13px; color: var(--muted); }
  .kw::before { content: '·'; margin-right: 7px; }
  .fig { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 12px; min-width: 0; }
  .fig .v, .fig .isv { font-size: 20px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .fig .u { margin-left: -6px; font-size: 13px; color: var(--muted); white-space: nowrap; }
  .ist { display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap; }
  .isk { font-size: 13px; color: var(--muted); }
  .isv.hl, .cell.alert .fig .v { color: var(--lv); }
  .viz { display: flex; align-items: flex-end; height: 28px; --fill: var(--acc); }
  .cell.alert .viz { --fill: var(--lv); }
  .meter { width: 100%; height: 6px; margin-bottom: 5px; border-radius: 3px; background: var(--track); overflow: hidden; }
  .meter span { display: block; height: 100%; border-radius: 3px; background: var(--fill); }
  /* a drive each: one that needs a look is outlined in its colour */
  .pips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 3px; }
  .pips span { width: 22px; height: 14px; border-radius: 4px; background: var(--surface-3); }
  .pips span.bad { box-shadow: inset 0 0 0 1.5px var(--lv); background: var(--lv-soft); }
  /* the last seven days of backups, today on the right: a short bar where something was late or failed, a stub where
     nothing was recorded */
  .days { display: flex; align-items: flex-end; gap: 3px; width: 100%; margin-bottom: 3px; }
  .days span { flex: 1; height: 14px; border-radius: 3px; background: var(--lv); opacity: 0.85; }
  .days span.bad { height: 7px; }
  .days span.none { height: 3px; background: var(--surface-3); opacity: 1; }
  .cell .s { font-size: 12.5px; color: var(--muted); min-width: 0; overflow-wrap: anywhere; }

  /* services, and beside them activity and links */
  .lower { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .side { display: flex; flex-direction: column; gap: 16px; min-width: 0; position: sticky; top: 16px; }
  .sec { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .sgroup { display: flex; flex-direction: column; gap: 4px; }
  .sgroup h3 { padding: 6px 8px 2px; }
  .tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 2px 8px; }
  /* a tile: the service to open, with its line, and at its end the way to its details */
  .tile { display: flex; align-items: center; min-width: 0; border-radius: 12px; transition: background-color 0.15s; }
  .tile:hover, .tile:focus-within { background: var(--surface-2); }
  .tmain { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 9px 2px 9px 8px; border: 0; border-radius: 12px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; -webkit-touch-callout: none; user-select: none; }
  .tmain:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  .tx { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .tx .t { font-size: 14.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tx .d { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tx .d.hl { color: color-mix(in srgb, var(--lv) 85%, var(--text)); }
  .inf { flex: none; width: 36px; height: 36px; margin-right: 4px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 10px; background: none; color: var(--muted); cursor: pointer; }
  .inf:hover { background: var(--surface-3); color: var(--text); }
  /* the details button of a healthy tile shows when the tile is pointed at or focused; a problem's shape always */
  .inf svg { opacity: 0; transition: opacity 0.15s; }
  .tile:hover .inf svg, .inf:focus-visible svg { opacity: 1; }
  @media (hover: none) { .inf svg { opacity: 1; } }

  .evs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .ev { padding: 12px 0; border-top: 1px solid var(--line); }
  .ev:first-child { border-top: 0; }
  .ev-row { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; }
  /* a row that opens a sheet: the whole row is the button, its hover reaching a little past the text */
  .ev:has(.tap) { padding: 4px 0; }
  .ev-row.tap { margin: 0 -8px; width: calc(100% + 16px); padding: 8px; border: 0; border-radius: 12px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color 0.15s; }
  .ev-row.tap:hover { background: var(--surface-2); }
  .ev-row.tap:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  .ev-ico { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--lv-soft); color: var(--lv); flex: none; }
  .ev-chev { flex: none; margin-left: -4px; color: var(--muted); }
  .ev-items { list-style: none; margin: 8px 0 0 44px; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
  .ev-more { margin-left: 44px; }
  .ev-more summary { margin-top: 6px; list-style: none; cursor: pointer; font-size: 13px; }
  .ev-more summary::-webkit-details-marker { display: none; }
  .ev-more[open] summary { display: none; }
  .ev-more .ev-items { margin-left: 0; }
  .ev.lv-ok .ev-ico { background: var(--surface-2); color: var(--muted); }
  .when { flex: none; }
  .link-btn { border: 0; background: none; padding: 6px; color: var(--acc); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; align-self: flex-start; }
  /* the notes, folded: one row that opens them */
  .notes { border-top: 1px solid var(--line); margin-top: -6px; }
  .notes summary { display: flex; align-items: center; gap: 12px; margin: 4px -8px 0; padding: 8px; border-radius: 12px; list-style: none; cursor: pointer; --lv: var(--acc); --lv-soft: var(--surface-2); }
  .notes summary::-webkit-details-marker { display: none; }
  .notes summary:hover { background: var(--surface-2); }
  .notes summary .t { font-size: 15px; font-weight: 500; }
  .notes summary .small { flex: 1; }
  .nchev { flex: none; color: var(--muted); transition: transform 0.15s; }
  .notes[open] .nchev { transform: rotate(180deg); }

  /* links: each link its icon beside its name */
  .lgroup { display: flex; flex-direction: column; gap: 4px; }
  .chipsrow { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0 -6px; }
  .lnk { display: inline-flex; align-items: center; gap: 9px; padding: 6px 12px 6px 6px; border-radius: 12px; font-size: 14px; }
  .lnk:hover { background: var(--surface-2); }
  .lnk .ic { width: 30px; height: 30px; border-radius: 9px; }

  /* footer */
  .foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px 24px; padding-top: 18px; border-top: 1px solid var(--line); }
  .ver { display: flex; align-items: center; gap: 14px; }
  .ver a { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line); }

  /* sheets */
  .sh-head { display: flex; align-items: center; gap: 14px; }
  .state-w { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; }
  .sh-block { display: flex; flex-direction: column; gap: 8px; --beats-h: 22px; }
  .sh-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .st { font-size: 15px; font-weight: 600; }
  .facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
  .fact { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); min-width: 0; }
  .fact .k { font-size: 13px; }
  .fv { font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
  .kv { margin: 0; display: flex; flex-direction: column; }
  .kv > div { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }
  .kv dt { color: var(--muted); flex: none; }
  .kv dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
  .jobs { list-style: none; margin: 0; padding: 0; }
  .job { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 0; border: 0; border-top: 1px solid var(--line); background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .jobs li:first-child .job { border-top: 0; }
  .job:hover .t { color: var(--acc); }
  .jr { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: none; }
  .jr .state-w { font-size: 13px; font-weight: 500; }

  :global(html) { scroll-padding-top: 12px; }
  /* connection lost or data stale: say so, and stop showing status colour as if it were current */
  .banner {
    display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 16px; border-radius: 16px;
    background: var(--warn-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 40%, transparent); color: var(--text);
    animation: drop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .banner > svg { color: var(--warn); flex: none; }
  .banner .t { font-weight: 600; }
  .banner .d { font-size: 13px; color: var(--muted); }
  .banner button { min-height: 36px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); font-weight: 500; cursor: pointer; }
  .page:has(.banner) :is(.top, .infra, .lower) { filter: grayscale(0.7); opacity: 0.8; transition: filter 0.3s, opacity 0.3s; }
  @keyframes drop { from { opacity: 0; transform: translateY(-6px); } }
  /* a status that just changed: one soft ring in its new colour */
  .flash { animation: flash 2.4s ease-out; }
  @keyframes flash { 0%, 30% { box-shadow: 0 0 0 3px var(--lv), var(--shadow); } }

  /* narrower: the list goes under the sentence, activity under the services; the strip wraps to three across */
  @media (max-width: 1000px) {
    .top, .top.calm { grid-template-columns: minmax(0, 1fr); }
    .triage { border-left: 0; border-top: 1px solid var(--line); }
    .most { padding: 0 22px 20px; }
    .lower { grid-template-columns: minmax(0, 1fr); }
    .side { position: static; }
    .infra { grid-auto-flow: row; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .cell:has(.ist + .ist + .ist) { grid-column: 1 / -1; }
    .cell + .cell::before { display: none; }
  }
  /* phones: one view at a time, above the tab bar */
  @media (max-width: 760px) {
    .page { gap: 12px; padding-bottom: calc(86px + env(safe-area-inset-bottom)); }
    /* a section shows in the views its data-v names */
    .page[data-view='home'] [data-v]:not([data-v~='home']),
    .page[data-view='services'] [data-v]:not([data-v~='services']),
    .page[data-view='alerts'] [data-v]:not([data-v~='alerts']) { display: none !important; }
    .top { border-radius: 22px; }
    .verdict { padding: 20px; gap: 16px; }
    .mark { width: 36px; height: 36px; margin-top: 0; }
    .mark svg { width: 19px; height: 19px; }
    .vrow { gap: 12px; }
    h1 { font-size: 26px; }
    .say p { font-size: 14px; }
    .acts { flex-direction: column; }
    .btn { min-height: 46px; font-size: 15px; }
    /* the Alerts view is the list, whole */
    .triage { border-top: 0; padding: 16px 14px; }
    .rows li.extra { display: block; }
    .more { display: none; }
    .arow { padding: 13px 6px; }
    .chip { min-height: 36px; }
    .most { padding: 0 12px 14px; }
    .apps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .app { width: auto; }
    .infra { border-radius: 22px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cell { padding: 12px 14px; }
    .fig .v, .fig .isv { font-size: 19px; }
    /* an odd one left over takes the row */
    .cell:last-child:nth-child(even) { grid-column: 1 / -1; }
    .sec { padding: 16px 14px; border-radius: 20px; }
    .tiles { grid-template-columns: minmax(0, 1fr); }
    .tile { min-height: 56px; }
    .tile:hover { background: none; }
    .tile:active { background: var(--surface-2); }
    .inf { width: 44px; height: 44px; margin: 0; }
    .banner button { min-height: 44px; min-width: 64px; }
  }
</style>
