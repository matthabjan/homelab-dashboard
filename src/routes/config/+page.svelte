<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { CheckKind, ConfigView, Level } from '$lib/types';
  import Icon from '$lib/components/Icon.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import type { PageProps } from './$types';
  import { ago } from '$lib/ago.ts';

  let { data }: PageProps = $props();
  const view = $derived(data.view);
  let now = $state(Date.now());
  let filter = $state<'all' | 'attention'>('all');

  // live: reload the page data when the stream reports an update, at most every 5 s
  onMount(() => {
    const es = new EventSource('/api/stream');
    let last = Date.now();
    let pending: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = () => {
      const wait = Math.max(0, last + 5000 - Date.now());
      pending ??= setTimeout(() => { pending = undefined; last = Date.now(); invalidateAll(); }, wait);
    };
    const tick = setInterval(() => (now = Date.now()), 15_000);
    return () => { es.close(); clearTimeout(pending); clearInterval(tick); };
  });

  function since(ts: number | null) {
    if (ts == null) return 'never';
    const a = ago(ts, now);
    return a === 'now' ? 'just now' : `${a} ago`;
  }

  type Service = ConfigView['services'][number];
  type Widget = ConfigView['widgets'][number];
  type Check = ConfigView['checks'][number];
  type AutoIcon = ConfigView['icons'][number];
  type Row = Service & { check: Check | null; widget: Widget | null; auto: AutoIcon | null; attention: boolean };

  const STATUS: Record<Widget['status'], [Level | 'none', string]> = { ok: ['ok', 'OK'], error: ['crit', 'Error'], never: ['none', 'Not run yet'], unsupported: ['warn', 'Not supported'] };
  const KIND: Record<CheckKind, string> = { http: 'HTTP', tcp: 'TCP', container: 'Container', heartbeat: 'Heartbeat' };
  const bad = (l: string) => l === 'warn' || l === 'crit';
  /** a check's own result; the tile's level (which an alert can raise) is the service column's */
  const checkLevel = (c: Check): Level | 'none' => (c.state === 'Down' ? 'crit' : c.state === 'Slow' ? 'warn' : c.state === 'Checking' ? 'none' : 'ok');

  // one row per service: its check, widget and automatic icon side by side
  const rows: Row[] = $derived.by(() => {
    const by = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
    const checks = by(view.checks), widgets = by(view.widgets), icons = by(view.icons);
    return view.services.map((s) => {
      const check = checks.get(s.id) ?? null, widget = widgets.get(s.id) ?? null;
      const attention = bad(s.level) || (check != null && bad(checkLevel(check))) || widget?.status === 'error' || widget?.status === 'unsupported';
      return { ...s, check, widget, auto: icons.get(s.id) ?? null, attention };
    });
  });
  const attentionCount = $derived(rows.filter((r) => r.attention).length);
  const groups = $derived.by(() => {
    const out = new Map<string, Row[]>();
    for (const r of rows) if (filter === 'all' || r.attention) out.set(r.group, [...(out.get(r.group) ?? []), r]);
    return [...out];
  });

  const checksUp = $derived(view.checks.filter((c) => c.state !== 'Down').length);
  const checksLevel = $derived(view.checks.some((c) => checkLevel(c) === 'crit') ? 'crit' : view.checks.some((c) => checkLevel(c) === 'warn') ? 'warn' : 'ok');
  const widgetsOk = $derived(view.widgets.filter((w) => w.status === 'ok').length);
  const widgetsLevel = $derived(view.widgets.some((w) => w.status === 'error') ? 'crit' : view.widgets.some((w) => w.status === 'unsupported') ? 'warn' : 'ok');
  const problemsLevel = $derived(view.problems.some((p) => p.level === 'crit') ? 'crit' : view.problems.length ? 'warn' : 'ok');
  const changed = $derived(view.settings.filter((s) => s.changed));

  // all settings by section: `intervals.probe` → intervals / probe; top-level keys are "general"
  const settingGroups = $derived.by(() => {
    const out = new Map<string, ConfigView['settings']>();
    for (const s of view.settings) {
      const [head, ...rest] = s.k.split('.');
      const g = rest.length ? head : 'general';
      out.set(g, [...(out.get(g) ?? []), { ...s, k: rest.length ? rest.join('.') : s.k }]);
    }
    return [...out];
  });
