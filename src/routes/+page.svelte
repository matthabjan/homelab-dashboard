<script>
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Gauge from '$lib/components/Gauge.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import Palette from '$lib/components/Palette.svelte';
  import Beats from '$lib/components/Beats.svelte';

  /** @type {import('./$types').PageProps} */
  let { data } = $props();
  // svelte-ignore state_referenced_locally — only the first snapshot comes from load; the stream replaces it
  let snap = $state(data.snapshot);
  let live = $state('connecting'); // connecting | live | reconnecting
  let now = $state(Date.now());
  let paletteOpen = $state(false);
  let feedOpen = $state(false); // phones: attention list expanded past the first 3
  let section = $state('top'); // phones: tab bar item for the section in view
  // storage card: usage or drives. Remembered per browser as a convenience, so storage errors are ignored
  let storageView = $state('storage');
  onMount(() => {
    try { if (localStorage.getItem('storageView') === 'drives') storageView = 'drives'; } catch {}
  });
  function showStorage(view) {
    storageView = view;
    try { localStorage.setItem('storageView', view); } catch {}
  }
  // arrow keys move between the two tabs (roving tabindex)
  function tabKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = storageView === 'storage' ? 'drives' : 'storage';
    showStorage(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  const allServices = $derived(snap ? snap.groups.flatMap((g) => g.services) : []);
  const stale = $derived(snap && now - snap.generatedAt > snap.staleAfter);
  // the stream has been down past a short grace (a server restart is a blip), or the device is offline
  let lost = $state(false);
  let offline = $state(false);
  // a status page must not keep saying "all good" on old data: the page greys out instead
  const degraded = $derived(!!stale || lost || offline);
  // tiles (and 'verdict') whose level changed in the last update, briefly highlighted
  let flash = $state(new Set());
  /** @param {import('$lib/types').Snapshot} prev @param {import('$lib/types').Snapshot} next */
  function changes(prev, next) {
    const was = new Map(prev.groups.flatMap((g) => g.services).map((t) => [t.id, t.level]));
    const ids = next.groups.flatMap((g) => g.services).filter((t) => was.has(t.id) && was.get(t.id) !== t.level).map((t) => t.id);
    if (prev.verdict.level !== next.verdict.level) ids.push('verdict');
    return ids;
  }
  let unflash;
  /** a new snapshot from the stream; whatever changed level is highlighted for a moment */
  function receive(next) {
    const ids = snap ? changes(snap, next) : [];
    snap = next;
    if (!ids.length) return;
    flash = new Set(ids);
    clearTimeout(unflash);
    unflash = setTimeout(() => (flash = new Set()), 2400);
  }
  // problems first; when all is well show recent changes (incl. informational notes)
  const feed = $derived(
    !snap ? [] : snap.needCount ? snap.attention : dedupe([...snap.attention, ...snap.events].sort((a, b) => b.ts - a.ts))
  );
  function dedupe(list) {
    const seen = new Set();
    return list.filter((x) => !seen.has(x.title) && seen.add(x.title));
  }
  const target = $derived(snap?.linkTarget || '_blank');
  // phones: every service in one list, problems first, otherwise config order (sort is stable)
  const RANK = { crit: 0, warn: 1 };
  const isProblem = (level) => level in RANK;
  // phones have no tooltips: a problem row in the services list leads with its status word ("Up · …") unless the line already says it
  const statusWord = (t) => (isProblem(t.level) && t.status && !t.line.toLowerCase().includes(t.status.toLowerCase()) ? t.status : '');
  const uptimeTxt = (t) => (t.uptime24 != null ? `${pctTxt(t.uptime24)} uptime in 24 h` : '');
  // phones: the fleet ribbon slot under the finger, in place of the "Last 24 h" label
  let fleetPick = $state(/** @type {string | null} */ (null));
  const serviceList = $derived(
    !snap ? [] : snap.groups.flatMap((g) => g.services.map((t) => ({ t, group: g.name }))).sort((a, b) => (RANK[a.t.level] ?? 2) - (RANK[b.t.level] ?? 2))
  );
  const today = $derived.by(() => {
    const d = new Date(now);
    return `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  });

  /** (re)open the stream now: the banner's Retry, coming back online. Set once mounted */
  let connect = () => {};
  onMount(() => {
    let es;
    let retry;
    let grace;
    const connected = () => { live = 'live'; lost = false; clearTimeout(grace); grace = undefined; };
    connect = () => {
      clearTimeout(retry);
      es?.close();
      es = new EventSource('/api/stream');
      es.onopen = connected;
      es.onmessage = (e) => { receive(JSON.parse(e.data)); connected(); };
      es.onerror = () => {
        live = 'reconnecting';
        es.close();
        grace ??= setTimeout(() => (lost = true), 8000);
        retry = setTimeout(connect, 4000);
      };
    };
    connect();
    const tick = setInterval(() => (now = Date.now()), 15_000);
    const vis = () => { if (document.visibilityState === 'visible') { now = Date.now(); if (live !== 'live') connect(); } };
    const net = () => { offline = !navigator.onLine; if (!offline && live !== 'live') connect(); };
    document.addEventListener('visibilitychange', vis);
    addEventListener('online', net);
    addEventListener('offline', net);
    net();
    now = Date.now(); // the server rendered the date in its own timezone
    const spy = watchSections();
    return () => {
      es?.close(); clearInterval(tick); clearTimeout(retry); clearTimeout(grace); clearTimeout(unflash); spy.disconnect();
      document.removeEventListener('visibilitychange', vis); removeEventListener('online', net); removeEventListener('offline', net);
    };
  });

  // the alert count on the tab title and, for the installed app, on its icon
  $effect(() => {
    const n = snap?.needCount ?? 0;
    document.title = n ? `(${n}) ${snap?.title}` : (snap?.title ?? document.title);
    const nav = /** @type {Navigator & { setAppBadge?: (n?: number) => Promise<void>, clearAppBadge?: () => Promise<void> }} */ (navigator);
    (n ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
  });

  // tab bar highlight: the last section whose top has passed a line at 30% of the viewport
  function watchSections() {
    const ids = ['attention', 'host', 'services'];
    const spy = new IntersectionObserver(() => {
      const line = innerHeight * 0.3;
      let best = 'top', bestTop = -Infinity;
      for (const id of ids) {
        const r = document.getElementById(id)?.getBoundingClientRect();
        if (r?.height && r.top <= line && r.top > bestTop) { best = id; bestTop = r.top; }
      }
      section = best;
    }, { rootMargin: '-30% 0px -69% 0px' });
    for (const id of ['top', ...ids]) { const el = document.getElementById(id); if (el) spy.observe(el); }
    return spy;
  }
  /** @returns {'location' | undefined} */
  const current = (id) => (section === id ? 'location' : undefined);

  function onKey(e) {
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
      e.preventDefault();
      paletteOpen = true;
    }
  }

  function opened(id) {
    try {
      fetch('/api/open', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    } catch {}
  }

  function ago(ts) {
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 60) return 'now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h${h < 10 && m % 60 ? ' ' + String(m % 60).padStart(2, '0') + ' m' : ''}`;
    return `${Math.floor(h / 24)} d`;
  }
  const pctTxt = (v, d = 2) => (v == null ? '—' : v >= 99.995 ? '100%' : v.toFixed(d) + '%');
  const ICONS = {
    crit: 'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    warn: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    info: 'M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    ok: 'M20 6 9 17l-5-5'
  };
  const fmtRate = (v) => (v == null ? '—' : v >= 100 ? Math.round(v) : v.toFixed(1));
  const fmtNum = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
</script>

{#snippet traffic(t, what, downWord, upWord, height)}
  <!-- one traffic reading: where it comes from, the current rates, then the recent chart -->
  {@const down = (t.seriesDown ?? []).filter((v) => v != null)}
  <div class="traffic">
    <div class="net-row">
      <span class="net-src"><span class="net-what">{what}</span><span class="muted">{t.source}{down.length > 1 ? ` · ${t.spanH ?? 24} h` : ''}</span></span>
      <span class="net-vals mono"><span style:color="var(--acc)">{fmtRate(t.down)}</span> <span class="muted">{downWord}</span> <span style:color="var(--acc-2)">{fmtRate(t.up)}</span> <span class="muted">{upWord} Mbit/s</span></span>
    </div>
    <!-- a fresh metric has fewer than two points: no chart, so no blank space either -->
    {#if down.length > 1}
      <div class="netchart" style:height="{height}px">
        <div class="layer"><Sparkline values={t.seriesDown} color="var(--acc)" area {height} min={0} label="{what} {downWord}, last {t.spanH ?? 24} hours" /></div>
        <div class="layer"><Sparkline values={t.seriesUp} color="var(--acc-2)" {height} min={0} max={Math.max(1, ...down) * 1.1} /></div>
      </div>
    {/if}
  </div>
{/snippet}

<svelte:window onkeydown={onKey} />

{#if !snap}
  <main class="boot"><p class="muted">Starting up…</p></main>
{:else}
  <div class="page" id="top">
    <header class="top">
      <a class="brand" href="/" aria-label="{snap.title} — home">
        {#if snap.logo}<img src={snap.logo} alt="" width="34" height="34" />{/if}
        <span class="btxt"><span class="date muted only-phone">{today}</span><span class="bname">{snap.title}</span></span>
      </a>
      <button class="search card" onclick={() => (paletteOpen = true)} aria-label="Search or jump to a service" aria-keyshortcuts="/ Control+K Meta+K">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span class="ph">Search or jump to…</span>
        <kbd class="mono">/</kbd>
      </button>
      <div class="right">
        <span class="live" class:warn={stale || live === 'reconnecting'} role="status">
          <span class="pulse"></span>
          <!-- phones: one short word, so the title keeps its room; the banner below says the rest -->
          {#if live === 'reconnecting'}<span class="only-desktop">Reconnecting…</span><span class="only-phone">Retrying</span>{:else if stale}<span class="only-desktop">Data {ago(snap.generatedAt)} old</span><span class="only-phone">Stale</span>{:else}Live{/if}
          {#if snap.demo}<span class="demo">demo</span>{/if}
        </span>
        <ThemeToggle />
        {#if snap.deepLink?.href}
          <a class="deep lift" href={snap.deepLink.href} target={target} rel="noopener">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
            {snap.deepLink.name ?? 'Monitoring'}
          </a>
        {/if}
      </div>
    </header>

    {#if degraded}
      {@const age = ago(snap.generatedAt)}
      <div class="banner" role="alert">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS.crit} /></svg>
        <span class="txt">
          <span class="t">{offline ? 'You’re offline' : lost ? 'Can’t reach the dashboard' : 'Updates have stopped'}</span>
          <span class="d">Showing the last known state, {age === 'now' ? 'just now' : age + ' old'}.</span>
        </span>
        {#if !offline}<button onclick={() => connect()}>Retry</button>{/if}
      </div>
    {/if}

    <section class="hero" aria-label="Overall status">
      <div class="card verdict lv-{degraded ? 'none' : snap.verdict.level}" class:flash={flash.has('verdict')}>
        <div class="tag"><span class="halo"></span>{degraded ? 'Last known state' : snap.verdict.tag}</div>
        <h1>{snap.verdict.title}</h1>
        <p class="muted">{snap.verdict.sub}</p>
        {#if snap.facts?.length}
          <div class="facts">
            {#each snap.facts as f}
              {@const [n, of] = f.v.split(' / ')}
              <div class="fact lv-{f.level ?? 'none'}"><span class="mono v" class:hl={f.level === 'warn' || f.level === 'crit'}>{n}{#if of}<span class="of">/{of}</span>{/if}</span><span class="muted k">{f.k}</span></div>
            {/each}
          </div>
        {/if}
        <div class="fleet">
          <div class="fleet-head"><span class="muted" class:picked={fleetPick} aria-live="polite">{fleetPick ?? 'Last 24 h'}</span><span><span class="mono pct">{pctTxt(snap.fleetAvail)}</span> <span class="muted">uptime</span></span></div>
          <Beats beats={snap.fleet} end={snap.generatedAt} label="Availability of all services over the last 24 hours" onpick={(t) => (fleetPick = t)} />
          <div class="fleet-head muted mono small"><span>−24 h</span><span>−12 h</span><span>now</span></div>
        </div>
      </div>

      <div class="card feed" id="attention">
        <div class="feed-head">
          <h2>{snap.needCount ? 'Needs attention' : 'Recent activity'}</h2>
          <span class="muted small">{snap.needCount ? 'most severe first' : 'last 24 h'}</span>
        </div>
        {#each feed.slice(0, 5) as a}
          <svelte:element this={a.href ? 'a' : 'div'} class="item only-desktop lv-{a.sev}" class:lift={!!a.href} href={a.href} target={a.href ? target : undefined} rel={a.href ? 'noopener' : undefined}>
            <span class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS[a.sev] ?? ICONS.info} /></svg></span>
            <span class="txt"><span class="t">{a.title}</span>{#if a.detail}<span class="d muted">{a.detail}</span>{/if}</span>
            <span class="mono muted small when">{ago(a.ts)}</span>
          </svelte:element>
        {:else}
          <p class="muted empty">No changes in the last 24 hours.</p>
        {/each}
        {#if feed.length > 5}<p class="muted small more only-desktop">+ {feed.length - 5} more</p>{/if}
        {#if feed.length}
          <div class="rows only-phone" id="feed-rows">
            {#each feedOpen ? feed : feed.slice(0, 3) as a}
              <svelte:element this={a.href ? 'a' : 'div'} class="row lv-{a.sev}" class:lift={!!a.href} class:flash={!!a.sid && flash.has(a.sid)} href={a.href} target={a.href ? target : undefined} rel={a.href ? 'noopener' : undefined}>
                <span class="dot lv-{a.sev}"></span>
                <span class="txt"><span class="t">{a.title}</span>{#if a.detail}<span class="d muted">{a.detail}</span>{/if}</span>
                {#if a.href}<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>{/if}
              </svelte:element>
            {/each}
          </div>
          {#if feed.length > 3}
            <button class="see-all only-phone" aria-expanded={feedOpen} aria-controls="feed-rows" onclick={() => (feedOpen = !feedOpen)}>{feedOpen ? 'Show less' : `See all (${feed.length})`}</button>
          {/if}
        {/if}
      </div>
    </section>

    {#if snap.host || snap.storage.length || snap.network}
      <section class="vitals" id="host" aria-label="Host vitals">
        {#if snap.host}
          <div class="card host">
            <div class="row-head">
              <div class="title">
                <h2>{#if snap.host.href}<a href={snap.host.href} target={target} rel="noopener">{snap.host.name}</a>{:else}{snap.host.name}{/if}</h2>
                <span class="muted small">{snap.host.detail}</span>
              </div>
            </div>
            <div class="gauges">
              {#each snap.host.gauges as g (g.key)}<Gauge {g} />{/each}
            </div>
          </div>
        {/if}
        {#if snap.storage.length}
          <div class="card storage">
            {#if snap.drives.length}
              <div class="tabs" role="tablist" aria-label="Storage card">
                {#each [['storage', 'Storage'], ['drives', 'Drives']] as [id, name]}
                  <button role="tab" id="tab-{id}" aria-selected={storageView === id} aria-controls="storage-panel" tabindex={storageView === id ? 0 : -1} onclick={() => showStorage(id)} onkeydown={tabKey}>{name}</button>
                {/each}
              </div>
            {:else}
              <h2>Storage</h2>
            {/if}
            <div class="panel" id="storage-panel" role={snap.drives.length ? 'tabpanel' : undefined} aria-labelledby={snap.drives.length ? `tab-${storageView}` : undefined}>
            {#if storageView === 'drives' && snap.drives.length}
              {#each snap.drives as d}
                <!-- a drive in two lines: model, temperature and SMART verdict; what it is and where, and its life left as a labelled bar. The rest is in the tooltip -->
                <div class="bar drive lv-{d.lifeLevel}" title="{d.name} · {d.meta} · {d.detail}">
                  <div class="bar-head">
                    <span class="name">{d.name}</span>
                    {#each d.facts as f}<span class="dfact mono" class:lv-warn={f.level === 'warn'}>{f.v}{f.k ? ` ${f.k}` : ''}</span>{/each}
                    <span class="dstatus lv-{d.level}">{d.status}</span>
                  </div>
                  <div class="dline">
                    <span class="mono muted off-sub">{d.meta}</span>
                    {#if d.life != null}
                      <span class="life" title="Life left: {d.life}% of the drive's rated write endurance"><span class="muted">life</span><span class="track"><span class="fill" style:width="{Math.max(0, Math.min(100, d.life))}%"></span></span><span class="mono pct">{d.life}%</span></span>
                    {/if}
                  </div>
                </div>
              {/each}
            {:else}
            {#each snap.storage as s}
              <!-- an off row (unavailable, detached) is grey: its reason in the sub column, the bar at the last known fill -->
              <div class="bar lv-{s.level}" title="{s.name} · {s.sub}">
                <div class="bar-head"><span class="name">{s.name}</span><span class="mono muted sub">{s.sub}</span><span class="mono pct">{s.pct != null ? `${Math.round(s.pct)}%` : '—'}</span></div>
                <div class="track"><div class="fill" style:width="{Math.min(100, s.pct ?? 0)}%"></div></div>
              </div>
            {/each}
            {/if}
            </div>
          </div>
        {/if}
        {#if snap.network}
          <div class="card network">
            <h2>Network</h2>
            {#if snap.network.source}{@render traffic(snap.network, 'WAN', 'down', 'up', 48)}{/if}
            {#if snap.network.lan}{@render traffic(snap.network.lan, 'LAN', 'in', 'out', 32)}{/if}
            {#if snap.network.dns}
              <a class="net-row dns" href={snap.network.dns.href} target={target} rel="noopener">
                <span class="net-src"><span class="net-what">DNS</span><span class="muted">{snap.network.dns.name}{snap.network.dns.period ? ` · ${snap.network.dns.period}` : ''}</span></span>
                <span class="net-vals mono">{fmtNum(snap.network.dns.queries)} <span class="muted">queries</span> {snap.network.dns.blockedPct.toFixed(1)}% <span class="muted">blocked</span></span>
              </a>
            {/if}
          </div>
        {/if}
      </section>
    {/if}

    {#if snap.mostUsed.length}
      <section class="block" aria-label="Most used services">
        <div class="sec-head"><h2>Most used</h2></div>
        <div class="pins">
          {#each snap.mostUsed as t (t.id)}
            <a class="card pin lift lv-{t.level}" class:flash={flash.has(t.id)} class:alert={t.level === 'crit' || t.level === 'warn'} href={t.href} target={target} rel="noopener" onclick={() => opened(t.id)} aria-label="{t.name}, {t.status}{t.lineLevel ? ', ' + t.line : ''}">
              <div class="pin-top">
                <span class="ic big"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={30} /></span>
                <span class="dot lv-{t.level}" title={t.status}></span>
              </div>
              <div class="pin-name"><span class="n">{t.name}</span><span class="mono muted hostname">{t.host}</span><span class="pline only-phone" class:hl={isProblem(t.level)}>{t.line}</span></div>
              {#if t.stats.length}
                <div class="pin-stats">
                  {#each t.stats.slice(0, 2) as s}
                    <div class="lv-{s.level ?? 'none'}"><span class="mono v" class:hl={s.level === 'warn' || s.level === 'crit'}>{s.v}</span><span class="muted k">{s.k}</span></div>
                  {/each}
                </div>
              {:else}
                <div class="pin-stats"><div><span class="mono v">{pctTxt(t.uptime24, 1)}</span><span class="muted k">uptime 24 h</span></div><div><span class="mono v">{t.p95 == null ? '—' : Math.round(t.p95) + ' ms'}</span><span class="muted k">p95</span></div></div>
              {/if}
            </a>
          {/each}
        </div>
      </section>
    {/if}

    <div id="services">
      {#each snap.groups as g (g.name)}
        <section class="block only-desktop" aria-label={g.name}>
          <div class="sec-head"><h2>{g.name}</h2><span class="mono muted small">{g.summary}</span></div>
          <div class="tiles">
            {#each g.services as t (t.id)}
              {@const up = uptimeTxt(t)}
              <a class="tile lift lv-{t.level}" class:flash={flash.has(t.id)} class:alert={t.level === 'crit' || t.level === 'warn'} href={t.href} target={target} rel="noopener" onclick={() => opened(t.id)} aria-label="{t.name}, {t.status}{t.lineLevel ? ', ' + t.line : ''}{up ? ', ' + up : ''}">
                <span class="ic"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={24} /></span>
                <span class="txt">
                  <span class="n">{t.name}</span>
                  <span class="l" class:hl={t.lineLevel === 'crit' || t.lineLevel === 'warn'} title={t.line}>{t.line}</span>
                </span>
                <span class="dot lv-{t.level}" title={t.status}></span>
                <!-- the strip with its exact uptime as text; the tile's label already says both -->
                {#if t.beats}
                  <span class="beats" aria-hidden="true"><Beats beats={t.beats} end={snap.generatedAt} label="" /><span class="mono">{pctTxt(t.uptime24)}</span></span>
                {/if}
              </a>
            {/each}
          </div>
        </section>
      {/each}
      <section class="block only-phone" aria-label="All services">
        <div class="sec-head"><h2>All services</h2><span class="muted small">{serviceList.length}{isProblem(serviceList[0]?.t.level) ? ' · problems first' : ''}</span></div>
        <div class="card list">
          {#each serviceList as { t, group } (group + '/' + t.id)}
            {@const up = uptimeTxt(t)}
            {@const word = statusWord(t)}
            <a class="srow lv-{t.level}" class:flash={flash.has(t.id)} href={t.href} target={target} rel="noopener" onclick={() => opened(t.id)} aria-label="{t.name}, {t.status}, {t.line}, {group}{up ? ', ' + up : ''}">
              <span class="ic"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={22} /></span>
              <span class="txt">
                <span class="n">{t.name}</span>
                <span class="l" class:hl={isProblem(t.level)}>{#if word}<b>{word}</b>{' · '}{/if}{t.line}<span class="grp">{` · ${group}`}</span></span>
                <!-- the strip with its exact uptime as text, as on tiles; the row's label already says both -->
                {#if t.beats}
                  <span class="beats" aria-hidden="true"><Beats beats={t.beats} end={snap.generatedAt} label="" /><span class="mono">{pctTxt(t.uptime24)}</span></span>
                {/if}
              </span>
              <span class="dot lv-{t.level}" title={t.status}></span>
            </a>
          {/each}
        </div>
      </section>
    </div>

    {#if snap.bookmarks.length}
      <footer class="links" aria-label="Links">
        {#each snap.bookmarks as b}
          <a class="card link lift" href={b.href} target={target} rel="noopener"><Icon src={b.icon} dark={b.iconDark} name={b.name} size={18} />{b.name}</a>
        {/each}
      </footer>
    {/if}
  </div>

  <nav class="tabbar" aria-label="Sections">
    <a href="#top" aria-current={current('top')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>Home</a>
    <a href="#attention" class="bell" aria-current={current('attention')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>Alerts{#if snap.needCount}<span class="badge mono">{snap.needCount}</span>{/if}</a>
    {#if snap.host || snap.storage.length || snap.network}<a href="#host" aria-current={current('host')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01" /></svg>Host</a>{/if}
    <a href="#services" aria-current={current('services')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>Services</a>
    <button onclick={() => (paletteOpen = true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5" /></svg>Search</button>
  </nav>

  <Palette bind:open={paletteOpen} services={allServices} bookmarks={snap.bookmarks} mostUsed={snap.mostUsed} {target} onopen={opened} />
{/if}

<style>
  .boot { min-height: 100vh; display: grid; place-items: center; }
  .page { max-width: 1320px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 28px; }
  .small { font-size: 12px; }
  h2 { font-size: 14px; font-weight: 600; }

  /* header */
  .top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
  .brand img { width: 34px; height: 34px; border-radius: 10px; }
  .btxt { display: contents; }
  .search {
    flex: 1 1 280px; max-width: 560px; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px 0 14px;
    border: 1px solid var(--line); border-radius: 12px; color: var(--muted); cursor: pointer; text-align: left;
  }
  .search:hover { color: var(--text); }
  .search .ph { flex: 1; }
  kbd { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--surface-2); }
  .right { display: flex; align-items: center; gap: 10px; margin-left: auto; }
  .live { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); white-space: nowrap; }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px var(--ok-soft); animation: breathe 3s ease-in-out infinite; }
  .live.warn .pulse { background: var(--warn); box-shadow: 0 0 0 4px var(--warn-soft); }
  .demo { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 5px; background: var(--surface-3); color: var(--text); }
  .deep { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; padding: 0 14px; min-height: 40px; border-radius: 10px; background: var(--surface-2); }
  @keyframes breathe { 50% { box-shadow: 0 0 0 7px transparent; } }

  /* hero */
  .hero { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 16px; }
  .verdict {
    padding: 28px; display: flex; flex-direction: column; gap: 16px; container: verdict / inline-size;
    background: radial-gradient(120% 90% at 0% 0%, var(--lv-soft), transparent 55%), var(--surface);
  }
  .tag { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lv); }
  .halo { width: 10px; height: 10px; border-radius: 50%; background: var(--lv); box-shadow: 0 0 0 5px var(--lv-soft); }
  .verdict h1 { font-size: clamp(28px, 4vw, 40px); line-height: 1.05; font-weight: 600; letter-spacing: -0.03em; text-wrap: balance; }
  .verdict p { margin: 0; font-size: 15px; }
  /* stats: no boxes, hairline dividers between them */
  .facts { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); row-gap: 14px; margin-top: 4px; padding: 14px 0; border-block: 1px solid var(--line); }
  .fact { display: flex; flex-direction: column; gap: 4px; padding: 0 16px; min-width: 0; }
  .fact:first-child { padding-left: 0; }
  .fact + .fact { border-left: 1px solid var(--line); }
  /* a narrow card: two by two, each row starting flush left */
  @container verdict (max-width: 500px) {
    .facts { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .fact:nth-child(odd) { padding-left: 0; border-left: 0; }
  }
  .fact .v { font-size: 22px; font-weight: 500; letter-spacing: -0.02em; white-space: nowrap; }
  .fact .v.hl { color: var(--lv); }
  .fact .of { color: var(--muted); font-size: 0.7em; margin-left: 2px; }
  .fact .k { font-size: 12px; line-height: 1.3; }
  .fleet { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
  .fleet-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; }
  .fleet-head.small { font-size: 11px; }
  .pct { font-size: 14px; font-weight: 500; }
  /* one continuous rounded ribbon; problems rise above it, set apart by a hairline */

  .feed { padding: 22px; display: flex; flex-direction: column; gap: 8px; }
  .feed-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .item { display: flex; align-items: center; gap: 14px; padding: 11px 14px; border-radius: 14px; background: var(--surface-2); min-height: 56px; }
  .ico { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--lv-soft); color: var(--lv); flex: 0 0 auto; }
  .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .item .t { font-size: 14px; font-weight: 500; }
  .item .d { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .when { flex: 0 0 auto; }
  .empty { margin: auto 0; text-align: center; }
  .more { margin: 2px 0 0; text-align: right; }

  /* vitals */
  .vitals { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
  .host, .storage, .network { padding: 22px; display: flex; flex-direction: column; gap: 16px; }
  .row-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
  .row-head .title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .gauges { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .storage, .panel { gap: 12px; }
  .panel { display: flex; flex-direction: column; }
  .bar { --fill: var(--acc); display: flex; flex-direction: column; gap: 5px; }
  .bar.lv-warn, .bar.lv-crit { --fill: var(--lv); }
  .bar-head { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
  .bar-head .name { flex: 0 1 auto; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-head .sub { flex: 1 1 auto; min-width: 0; text-align: right; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-head .pct { flex: none; }
  .bar.lv-warn .pct, .bar.lv-crit .pct { color: var(--lv); }
  .bar.lv-off { --fill: color-mix(in srgb, var(--muted) 50%, transparent); }
  .bar.lv-off .name, .bar.lv-off .pct { color: var(--muted); }
  .off-sub { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .drive { gap: 4px; }
  .drive + .drive { padding-top: 10px; border-top: 1px solid var(--track); }
  .drive .name { flex: 1 1 auto; max-width: none; }
  .dstatus { flex: none; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; color: var(--lv); background: var(--lv-soft); }
  .dfact { flex: none; font-size: 11px; color: var(--muted); white-space: nowrap; }
  .dfact.lv-warn { color: var(--lv); }
  .dline { display: flex; align-items: center; gap: 12px; }
  .dline .off-sub { flex: 1 1 auto; min-width: 0; }
  .life { flex: none; display: flex; align-items: center; gap: 6px; font-size: 11px; }
  .life .track { display: block; width: 56px; height: 4px; }
  .life .fill { display: block; }
  .tabs { display: flex; gap: 16px; }
  .tabs button { all: unset; cursor: pointer; font-size: 14px; font-weight: 600; color: var(--muted); }
  .tabs button[aria-selected='true'] { color: var(--text); }
  .tabs button:focus-visible { outline: 2px solid var(--acc); outline-offset: 3px; border-radius: 4px; }
  .track { height: 6px; border-radius: 4px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; border-radius: 4px; background: var(--fill); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .traffic { display: flex; flex-direction: column; gap: 8px; }
  /* WAN, LAN and DNS separated by a rule; spare height (a taller card sets the row) stays below them */
  .traffic + .traffic, .traffic + .dns { padding-top: 14px; border-top: 1px solid var(--track); }
  /* always two lines (where it comes from, then the values): one line only fits the shorter sources, so blocks would differ */
  .net-row { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
  .net-src { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .net-what { font-weight: 600; }
  .net-vals { white-space: nowrap; }
  .net-vals > :not(.muted) { font-size: 15px; font-weight: 500; }
  .netchart { position: relative; }
  .layer { position: absolute; inset: 0; }
  .dns { color: inherit; text-decoration: none; }

  /* most used */
  .block { display: flex; flex-direction: column; gap: 12px; }
  #services { display: flex; flex-direction: column; gap: 28px; }
  .sec-head { display: flex; align-items: baseline; gap: 10px; }
  .pins { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .pin { display: flex; flex-direction: column; gap: 16px; padding: 18px; border-radius: 18px; }
  .pin.alert { background: var(--lv-soft); box-shadow: inset 0 0 0 1px var(--lv); }
  .pin-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .ic { width: 40px; height: 40px; border-radius: 12px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .ic.big { width: 48px; height: 48px; border-radius: 14px; }
  .pin.alert .ic { background: var(--surface); }
  .pin-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .pin-name .n { font-size: 15px; font-weight: 600; }
  .hostname { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pin-stats { display: flex; gap: 16px; }
  .pin-stats > div { display: flex; flex-direction: column; min-width: 0; }
  .pin-stats .v { font-size: 14px; font-weight: 500; white-space: nowrap; }
  .pin-stats .v.hl { color: var(--lv); }
  .pin-stats .k { font-size: 11px; white-space: nowrap; }

  /* tiles */
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
  .tile { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px 12px; padding: 12px 14px; border-radius: 14px; background: var(--surface); box-shadow: var(--shadow); min-height: 66px; }
  .tile.alert { background: var(--lv-soft); box-shadow: inset 0 0 0 1px var(--lv); }
  .tile.alert .ic { background: var(--surface); }
  .tile .n { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* the status line may take two lines: it often joins several facts ("Pool 71% · SMART 1 / 1 ok") */
  .tile .l, .srow .l { font-size: 12px; line-height: 1.35; color: var(--muted); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .tile .l.hl { color: var(--lv); }
  /* a service's 24 h strip and its exact uptime (tiles, and the phone list) */
  .beats { display: flex; align-items: center; gap: 8px; --beats-h: 10px; }
  .beats > :global(.strip) { flex: 1; }
  .beats .mono { flex: none; min-width: 6.5ch; text-align: right; font-size: 11px; color: var(--muted); }
  .tile .beats { grid-column: 1 / -1; }

  /* links */
  .links { display: flex; flex-wrap: wrap; gap: 8px; }
  .link { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px 0 10px; border-radius: 10px; font-size: 13px; }

  /* bottom tab bar (phones) */
  .tabbar { display: none; }

  @media (max-width: 1180px) {
    .vitals { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .vitals .host { grid-column: 1 / -1; }
  }
  @media (max-width: 860px) {
    .hero, .vitals { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    /* the tab bar floats over the bottom: clear it plus the home indicator */
    .page { gap: 22px; padding-bottom: calc(110px + env(safe-area-inset-bottom)); }
    h2, .tabs button { font-size: 17px; }
    .search, .deep, .live :global(.demo) { display: none; }

    /* header: logo, date over title, Live pill, theme button */
    .top { flex-wrap: nowrap; gap: 12px; }
    .brand { flex: 1 1 auto; min-width: 0; }
    .brand img { width: 40px; height: 40px; border-radius: 12px; }
    .btxt { display: flex; flex-direction: column; min-width: 0; }
    .date { font-size: 13px; font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bname { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .right { flex: none; gap: 8px; }
    .live { min-height: 28px; padding: 0 10px; border-radius: 14px; background: var(--surface); box-shadow: var(--shadow); gap: 7px; }
    .pulse { width: 7px; height: 7px; box-shadow: 0 0 0 3px var(--ok-soft); }
    .live.warn .pulse { box-shadow: 0 0 0 3px var(--warn-soft); }

    /* verdict */
    .verdict { padding: 20px; border-radius: 22px; gap: 12px; }
    .verdict h1 { font-size: 26px; line-height: 1.12; }
    .verdict p { font-size: 13px; }
    /* stats: the same hairline 2×2 as a narrow desktop card, just tighter */
    .facts { margin-top: 0; padding: 12px 0; row-gap: 12px; }
    .fact { padding: 0 12px; gap: 2px; }
    .fact .v { font-size: 19px; }
    .fact .k { font-size: 11.5px; }
    .fleet { margin-top: 4px; --beats-h: 16px; }
    .fleet-head .picked { color: var(--text); font-variant-numeric: tabular-nums; }

    /* sections lose their card: heading outside, rows/cards below */
    .feed, .host { padding: 0; background: none; box-shadow: none; border-radius: 0; }
    .feed { gap: 10px; }
    .feed-head { margin-bottom: 0; }
    .host { gap: 12px; }
    .rows { display: flex; flex-direction: column; gap: 8px; }
    .row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 10px 14px 10px 16px; border-radius: 16px; background: var(--surface); box-shadow: var(--shadow); }
    .row .dot { scale: 1.25; }
    /* status text on phones: previews (feed rows, pins) wrap to two lines; the services list shows it whole */
    .row .t, .row .d, .pline { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
    .row .t { font-size: 15px; font-weight: 500; line-height: 1.3; }
    .row .d { font-size: 12px; line-height: 1.35; }
    .chev { flex: none; color: var(--muted); }
    .see-all { align-self: center; min-height: 44px; padding: 0 16px; border: 0; border-radius: 12px; background: none; color: var(--acc); font-size: 14px; font-weight: 500; cursor: pointer; }
    .see-all:active { background: var(--surface-2); }

    .gauges { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }

    /* host, storage and network stay together as one section */
    .vitals { gap: 12px; }
    .storage, .network { padding: 20px; }
    .netchart { display: none; }

    /* most used: icon, name, one status line */
    .pins { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .pin { padding: 14px; gap: 12px; }
    .ic.big { width: 44px; height: 44px; border-radius: 13px; }
    .hostname, .pin-stats { display: none; }
    .pline { font-size: 13px; line-height: 1.35; color: var(--muted); }
    .srow .l b { font-weight: 600; }
    /* problem text sits on the tinted card: lean toward --text so it keeps 4.5:1 */
    .pline.hl { color: color-mix(in srgb, var(--lv) 80%, var(--text)); }

    /* all services: one inset grouped list */
    .list { border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; }
    .srow { position: relative; display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 10px 16px 10px 12px; }
    .srow + .srow::before { content: ''; position: absolute; top: 0; left: 62px; right: 0; border-top: 1px solid var(--line); }
    .srow:first-child { border-radius: 18px 18px 0 0; }
    .srow:last-child { border-radius: 0 0 18px 18px; }
    .srow:only-child { border-radius: 18px; }
    .srow:active { background: var(--surface-2); }
    /* the list clips (overflow: hidden), so a changed row is ringed inside its own edges, over the divider */
    .srow.flash { animation-name: flash-in; }
    .srow:focus-visible { outline-offset: -2px; border-radius: 0; }
    .srow .ic { width: 38px; height: 38px; border-radius: 11px; }
    .srow .n { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .srow .l { display: block; -webkit-line-clamp: none; line-clamp: none; }
    .srow .l.hl { color: var(--lv); }
    .srow .beats { margin-top: 5px; --beats-h: 8px; }
    .grp { color: var(--muted); }
    .tabbar {
      position: fixed; left: 12px; right: 12px; bottom: max(14px, env(safe-area-inset-bottom)); z-index: 40;
      display: flex; justify-content: space-around; padding: 6px; border-radius: 24px;
      background: var(--glass); backdrop-filter: saturate(1.6) blur(20px); -webkit-backdrop-filter: saturate(1.6) blur(20px);
      border: 1px solid var(--line); box-shadow: var(--shadow-lg);
    }
    .tabbar a, .tabbar button {
      touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
      position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
      min-width: 56px; min-height: 52px; border: 0; border-radius: 18px; background: transparent; color: var(--muted);
      font-size: 10px; font-weight: 500; cursor: pointer;
    }
    .tabbar a:active, .tabbar button:active, .tabbar [aria-current] { background: var(--surface-2); color: var(--text); }
    .tabbar svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
    /* a count from old data must not look live */
    .page:has(.banner) + .tabbar .badge { background: var(--muted); color: var(--surface); }
    .badge { position: absolute; top: 4px; right: 10px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--crit); color: #fff; font-size: 10px; display: flex; align-items: center; justify-content: center; }
  }
  :global(html) { scroll-padding-top: 12px; }
  @media (prefers-reduced-motion: no-preference) { :global(html) { scroll-behavior: smooth; } }

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
  .page:has(.banner) :is(.hero, .vitals, .block) { filter: grayscale(0.7); opacity: 0.8; transition: filter 0.3s, opacity 0.3s; }
  @media (max-width: 760px) {
    .banner { padding-block: 8px; }
    .banner button { min-height: 44px; min-width: 64px; }
  }
  @keyframes drop { from { opacity: 0; transform: translateY(-6px); } }

  /* a status that just changed: one soft ring in its new colour */
  .flash { animation: flash 2.4s ease-out; }
  @keyframes flash { 0%, 30% { box-shadow: 0 0 0 3px var(--lv), var(--shadow); } }
  @keyframes flash-in { 0%, 30% { box-shadow: inset 0 0 0 2px var(--lv); } }
</style>
