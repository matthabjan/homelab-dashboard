<script lang="ts">
  import { onMount } from 'svelte';
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import type { FeedItem, Job, Level, SheetRef, Snapshot, Tile } from '$lib/types';
  import type { PageProps } from './$types';
  import Icon from '$lib/components/Icon.svelte';
  import Infrastructure from '$lib/components/Infrastructure.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import Palette from '$lib/components/Palette.svelte';
  import Beats from '$lib/components/Beats.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import { ago } from '$lib/ago.ts';

  // The page answers "is everything fine?" at a glance and gets you to a service in one tap. Everything else (strips,
  // charts, readings) is one tap deeper, in a sheet.
  let { data }: PageProps = $props();
  // svelte-ignore state_referenced_locally — only the first snapshot comes from load; the stream replaces it
  let snap = $state(data.snapshot);
  let live = $state<'connecting' | 'live' | 'reconnecting'>('connecting');
  let now = $state(Date.now());
  let paletteOpen = $state(false);

  const allServices = $derived(snap ? snap.groups.flatMap((g) => g.services) : []);
  const configLabel = $derived(!snap?.configProblems ? 'Setup' : `Setup, ${snap.configProblems} config problem${snap.configProblems === 1 ? '' : 's'}`);
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
  /** "in 3 d", "now" for a time that has passed */
  const until = (ts: number) => (ts <= now ? 'now' : `in ${ago(now, ts)}`);
  const today = $derived.by(() => {
    const d = new Date(now);
    return `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  });

  // ---- what the page shows, from the snapshot ----
  // under the hero: the other warnings and critical items (notes, such as pending updates, are the activity card's)
  const also = $derived(snap?.needCount ? snap.attention.slice(1).filter((a) => a.sev !== 'info') : []);
  const notes = $derived(snap ? snap.attention.filter((a) => a.sev === 'info') : []);
  // the activity list: notes, then events, without an event that repeats a note (the alert logged it)
  const activity = $derived.by(() => {
    if (!snap) return [];
    const said = new Set(notes.map((n) => `${n.sid ?? ''}\0${n.title}`));
    return [...notes, ...snap.events.filter((e) => !notes.some((n) => (n.sid === e.sid || !e.sid) && n.title.endsWith(e.title)) && !said.has(`${e.sid ?? ''}\0${e.title}`))];
  });
  let alsoAll = $state(false);
  const ALSO = 3;
  // the launcher: only what can be opened (jobs and services without href live in the Status view and the sheets)
  const launch = $derived(snap ? snap.groups.map((g) => ({ name: g.name, services: g.services.filter((t) => t.href) })).filter((g) => g.services.length) : []);
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
  const nextJob = $derived([...(snap?.jobs ?? [])].sort((a, b) => a.due - b.due)[0] ?? null);

  /** `stats`: labelled figures shown instead of value and sub, where one figure can't say it; `where`: beside the label */
  type Card = {
    id: 'system' | 'storage' | 'drives' | 'network' | 'backups'; label: string; where?: string; value: string; unit?: string; sub: string;
    stats?: { k: string; v: string; level: Level | 'none' }[]; level: Level | 'none';
  };
  /** a storage row's name for prose: "media · NAS" → "media (NAS)" */
  const storageName = (name: string) => name.replace(/^(.+?) · (.+)$/, '$1 ($2)');
  const worst = (levels: string[]): Level | 'none' => (levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : 'none');
  const cards: Card[] = $derived.by(() => {
    if (!snap) return [];
    const out: Card[] = [];
    const g = (k: string) => snap?.host?.gauges.find((x) => x.key === k);
    if (snap.host) {
      const cpu = g('cpu'), mem = g('mem'), temp = g('temp');
      out.push({
        id: 'system', label: 'System', where: snap.host.name,
        value: '', sub: '',
        stats: [
          cpu && { k: 'CPU', v: `${cpu.val}%`, level: cpu.level },
          mem && { k: 'RAM', v: mem.pct != null ? `${Math.round(mem.pct)}%` : '—', level: mem.level },
          temp && { k: 'Temp', v: `${temp.val} °C`, level: temp.level }
        ].filter((x) => !!x),
        level: worst(snap.host.gauges.map((x) => x.level))
      });
    }
    // a detached or unavailable row (a removable offsite disk) is expected: it never sets the card's figure or colour.
    // The card turns amber only for a row over storageWarnPct (it raises an alert); the bar's amber stays in the sheet
    const rows = snap.storage.filter((s) => s.level !== 'off' && s.pct != null);
    if (snap.storage.length) {
      const top = [...rows].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
      const off = snap.storage.length - rows.length;
      out.push({ id: 'storage', label: 'Storage', value: top ? `${Math.round(top.pct ?? 0)}%` : '—', unit: top ? 'full' : '', sub: [top ? storageName(top.name) : 'no usage reported', off && `${off} offline`].filter(Boolean).join(' · '), level: worst(rows.map((s): string => (s.level === 'crit' ? 'warn' : 'ok'))) });
    }
    if (snap.drives.length) {
      const d = snap.drives;
      const failing = d.filter((x) => x.status === 'failing').length;
      const check = d.filter((x) => isProblem(x.level) || isProblem(x.lifeLevel)).length - failing;
      // the hottest drive and the least life left, from the facts the Drives panel shows
      const temps = d.flatMap((x) => x.facts.map((f) => (f.k === '' ? parseFloat(f.v) : NaN))).filter((t) => !Number.isNaN(t));
      const lives = d.map((x) => x.life).filter((l): l is number => l != null);
      out.push({
        id: 'drives', label: 'Drives',
        value: failing ? `${failing} failing` : check ? `${check} to check` : d.every((x) => x.status === 'ok') ? 'All healthy' : 'No problems',
        sub: [`${d.length} drive${d.length === 1 ? '' : 's'}`, temps.length && `max ${Math.max(...temps)} °C`, lives.length && `${Math.min(...lives)}% life left`].filter(Boolean).join(' · '),
        level: worst(d.flatMap((x) => [x.level, x.lifeLevel]))
      });
    }
    if (snap.network) {
      const n = snap.network;
      const r = (v: number | null) => (v == null ? '—' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));
      out.push({ id: 'network', label: 'Network', value: n.down != null ? `↓${r(n.down)} ↑${r(n.up)}` : n.dns ? `${n.dns.blockedPct?.toFixed(1) ?? '—'}%` : '—', unit: n.down != null ? 'Mbit/s' : 'blocked', sub: [n.source, n.dns && n.down != null && `DNS ${n.dns.blockedPct?.toFixed(1) ?? '—'}% blocked`].filter(Boolean).join(' · '), level: 'none' });
    }
    const jobs = snap.jobs;
    if (jobs.length || snap.backups?.known) {
      const late = jobs.filter((j) => j.state === 'down');
      // PBS guests behind on backups: the merged count less the backup jobs that are late
      const pbsLate = Math.max(0, (snap.backups?.overdue ?? 0) - late.filter((j) => j.backup).length);
      const overdue = late.length + pbsLate;
      out.push({
        id: 'backups', label: 'Backups',
        value: overdue ? `${overdue} overdue` : 'All current',
        sub: overdue ? [...late.map((j) => j.name), pbsLate && `${pbsLate} PBS backup${pbsLate === 1 ? '' : 's'}`].filter(Boolean).join(', ') : nextJob ? `next: ${nextJob.name} ${until(nextJob.due)}` : snap.backups?.oldestAge != null ? `oldest backup ${ago(now - snap.backups.oldestAge, now)}` : '',
        level: overdue || late.length ? 'crit' : 'none'
      });
    }
    return out;
  });

  // ---- sheets: details on demand ----
  // A stack: a sheet opened from inside another (Backups → a job) is a level deeper, with a back button to the one
  // below. Each level is a history entry (shallow routing), so the browser's and Android's back go up one level, and
  // closing (✕, the backdrop, a swipe down) pops them all.
  const stack = $derived<SheetRef[]>(page.state.sheets ?? []);
  const sheet = $derived(stack.at(-1) ?? null);
  const sheetOpen = $derived(stack.length > 0);
  const show = (s: SheetRef) => pushState('', { sheets: [...stack, s] });
  const back = () => history.back();
  const closeSheets = () => { if (stack.length) history.go(-stack.length); };
  const openCard = (c: Card) => show(c.id === 'backups' ? { kind: 'backups' } : { kind: 'infra', tab: c.id });
  const sheetId = $derived(sheet?.kind === 'service' ? sheet.id : null);
  const sheetTile = $derived(sheetId ? allServices.find((t) => t.id === sheetId) ?? null : null);
  const sheetJob = $derived(sheetId ? jobById.get(sheetId) ?? null : null);
  // the service sheet's activity: what is raised about it now, then its events of the last 7 days (fetched, since the
  // snapshot only carries the latest events of all services), refreshed when something changes
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
  // the Backups sheet's recent list: the last 7 days of PBS and backup-job events, refreshed when something changes
  let backupEvents = $state<FeedItem[]>([]);
  $effect(() => {
    void snap?.lastChange;
    if (sheet?.kind !== 'backups' || !sheetOpen) return;
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
    const past = svcEvents?.sid === sheetId ? svcEvents.items : snap.events.filter((e) => e.sid === sheetId);
    return [...raised, ...past.filter((e) => !raised.some((a) => a.title.endsWith(e.title)))];
  });
  const titleOf = (s: SheetRef | null | undefined) =>
    !s ? '' : s.kind === 'service' ? allServices.find((t) => t.id === s.id)?.name ?? '' : s.kind === 'infra' ? 'Infrastructure' : s.kind === 'backups' ? 'Backups' : 'Activity';
  const sheetTitle = $derived(titleOf(sheet));
  const backTo = $derived(stack.length > 1 ? titleOf(stack.at(-2)) : undefined);
  const sheetSub = $derived(
    sheet?.kind === 'service' ? [sheetTile?.group, sheetTile?.host].filter(Boolean).join(' · ')
    : sheet?.kind === 'backups' ? cards.find((c) => c.id === 'backups')?.sub ?? ''
    : sheet?.kind === 'activity' ? 'Last 24 hours' : ''
  );

  // ---- services: launch (plain icons) or status (every service with its state and 24 h strip) ----
  let mode = $state<'launch' | 'status'>('launch');
  function setMode(m: 'launch' | 'status') {
    mode = m;
    try { localStorage.setItem('servicesView', m); } catch {}
  }

  /** (re)open the stream now: the banner's Retry, coming back online. Set once mounted */
  let connect = () => {};
  onMount(() => {
    try { const m = localStorage.getItem('servicesView'); if (m === 'status' || m === 'launch') mode = m; } catch {}
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
    now = Date.now(); // the server rendered the date in its own timezone
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
  const jobState = (j: Job) => (j.state === 'down' ? (j.failed ? 'failed' : 'overdue') : j.state === 'pending' ? 'waiting for its first run' : 'on schedule');
</script>

<svelte:window onkeydown={onKey} />

<!-- setup: the header button and the footer link -->
{#snippet sliders()}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></svg>{/snippet}
{#snippet arrow()}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>{/snippet}

<!-- one event or alert in a list: what happened, about which service, and when -->
{#snippet event(a: FeedItem)}
  <li class="ev lv-{a.sev}">
    <span class="ev-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS[a.sev] ?? ICONS.info} /></svg></span>
    <span class="txt"><span class="t">{a.title}</span>{#if a.detail}<span class="d muted">{a.detail}</span>{/if}</span>
    <span class="mono muted small when">{ago(a.ts, now)}</span>
  </li>
{/snippet}

{#if !snap}
  <main class="boot"><p class="muted">Starting up…</p></main>
{:else}
  <div class="page" id="top">
    <header class="top">
      <a class="brand" href="/" aria-label="{snap.title} — home">
        {#if snap.logo}<img src={snap.logo} alt="" width="34" height="34" />{/if}
        <span class="btxt"><span class="date muted">{today}</span><span class="bname">{snap.title}</span></span>
      </a>
      <button class="search card" onclick={() => (paletteOpen = true)} aria-label="Search or jump to a service" aria-keyshortcuts="/ Control+K Meta+K">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span class="ph">Open a service…</span>
        <kbd class="mono">/</kbd>
      </button>
      <div class="right">
        <span class="live" class:warn={stale || live === 'reconnecting'} role="status">
          <span class="pulse"></span>
          {#if live === 'reconnecting'}<span class="only-desktop">Reconnecting…</span><span class="only-phone">Retrying</span>{:else if stale}<span class="only-desktop">Data {ago(snap.generatedAt, now)} old</span><span class="only-phone">Stale</span>{:else}<span class="live-word">Live</span>{/if}
          {#if snap.demo}<span class="demo">demo</span>{/if}
        </span>
        {#if snap.deepLink?.href}
          <a class="deep lift" href={snap.deepLink.href} target={target} rel="noopener">{snap.deepLink.name ?? 'Monitoring'} {@render arrow()}</a>
        {/if}
        <button class="hbtn only-phone" onclick={() => (paletteOpen = true)} aria-label="Open a service"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></button>
        <a class="hbtn cfg" href="/config" aria-label={configLabel} title={configLabel}>
          {@render sliders()}
          {#if snap.configProblems}<span class="cfg-badge mono" aria-hidden="true">{snap.configProblems}</span>{/if}
        </a>
        <span class="only-desktop"><ThemeToggle /></span>
      </div>
    </header>

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

    <!-- the answer first: one sentence; while something needs attention, the way to it -->
    <section class="card hero lv-{degraded ? 'none' : snap.verdict.level}" class:alert={!degraded && isProblem(snap.verdict.level)} class:flash={flash.has('verdict')} aria-label="Overall status">
      <div class="state">
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
        {#if snap.verdict.action}
          <a class="primary lift" href={snap.verdict.action.href} target={linkTarget(snap.verdict.action.href)} rel="noopener">{snap.verdict.action.label} {@render arrow()}</a>
        {/if}
      </div>

      {#if also.length}
        <div class="also">
          <h2 class="k">Also needs attention · {also.length}</h2>
          <ul class="probs" id="also">
            {#each alsoAll ? also : also.slice(0, ALSO) as a (a.key)}
              <li class="prob lv-{a.sev}" class:flash={!!a.sid && flash.has(a.sid)}>
                <!-- the card opens the service's details; Open goes straight to the service -->
                <svelte:element this={a.sid ? 'button' : 'div'} class="pbody" onclick={() => a.sid && show({ kind: 'service', id: a.sid })} role={a.sid ? undefined : 'group'}>
                  <span class="ev-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS[a.sev] ?? ICONS.info} /></svg></span>
                  <span class="txt"><span class="t">{a.title}</span>{#if a.detail}<span class="d muted">{a.detail}</span>{/if}</span>
                </svelte:element>
                {#if a.href}<a class="ghost" href={a.href} target={linkTarget(a.href)} rel="noopener" aria-label="Open {a.service ?? 'service'}">Open {@render arrow()}</a>{/if}
              </li>
            {/each}
          </ul>
          {#if also.length > ALSO}
            <button class="link-btn" aria-expanded={alsoAll} aria-controls="also" onclick={() => (alsoAll = !alsoAll)}>{alsoAll ? 'Show fewer' : `Show ${also.length - ALSO} more`}</button>
          {/if}
        </div>
      {/if}

      {#if snap.mostUsed.length}
        <div class="most">
          <h2 class="k">Most used</h2>
          <div class="apps">
            {#each snap.mostUsed as t (t.id)}
              <a class="app lift" href={t.href} target={target} rel="noopener" onclick={() => opened(t.id)} aria-label="{t.name}{isProblem(t.level) ? `, ${t.status}` : ''}">
                <span class="ic big lv-{t.level}"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={28} />{#if isProblem(t.level)}<span class="pmark" aria-hidden="true"></span>{/if}</span>
                <span class="an">{t.name}</span>
              </a>
            {/each}
          </div>
        </div>
      {/if}
    </section>

    {#if cards.length}
      <section class="cards" aria-label="Infrastructure" style="--n: {cards.length}">
        {#each cards as c (c.id)}
          <button class="card vcard lift lv-{c.level}" class:alert={isProblem(c.level)} onclick={() => openCard(c)}>
            <span class="k">{c.label}{#if c.where}<span class="kw">· {c.where}</span>{/if}</span>
            {#if c.stats}
              <span class="stats">
                {#each c.stats as st (st.k)}<span class="st"><span class="sk">{st.k}</span><span class="sv" class:hl={isProblem(st.level)} style:--lv={isProblem(st.level) ? `var(--${st.level})` : undefined}>{st.v}</span></span>{/each}
              </span>
            {:else}
              <span class="v">{c.value}{#if c.unit}<span class="u">{c.unit}</span>{/if}</span>
              <span class="s">{c.sub}</span>
            {/if}
          </button>
        {/each}
      </section>
    {/if}

    <div class="lower">
      <section class="card sec services" aria-labelledby="h-services">
        <div class="sec-head">
          <h2 id="h-services">Services</h2>
          <div class="seg" role="group" aria-label="Show services as">
            <button aria-pressed={mode === 'launch'} onclick={() => setMode('launch')}>Launch</button>
            <button aria-pressed={mode === 'status'} onclick={() => setMode('status')}>Status</button>
          </div>
        </div>

        {#if mode === 'launch'}
          <div class="launch">
            {#each launch as g (g.name)}
              <div class="lgroup">
                <h3>{g.name}</h3>
                <div class="apps">
                  {#each g.services as t (t.id)}
                    <a class="app lift" class:flash={flash.has(t.id)} href={t.href} target={target} rel="noopener" onclick={() => opened(t.id)} aria-label="{t.name}{isProblem(t.level) ? `, ${t.status}` : ''}">
                      <span class="ic lv-{t.level}"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={24} />{#if isProblem(t.level)}<span class="pmark" aria-hidden="true"></span>{/if}</span>
                      <span class="an">{t.name}</span>
                    </a>
                  {/each}
                </div>
              </div>
            {:else}
              <p class="muted">No service has a link (<code>href</code>) yet.</p>
            {/each}
          </div>
        {:else}
          <!-- the density view: every service and job, with its state, status line and 24 h strip; a row opens its sheet -->
          <div class="fleet">
            <span class="muted small">All services, last 24 h · {pctTxt(snap.fleetAvail)} uptime</span>
            <Beats beats={snap.fleet} end={snap.generatedAt} label="Availability of all services over the last 24 hours" />
          </div>
          {#each snap.groups as g (g.name)}
            <div class="sgroup">
              <h3>{g.name} <span class="mono muted small">{g.summary}</span></h3>
              <ul class="srows">
                {#each g.services as t (t.id)}
                  <li>
                    <button class="srow lv-{t.level}" class:flash={flash.has(t.id)} onclick={() => show({ kind: 'service', id: t.id })}>
                      <span class="ic"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={22} /></span>
                      <span class="txt"><span class="t">{t.name}</span><span class="d" class:hl={isProblem(t.lineLevel ?? '')}>{t.line}</span></span>
                      {#if t.beats}<span class="sbeats" aria-hidden="true"><Beats beats={t.beats} end={snap.generatedAt} label="" /></span>{/if}
                      <span class="mono small muted up">{pctTxt(t.uptime24, 1)}</span>
                      <span class="dot lv-{t.level}" title={t.status}></span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        {/if}
      </section>

      <section class="card sec activity" aria-labelledby="h-activity">
        <div class="sec-head"><h2 id="h-activity">Activity</h2>{#if activity.length > 5}<button class="link-btn" onclick={() => show({ kind: 'activity' })}>Show all</button>{/if}</div>
        {#if activity.length}
          <ul class="evs">{#each activity.slice(0, 5) as a (a.ts + a.title)}{@render event(a)}{/each}</ul>
        {:else}
          <p class="muted small">No changes in the last 24 hours.</p>
        {/if}
      </section>
    </div>

    {#if snap.bookmarks.length}
      <!-- the same card and launch grid as Services: groups with their label, an icon chip over each name -->
      <section class="card sec" aria-labelledby="h-links">
        <div class="sec-head"><h2 id="h-links">Links</h2></div>
        <div class="launch">
          {#each linkGroups as g (g.name)}
            <div class="lgroup">
              {#if g.name && linkGroups.length > 1}<h3>{g.name}</h3>{/if}
              <div class="apps">
                {#each g.links as b (b.href + b.name)}
                  <a class="app lift" href={b.href} target={target} rel="noopener">
                    <span class="ic"><Icon src={b.icon} dark={b.iconDark} name={b.name} size={24} /></span>
                    <span class="an">{b.name}</span>
                  </a>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <footer class="foot">
      <a class="foot-cfg" href="/config">
        {@render sliders()}
        <span><span class="t">Setup</span><span class="d muted">{snap.configProblems ? `${snap.configProblems} problem${snap.configProblems === 1 ? '' : 's'} in your config` : 'What loaded, which widgets connect'}</span></span>
      </a>
      <span class="muted small ver">
        <span class="only-phone"><ThemeToggle /></span>
        <a href="https://github.com/matthabjan/homelab-dashboard/tree/main/docs" target="_blank" rel="noopener">Documentation</a>
        {#if snap.version}<span class="mono">v{snap.version}</span>{/if}
      </span>
    </footer>
  </div>

  <Sheet open={sheetOpen} depth={stack.length} title={sheetTitle} sub={sheetSub} {backTo} onback={back} onclose={closeSheets}>
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
          <div class="sh-row muted small mono"><span>−24 h</span><span>now</span></div>
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
          <div><dt>Next run</dt><dd>{until(j.due)} · {jobState(j)}</dd></div>
        {:else if t.check}
          <div><dt>Check</dt><dd>{KIND[t.check] ?? t.check}</dd></div>
        {/if}
        {#if t.uptime7 != null}<div><dt>Uptime 7 d</dt><dd>{pctTxt(t.uptime7)}</dd></div>{/if}
        {#if t.cert}<div><dt>Certificate</dt><dd>{t.cert.days < 0 ? 'expired' : `valid ${t.cert.days} d`}{t.cert.selfSigned ? ' · self-signed' : ''}</dd></div>{/if}
        {#if t.description}<div><dt>About</dt><dd>{t.description}</dd></div>{/if}
      </dl>
      <div class="sh-block">
        <div class="sh-row"><span class="st">Activity</span><span class="muted small">Last 7 days</span></div>
        {#if sheetActivity.length}
          <ul class="evs">{#each sheetActivity as a (a.ts + a.title)}{@render event(a)}{/each}</ul>
        {:else}
          <p class="muted small">No events in the last 7 days.</p>
        {/if}
      </div>
    {:else if sheet?.kind === 'infra'}
      <Infrastructure host={snap.host} storage={snap.storage} drives={snap.drives} network={snap.network} {target} now={snap.generatedAt} initial={sheet.tab} />
    {:else if sheet?.kind === 'backups'}
      {#if snap.backups?.known && snap.backups.oldestAge != null}
        <div class="facts">
          <div class="fact"><span class="muted k">Oldest backup</span><span class="fv">{ago(now - snap.backups.oldestAge, now)}</span></div>
          <div class="fact lv-{snap.backups.overdue ? 'crit' : 'none'}"><span class="muted k">Overdue</span><span class="fv" class:hl={!!snap.backups.overdue}>{snap.backups.overdue}</span></div>
        </div>
      {/if}
      {#if snap.jobs.length || snap.guestBackups.length}
        <ul class="jobs">
          <!-- PBS guest backups first: they run daily, so they are the ones that change most -->
          {#each snap.guestBackups as gb (gb.id)}
            <li>
              <button class="job" onclick={() => show({ kind: 'service', id: gb.id })}>
                <span class="txt"><span class="t">Guest backups{gb.stores.length ? ` · ${gb.stores.join(', ')}` : ''}</span><span class="d muted">{gb.guests} guest{gb.guests === 1 ? '' : 's'} · last run {since(gb.last)}</span></span>
                <span class="jr"><span class="state-w lv-{gb.overdue ? 'crit' : 'ok'}"><span class="dot lv-{gb.overdue ? 'crit' : 'ok'}" aria-hidden="true"></span>{gb.overdue ? `${gb.overdue} overdue` : 'on schedule'}</span><span class="muted small">{gb.name}</span></span>
              </button>
            </li>
          {/each}
          {#each [...snap.jobs].sort((a, b) => a.due - b.due) as j (j.id)}
            <li>
              <button class="job" onclick={() => show({ kind: 'service', id: j.id })}>
                <span class="txt"><span class="t">{j.name}</span><span class="d muted">every {ago(0, j.every)} · last run {since(j.lastOk)}</span></span>
                <span class="jr"><span class="state-w lv-{j.state === 'down' ? 'crit' : j.state === 'up' ? 'ok' : 'none'}"><span class="dot lv-{j.state === 'down' ? 'crit' : j.state === 'up' ? 'ok' : 'none'}" aria-hidden="true"></span>{jobState(j)}</span><span class="muted small">next {until(j.due)}</span></span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="sh-block">
        <div class="sh-row"><span class="st">Recent</span><span class="muted small">Last 7 days</span></div>
        {#if backupEvents.length}
          <ul class="evs">{#each backupEvents as a (a.ts + a.title)}{@render event(a)}{/each}</ul>
        {:else}
          <p class="muted small">No backup events in the last 7 days.</p>
        {/if}
      </div>
    {:else if sheet?.kind === 'activity'}
      <div class="sh-block">
        <div class="sh-row"><span class="st">All services</span><span class="muted small">{pctTxt(snap.fleetAvail)} uptime</span></div>
        <Beats beats={snap.fleet} end={snap.generatedAt} label="Availability of all services over the last 24 hours" />
      </div>
      <ul class="evs">{#each activity as a (a.ts + a.title)}{@render event(a)}{/each}</ul>
    {/if}
  </Sheet>

  <Palette bind:open={paletteOpen} services={allServices} bookmarks={snap.bookmarks} mostUsed={snap.mostUsed} {target} onopen={opened} />
{/if}

<style>
  .boot { min-height: 100vh; display: grid; place-items: center; }
  .page { max-width: 1240px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 56px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 16px; }
  .small { font-size: 12px; }
  h2 { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  h2.k, .k { font-size: 13px; font-weight: 500; color: var(--muted); letter-spacing: 0; }
  h3 { font-size: 12px; font-weight: 600; color: var(--muted); }
  .sec-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
  .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .txt .t { font-size: 14px; font-weight: 500; }
  .txt .d { font-size: 12.5px; overflow-wrap: anywhere; }
  .hl { color: color-mix(in srgb, var(--lv) 85%, var(--text)); }

  /* header */
  .top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand img { width: 40px; height: 40px; border-radius: 12px; }
  .btxt { display: flex; flex-direction: column; min-width: 0; }
  .date { font-size: 12.5px; font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bname { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search { flex: 1 1 260px; max-width: 420px; margin-left: auto; display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 12px 0 14px; border: 0; border-radius: 12px; color: var(--muted); cursor: pointer; text-align: left; }
  .search:hover { color: var(--text); }
  .search .ph { flex: 1; }
  kbd { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--surface-2); }
  .right { display: flex; align-items: center; gap: 8px; }
  .live { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); white-space: nowrap; }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px var(--ok-soft); animation: breathe 3s ease-in-out infinite; }
  .live.warn .pulse { background: var(--warn); box-shadow: 0 0 0 4px var(--warn-soft); }
  .demo { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 5px; background: var(--surface-3); color: var(--text); }
  .hbtn { position: relative; display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border: 0; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); color: var(--text); cursor: pointer; }
  .hbtn svg, .foot-cfg svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .cfg-badge { position: absolute; top: -4px; right: -4px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--warn); color: var(--bg); font-size: 10px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
  .deep { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; padding: 0 14px; min-height: 42px; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); }
  @keyframes breathe { 50% { box-shadow: 0 0 0 7px transparent; } }

  /* hero: the sentence, the way to what needs attention, the most used services */
  .hero { padding: 28px 30px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 22px 32px; align-items: center; }
  .hero.alert { box-shadow: inset 0 0 0 1.5px var(--lv), var(--shadow); }
  .state { display: flex; align-items: center; gap: 18px; min-width: 0; }
  .hero:has(.also) .state, .hero:has(.also) .also { grid-column: 1 / -1; }
  .mark { width: 54px; height: 54px; border-radius: 50%; background: var(--lv-soft); color: var(--lv); display: flex; align-items: center; justify-content: center; flex: none; }
  .mark svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .hero.lv-none .mark { color: var(--muted); }
  .say { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
  .tag { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: clamp(28px, 3.4vw, 38px); line-height: 1.1; font-weight: 700; letter-spacing: -0.025em; text-wrap: balance; }
  .say p { margin: 0; font-size: 15px; }
  .primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; border-radius: 12px; background: var(--text); color: var(--bg); font-size: 14px; font-weight: 600; flex: none; }
  .primary.wide { width: 100%; box-sizing: border-box; min-height: 46px; }
  .also { display: flex; flex-direction: column; gap: 8px; }
  .probs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px; }
  .prob { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 6px; border-radius: 16px; background: var(--lv-soft); min-width: 0; }
  .pbody { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 6px; border: 0; border-radius: 12px; background: none; color: var(--text); font: inherit; text-align: left; }
  button.pbody { cursor: pointer; }
  button.pbody:hover .t { text-decoration: underline; text-underline-offset: 3px; }
  .prob .t, .prob .d { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ev-ico { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--lv-soft); color: var(--lv); flex: none; }
  .prob .ev-ico { background: var(--surface); }
  .ghost { flex: none; min-height: 36px; padding: 0 12px; border: 0; border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .most { display: flex; flex-direction: column; gap: 6px; }
  .hero:has(.also) .most { grid-column: 1 / -1; }
  .apps { display: flex; flex-wrap: wrap; gap: 4px; }
  .app { width: 96px; display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 10px 2px; border-radius: 14px; text-align: center; font-size: 12px; }
  .app:hover { background: var(--surface-2); }
  .an { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: break-word; hyphens: auto; line-height: 1.25; max-width: 100%; }
  .ic { position: relative; width: 40px; height: 40px; border-radius: 12px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex: none; }
  .ic.big { width: 50px; height: 50px; border-radius: 15px; }
  /* a service with a problem: one small marker, its colour from the level; the launcher shows nothing else */
  .pmark { position: absolute; top: -3px; right: -3px; width: 12px; height: 12px; border-radius: 50%; background: var(--lv); box-shadow: 0 0 0 2px var(--surface); }

  /* infrastructure and backups: one figure each; the card opens its sheet */
  .cards { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 14px; }
  .vcard { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 16px 18px; border: 0; border-radius: 18px; color: var(--text); font: inherit; text-align: left; cursor: pointer; min-width: 0; }
  .vcard.alert { background: var(--lv-soft); box-shadow: inset 0 0 0 1.5px var(--lv); }
  .vcard .v { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap; }
  .vcard .u { margin-left: 5px; font-size: 14px; font-weight: 500; color: var(--muted); }
  .vcard .s { font-size: 12.5px; color: var(--muted); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vcard.alert .k, .vcard.alert .s, .vcard.alert .u { color: color-mix(in srgb, var(--lv) 75%, var(--text)); }
  .vcard .kw { margin-left: 0.3em; color: var(--muted); }
  /* labelled figures: a small label over each value, side by side */
  .stats { display: flex; gap: 6px 22px; flex-wrap: wrap; margin-top: 2px; }
  .st { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .sk { font-size: 12px; color: var(--muted); }
  .sv { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap; }
  .sv.hl { color: var(--lv); }

  /* services and activity */
  .lower { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
  .sec { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--surface-2); }
  .seg button { min-height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: var(--muted); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
  .seg button[aria-pressed='true'] { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
  .launch { display: flex; flex-wrap: wrap; gap: 14px 26px; }
  .lgroup { display: flex; flex-direction: column; gap: 2px; }
  .lgroup h3 { padding-left: 10px; }
  .fleet { display: flex; flex-direction: column; gap: 6px; --beats-h: 12px; }
  .sgroup { display: flex; flex-direction: column; gap: 4px; }
  .sgroup h3 { display: flex; gap: 8px; align-items: baseline; padding-top: 4px; }
  .srows { list-style: none; margin: 0; padding: 0; }
  .srow { width: 100%; display: flex; align-items: center; gap: 12px; padding: 9px 8px; border: 0; border-radius: 12px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .srow:hover { background: var(--surface-2); }
  .srow .d { color: var(--muted); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; line-clamp: 1; overflow: hidden; }
  .srow .d.hl { color: color-mix(in srgb, var(--lv) 85%, var(--text)); }
  .sbeats { width: 150px; flex: none; --beats-h: 8px; }
  .up { width: 5.5ch; text-align: right; flex: none; }
  .evs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .ev { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .ev:first-child { border-top: 0; }
  .ev.lv-ok .ev-ico { background: var(--surface-2); color: var(--muted); }
  .when { flex: none; }
  .link-btn { border: 0; background: none; padding: 6px 0; color: var(--acc); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; align-self: flex-start; }

  /* links, footer */
  .foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; padding-top: 18px; border-top: 1px solid var(--line); }
  .foot-cfg { display: flex; align-items: center; gap: 12px; min-height: 44px; padding-right: 8px; border-radius: 12px; }
  .foot-cfg > svg { box-sizing: content-box; padding: 9px; border-radius: 11px; background: var(--surface-2); color: var(--muted); }
  .foot-cfg > span { display: flex; flex-direction: column; }
  .foot-cfg .t { font-size: 14px; font-weight: 500; }
  .foot-cfg .d { font-size: 12px; }
  .foot-cfg:hover .t { color: var(--acc); }
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
  .fact .k { font-size: 12px; }
  .fv { font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
  .kv { margin: 0; display: flex; flex-direction: column; }
  .kv > div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-top: 1px solid var(--line); font-size: 14px; }
  .kv dt { color: var(--muted); flex: none; }
  .kv dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
  .jobs { list-style: none; margin: 0; padding: 0; }
  .job { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 0; border: 0; border-top: 1px solid var(--line); background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
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
  .banner .d { font-size: 12px; color: var(--muted); }
  .banner button { min-height: 36px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); font-weight: 500; cursor: pointer; }
  .page:has(.banner) :is(.hero, .cards, .lower) { filter: grayscale(0.7); opacity: 0.8; transition: filter 0.3s, opacity 0.3s; }
  @keyframes drop { from { opacity: 0; transform: translateY(-6px); } }
  /* a status that just changed: one soft ring in its new colour */
  .flash { animation: flash 2.4s ease-out; }
  @keyframes flash { 0%, 30% { box-shadow: 0 0 0 3px var(--lv), var(--shadow); } }

  @media (max-width: 1000px) {
    .hero { grid-template-columns: minmax(0, 1fr); }
    .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* an odd count: the last card takes the whole row */
    .vcard:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .lower { grid-template-columns: minmax(0, 1fr); }
    .sbeats { width: 110px; }
  }
  /* phones: the same order, tighter; search and setup in the header, the theme in the footer */
  @media (max-width: 760px) {
    .page { gap: 14px; }
    .search, .deep, .live :global(.demo) { display: none; }
    .top { flex-wrap: nowrap; gap: 10px; }
    .brand { flex: 1 1 auto; }
    .right { margin-left: auto; }
    .live { min-width: 28px; min-height: 28px; justify-content: center; }
    .live-word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .hbtn { width: 44px; height: 44px; border-radius: 14px; }
    .bname { font-size: 19px; }
    .hero { padding: 20px; border-radius: 22px; gap: 18px; }
    /* phones: the mark sits beside the headline like a status icon; the detail and the action go full width below */
    .state { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px 12px; }
    .say { display: contents; }
    .tag { grid-column: 1 / -1; order: -1; }
    .say p, .state .primary { grid-column: 1 / -1; }
    .mark { width: 36px; height: 36px; }
    .mark svg { width: 19px; height: 19px; }
    h1 { font-size: 26px; }
    .say p { font-size: 14px; }
    .primary { width: 100%; min-height: 48px; font-size: 15px; }
    .probs { grid-template-columns: minmax(0, 1fr); }
    .prob .t, .prob .d { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
    .prob .ghost { min-height: 44px; padding: 0 12px; }
    .apps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .app { width: auto; }
    /* phones: one grid of four, in services.yaml order, without the group labels */
    .launch { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .lgroup, .lgroup .apps { display: contents; }
    .lgroup h3 { display: none; }
    .vcard { padding: 14px 16px; }
    .vcard .v { font-size: 19px; }
    .stats { gap: 6px 14px; }
    .sv { font-size: 18px; }
    .sec { padding: 16px; border-radius: 20px; }
    .sbeats, .up { display: none; }
    .seg button { min-height: 36px; }
    .banner button { min-height: 44px; min-width: 64px; }
  }
</style>