</script>

<svelte:head>
  <title>Config & status · {view.title}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="page">
  <header class="top">
    <a class="back lift" href="/">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
      Dashboard
    </a>
    <div class="ttl">
      <h1>Config & status</h1>
      <p class="muted">What {view.title} loaded, read-only. Credentials, tokens and URL paths are never shown.{#if view.demo} <span class="demo">demo</span>{/if}</p>
    </div>
    <div class="right"><ThemeToggle /></div>
  </header>

  <!-- the four answers first; each opens its section -->
  <nav class="summary" aria-label="Summary">
    <a class="stat card lift lv-{problemsLevel}" href="#problems" id={view.problems.length ? undefined : 'problems'}>
      <span class="k">Problems</span>
      <span class="v"><span class="dot lv-{problemsLevel}" aria-hidden="true"></span>{view.problems.length || 'None'}</span>
      <span class="s muted">{view.problems.length ? 'in your config files' : 'every file loaded, every secret set'}</span>
    </a>
    <a class="stat card lift lv-{checksLevel}" href="#services">
      <span class="k">Checks</span>
      <span class="v"><span class="dot lv-{checksLevel}" aria-hidden="true"></span>{checksUp} / {view.checks.length} up</span>
      <span class="s muted">HTTP, TCP, containers, heartbeats</span>
    </a>
    <a class="stat card lift lv-{widgetsLevel}" href="#services">
      <span class="k">Widgets</span>
      <span class="v"><span class="dot lv-{widgetsLevel}" aria-hidden="true"></span>{widgetsOk} / {view.widgets.length} OK</span>
      <span class="s muted">last poll of each API</span>
    </a>
    <a class="stat card lift" href="#settings">
      <span class="k">Settings</span>
      <span class="v">{changed.length} changed</span>
      <span class="s muted">of {view.settings.length}, the rest default</span>
    </a>
  </nav>

  {#if view.problems.length}
    <section class="card sec" id="problems" aria-labelledby="h-problems">
      <h2 id="h-problems">Problems <span class="count mono">{view.problems.length}</span></h2>
      <ul class="problems">
        {#each view.problems as p}
          <li class="lv-{p.level}">
            <span class="dot lv-{p.level}" aria-hidden="true"></span>
            <span><span class="sev">{p.level === 'crit' ? 'Error' : 'Warning'}</span> <span class="mono file">{p.file}</span> {p.message}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card sec" id="services" aria-labelledby="h-services">
    <div class="sec-head">
      <h2 id="h-services">Services <span class="count mono">{rows.length}</span></h2>
      <div class="seg" role="group" aria-label="Show">
        <button aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
        <button aria-pressed={filter === 'attention'} onclick={() => (filter = 'attention')} disabled={!attentionCount}>Needs attention <span class="mono">{attentionCount}</span></button>
      </div>
    </div>
    {#if view.icons.length}
      <p class="muted intro"><span class="auto">auto</span> icons were picked by name, image or widget type. To use another, set <code>icon</code> on the service in <code>services.yaml</code>.</p>
    {/if}

    {#if !rows.length}
      <p class="muted">No services in <code>services.yaml</code> yet.</p>
    {:else}
      <div class="cols" aria-hidden="true"><span>Service</span><span>Check</span><span>Widget</span></div>
      {#each groups as [group, list] (group)}
        <section class="group" aria-label={group}>
          <h3>{group}</h3>
          <ul class="rows">
            {#each list as r (r.id)}
              {@const cl = r.check ? checkLevel(r.check) : 'none'}
              {@const [wl, word] = r.widget ? STATUS[r.widget.status] : ['none', '']}
              <li class="row" class:attn={r.attention}>
                <div class="svc">
                  <span class="ic"><Icon src={r.icon ?? `/assets/monogram/${encodeURIComponent(r.name)}.svg`} dark={r.iconDark} name={r.name} size={22} /></span>
                  <span class="who">
                    <span class="n">{r.name}</span>
                    {#if r.auto}<span class="sub mono"><span class="auto">auto</span> {r.auto.icon}{#if r.auto.iconDark} · dark {r.auto.iconDark}{/if}</span>{/if}
                    {#if r.source !== 'services.yaml'}<span class="sub muted">{r.source}</span>{/if}
                    {#if r.reason}<span class="reason lv-{r.level}">{r.reason}</span>{/if}
                  </span>
                </div>
                <div class="cell">
                  <span class="lbl">Check</span>
                  {#if r.check}
                    <span class="state lv-{cl}"><span class="dot lv-{cl}" aria-hidden="true"></span>{r.check.state}</span>
                    <span class="sub mono line"><span>{KIND[r.check.kind]}</span><span class="sep lead">·</span><span class="addr">{r.check.target}</span><span class="sep">·</span><span>{r.check.interval}</span></span>
                  {:else}
                    <span class="muted none">No check</span>
                  {/if}
                </div>
                <div class="cell">
                  <span class="lbl">Widget</span>
                  {#if r.widget}
                    <span class="state lv-{wl}"><span class="dot lv-{wl}" aria-hidden="true"></span>{word}{#if r.widget.status === 'ok' || r.widget.status === 'error'}<span class="muted when"> · last success {since(r.widget.lastOk)}</span>{/if}</span>
                    <span class="sub mono line">
                      <span>{#if r.widget.docs}<a class="docs" href={r.widget.docs} target="_blank" rel="noopener">{r.widget.type}<span class="sr"> (documentation, opens in a new tab)</span></a>{:else}{r.widget.type}{/if}</span><span class="sep lead">·</span><span class="addr">{r.widget.origin ?? '—'}</span>{#if r.widget.options.length}<span class="sep">·</span><span>{r.widget.options.map((o) => `${o.k}: ${o.v}`).join(' · ')}</span>{/if}
                    </span>
                    {#if r.widget.error}<span class="sub err lv-crit">{r.widget.error}</span>{/if}
                  {:else}
                    <span class="muted none">No widget</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </section>

  <section class="card sec" id="settings" aria-labelledby="h-settings">
    <h2 id="h-settings">Settings</h2>
    {#if changed.length}
      <p class="muted intro">Changed in <code>settings.yaml</code>; everything else keeps its default.</p>
      <table class="kv changed">
        <thead class="sr"><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {#each changed as s (s.k)}<tr><th scope="row" class="mono">{s.k}</th><td class="mono">{s.v}</td></tr>{/each}
        </tbody>
      </table>
    {:else}
      <p class="muted intro">Every setting has its default value.</p>
    {/if}
    <details>
      <summary>All settings <span class="count mono">{view.settings.length}</span></summary>
      <p class="muted intro">The effective values: <code>settings.yaml</code> over the defaults. <span class="mark" aria-hidden="true"></span> changed.</p>
      <div class="kvs">
        {#each settingGroups as [group, list] (group)}
          <table class="kv">
            <caption class="mono">{group}</caption>
            <thead class="sr"><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead>
            <tbody>
              {#each list as s (s.k)}
                <tr class:is-changed={s.changed}><th scope="row" class="mono">{s.k}{#if s.changed}<span class="sr"> (changed)</span>{/if}</th><td class="mono">{s.v}</td></tr>
              {/each}
            </tbody>
          </table>
        {/each}
      </div>
    </details>
  </section>
</div>

<style>
  .page { max-width: 1200px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 16px; }
  .top { display: flex; align-items: center; gap: 16px 20px; flex-wrap: wrap; }
  .back { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px 0 10px; border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); font-size: 13px; font-weight: 500; }
  .ttl { flex: 1 1 320px; min-width: 0; }
  .ttl h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
  .ttl p { margin: 2px 0 0; font-size: 13px; }
  .right { margin-left: auto; }
  .demo { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 5px; background: var(--surface-3); color: var(--text); }

  /* summary: four answers */
  .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .stat { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-radius: 16px; min-width: 0; }
  .stat .k { font-size: 12px; color: var(--muted); }
  .stat .v { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .stat .s { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat.lv-warn, .stat.lv-crit { background: var(--lv-soft); box-shadow: inset 0 0 0 1px var(--lv); }

  .sec { padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; min-width: 0; scroll-margin-top: 16px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h2 { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  h3 { font-size: 12px; font-weight: 600; color: var(--muted); padding: 14px 0 6px; }
  .count { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 8px; background: var(--surface-2); color: var(--muted); }
  .intro { margin: -4px 0 0; font-size: 13px; }
  code { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; }
  .sub { display: block; font-size: 12px; overflow-wrap: anywhere; }
  .n { font-weight: 500; }

  .problems { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .problems li { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--lv-soft); }
  .problems .dot { position: relative; top: -1px; }
  .sev { font-weight: 600; color: var(--lv); }
  .file { font-size: 12px; }

  /* filter */
  .seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--surface-2); }
  .seg button { min-height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: var(--muted); font-size: 13px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .seg button[aria-pressed='true'] { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
  .seg button:disabled { cursor: default; opacity: 0.5; }
  .seg .mono { font-size: 11px; }

  /* services: one row per service, check and widget side by side */
  .cols, .row { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1.3fr) minmax(0, 1.55fr); gap: 16px; }
  .cols { font-size: 11px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); padding: 4px 0 0; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row { padding: 10px 0; border-top: 1px solid var(--line); align-items: start; }
  .svc { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
  .ic { width: 32px; height: 32px; border-radius: 9px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex: none; }
  .who, .cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
  .who .n { line-height: 32px; height: 32px; margin-bottom: -8px; }
  .lbl { display: none; }
  .state { display: inline-flex; align-items: baseline; gap: 7px; font-weight: 500; flex-wrap: wrap; }
  .state .dot { position: relative; top: -1px; }
  .when { font-weight: 400; font-size: 12px; }
  .cell { padding-top: 6px; }
  .none { font-size: 13px; }
  .reason { font-size: 12px; color: color-mix(in srgb, var(--lv) 80%, var(--text)); overflow-wrap: anywhere; }
  .err { color: color-mix(in srgb, var(--lv) 80%, var(--text)); }
  .auto { display: inline-block; font-family: 'Geist', system-ui, sans-serif; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 0 5px; border-radius: 4px; background: var(--surface-3); color: var(--text); }
  .sep { padding: 0 0.5ch; color: var(--muted); }
  .docs { color: var(--acc); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }

  /* settings */
  table { width: 100%; border-collapse: collapse; }
  .kv th, .kv td { text-align: left; vertical-align: top; padding: 6px 12px 6px 0; border-top: 1px solid var(--line); font-size: 12px; overflow-wrap: anywhere; }
  .kv th { width: 55%; color: var(--muted); font-weight: 400; }
  .kv.changed { max-width: 640px; }
  .kv.changed th { color: var(--text); }
  .kv caption { text-align: left; font-size: 12px; font-weight: 600; padding-bottom: 6px; }
  .kvs { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px 32px; align-items: start; margin-top: 12px; }
  .is-changed th { color: var(--text); }
  .is-changed th::before, .mark { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--acc); vertical-align: middle; }
  .mark { margin: 0 2px 0 4px; }
  details summary { cursor: pointer; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; min-height: 32px; }
  details[open] summary { margin-bottom: 4px; }

  @media (max-width: 960px) {
    .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  /* phones: each service a small card of labelled lines */
  @media (max-width: 760px) {
    .page { gap: 14px; }
    .top { gap: 12px; }
    .ttl { order: 3; flex-basis: 100%; }
    .ttl h1 { font-size: 22px; }
    .stat .s { white-space: normal; }
    /* the address on a line of its own, kind and interval (or type and options) under it */
    .line { display: flex; flex-wrap: wrap; }
    .line .addr { order: -1; flex-basis: 100%; }
    .line .lead { display: none; }
    .sec { padding: 16px; border-radius: 18px; }
    .stat { padding: 12px 14px; }
    .stat .v { font-size: 16px; }
    .cols { display: none; }
    .row { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 12px 0; }
    .cell { display: grid; grid-template-columns: 3.9em minmax(0, 1fr); column-gap: 6px; padding: 0 0 0 42px; }
    .cell > :not(.lbl) { grid-column: 2; }
    .lbl { display: block; grid-row: 1; font-size: 12px; color: var(--muted); }
    .cell > .lbl + * { grid-row: 1; }
    .seg { width: 100%; }
    .seg button { flex: 1; justify-content: center; min-height: 36px; }
  }
</style>
