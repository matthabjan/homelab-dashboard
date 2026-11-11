<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { CheckKind, ConfigView, Level } from '$lib/types';
  import Icon from '$lib/components/Icon.svelte';
  import AppHeader from '$lib/components/AppHeader.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import type { PageProps } from './$types';
  import { ago } from '$lib/ago.ts';

  // Setup answers "is my configuration right?": what loaded, how each service is set up, whether its widget can
  // connect. How the services are doing is the dashboard's job, not this page's.
  let { data }: PageProps = $props();
  const view = $derived(data.view);
  const shell = $derived(data.shell);
  let now = $state(Date.now());
  let filter = $state<'all' | 'fix'>('all');

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

  type Widget = ConfigView['widgets'][number];
  type Row = ConfigView['services'][number] & { check: ConfigView['checks'][number] | null; widget: Widget | null; auto: ConfigView['icons'][number] | null; fix: boolean };

  /** a widget's connection: whether its URL, credentials and permissions work */
  const CONN: Record<Widget['status'], [Level | 'none', string]> = { ok: ['ok', 'Connected'], error: ['crit', 'Failing'], never: ['none', 'Not polled yet'], unsupported: ['warn', 'Unknown type'] };
  const KIND: Record<CheckKind, string> = { http: 'HTTP', tcp: 'TCP', container: 'Container state', heartbeat: 'Heartbeat' };
  const broken = (w: Widget | null) => w?.status === 'error' || w?.status === 'unsupported';

  // one row per service: its check, widget and automatic icon side by side
  const rows: Row[] = $derived.by(() => {
    const by = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
    const checks = by(view.checks), widgets = by(view.widgets), icons = by(view.icons);
    return view.services.map((s) => {
      const widget = widgets.get(s.id) ?? null;
      return { ...s, check: checks.get(s.id) ?? null, widget, auto: icons.get(s.id) ?? null, fix: broken(widget) };
    });
  });
  const fixCount = $derived(rows.filter((r) => r.fix).length);
  const groups = $derived.by(() => {
    const out = new Map<string, Row[]>();
    for (const r of rows) if (filter === 'all' || r.fix) out.set(r.group, [...(out.get(r.group) ?? []), r]);
    return [...out];
  });

  const fromLabels = $derived(rows.filter((r) => r.source !== 'services.yaml').length);
  const connected = $derived(view.widgets.filter((w) => w.status === 'ok').length);
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
  <title>Setup · {view.title}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="page">
  <AppHeader title={view.title} logo={shell.logo} demo={view.demo} current="setup" deepLink={shell.deepLink} target={shell.linkTarget} configProblems={view.problems.length} />
  <div class="ttl">
    <h1>Setup</h1>
    <p class="muted">What {view.title} loaded from your config, read-only. Credentials, tokens and URL paths are never shown.</p>
  </div>

  <!-- is the config right? four answers, each opening its section -->
  <nav class="summary" aria-label="Summary">
    <a class="stat card lift lv-{problemsLevel}" href="#problems" id={view.problems.length ? undefined : 'problems'}>
      <span class="k">Config files</span>
      <span class="v"><span class="dot lv-{problemsLevel}" aria-hidden="true"></span>{view.problems.length ? `${view.problems.length} problem${view.problems.length === 1 ? '' : 's'}` : 'No problems'}</span>
      <span class="s muted">{view.problems.length ? 'listed below' : 'every file loaded, every secret set'}</span>
    </a>
    <a class="stat card lift" href="#services">
      <span class="k">Services</span>
      <span class="v">{rows.length}</span>
      <span class="s muted">{fromLabels ? `${rows.length - fromLabels} from services.yaml, ${fromLabels} from labels` : 'from services.yaml'}</span>
    </a>
    <a class="stat card lift lv-{widgetsLevel}" href="#services">
      <span class="k">Widgets</span>
      <span class="v"><span class="dot lv-{widgetsLevel}" aria-hidden="true"></span>{connected} / {view.widgets.length} connected</span>
      <span class="s muted">{fixCount ? `${fixCount} need${fixCount === 1 ? 's' : ''} a fix: see below` : 'URL, credentials and permissions work'}</span>
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
        <button aria-pressed={filter === 'fix'} onclick={() => (filter = 'fix')} disabled={!fixCount}>Needs a fix <span class="mono">{fixCount}</span></button>
      </div>
    </div>
    <p class="muted intro">How each service is set up; how it is doing is on the dashboard.{#if view.icons.length}{' '}<span class="auto">auto</span> icons were picked by name, image or widget type: to use another, set <code>icon</code> in <code>services.yaml</code>.{/if}</p>

    {#if !rows.length}
      <p class="muted">No services in <code>services.yaml</code> yet.</p>
    {:else}
      <div class="cols" aria-hidden="true"><span>Service</span><span>Check</span><span>Widget</span></div>
      {#each groups as [group, list] (group)}
        <section class="group" aria-label={group}>
          <h3>{group}</h3>
          <ul class="rows">
            {#each list as r (r.id)}
              {@const [wl, word] = r.widget ? CONN[r.widget.status] : ['none', '']}
              <li class="row">
                <div class="svc">
                  <span class="ic"><Icon src={r.icon ?? `/assets/monogram/${encodeURIComponent(r.name)}.svg`} dark={r.iconDark} name={r.name} size={22} /></span>
                  <span class="who">
                    <span class="n">{r.name}</span>
                    {#if r.auto}<span class="sub mono"><span class="auto">auto</span> {r.auto.icon}{#if r.auto.iconDark} · dark {r.auto.iconDark}{/if}</span>{/if}
                    {#if r.source !== 'services.yaml'}<span class="sub muted">{r.source}</span>{/if}
                  </span>
                </div>
                <div class="cell">
                  <span class="lbl">Check</span>
                  {#if r.check}
                    <span class="what">{KIND[r.check.kind]}<span class="sep">·</span><span class="muted">{r.check.interval}</span></span>
                    {#if r.check.kind !== 'container'}<span class="sub mono">{r.check.target}</span>{/if}
                  {:else}
                    <span class="muted none">No check</span>
                  {/if}
                </div>
                <div class="cell">
                  <span class="lbl">Widget</span>
                  {#if r.widget}
                    <span class="what"><span class="state"><span class="dot lv-{wl}" aria-hidden="true"></span>{word}</span>{#if r.widget.status === 'ok' || r.widget.status === 'error'}<span class="sep">·</span><span class="muted when">last success {since(r.widget.lastOk)}</span>{/if}</span>
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
    <div class="sec-head">
      <h2 id="h-settings">Settings</h2>
      <div class="theme"><span class="muted">Theme</span><ThemeToggle /></div>
    </div>
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

<TabBar needCount={shell.needCount} level={shell.level} />

<style>
  .page { max-width: 1240px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 16px; }
  .ttl { min-width: 0; padding-top: 4px; }
  .ttl h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
  .ttl p { margin: 2px 0 0; font-size: 13px; }
  .theme { display: flex; align-items: center; gap: 10px; font-size: 13px; }

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
  .cols, .row { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1.2fr) minmax(0, 1.65fr); gap: 16px; }
  .cols { font-size: 13px; font-weight: 500; color: var(--muted); padding: 4px 0 0; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row { padding: 10px 0; border-top: 1px solid var(--line); align-items: start; }
  .svc { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
  .ic { width: 32px; height: 32px; border-radius: 9px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex: none; }
  .who, .cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; padding-top: 6px; }
  .lbl { display: none; }
  .what { font-weight: 500; }
  .what .muted { font-weight: 400; }
  .state { display: inline-flex; align-items: baseline; gap: 7px; }
  .state .dot { position: relative; top: -1px; }
  .when { font-weight: 400; font-size: 12px; }
  .none { font-size: 13px; }
  .err { color: color-mix(in srgb, var(--lv) 80%, var(--text)); }
  .auto { display: inline-block; font-family: 'Geist', system-ui, sans-serif; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 0 5px; border-radius: 4px; background: var(--surface-3); color: var(--text); }
  .sep { padding: 0 0.5ch; color: var(--muted); }
  /* the widget type reads as text; it still opens its docs, underlined on hover */
  .docs { font-family: 'Geist', system-ui, sans-serif; color: var(--text); text-decoration: none; text-underline-offset: 2px; }
  .docs:hover { text-decoration: underline; }

  /* settings */
  table { width: 100%; border-collapse: collapse; }
  .kv th, .kv td { text-align: left; vertical-align: top; padding: 6px 12px 6px 0; border-top: 1px solid var(--line); font-size: 12px; overflow-wrap: anywhere; }
  .kv th { width: 55%; color: var(--muted); font-weight: 400; }
  .kv.changed th { width: 30%; color: var(--text); }
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
    .page { gap: 14px; padding-bottom: calc(86px + env(safe-area-inset-bottom)); }
    .ttl h1 { font-size: 22px; }
    .stat { padding: 12px 14px; }
    .stat .v { font-size: 16px; }
    .stat .s { white-space: normal; }
    .sec { padding: 16px; border-radius: 18px; }
    .cols { display: none; }
    .row { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 12px 0; }
    .cell { display: grid; grid-template-columns: 3.9em minmax(0, 1fr); column-gap: 6px; padding: 0 0 0 42px; }
    .cell > :not(.lbl) { grid-column: 2; }
    .lbl { display: block; grid-row: 1; font-size: 12px; color: var(--muted); }
    .cell > .lbl + * { grid-row: 1; }
    /* the address on a line of its own, the widget type and options under it */
    .line { display: flex; flex-wrap: wrap; }
    .line .addr { order: -1; flex-basis: 100%; }
    .line .lead { display: none; }
    .seg { width: 100%; }
    .seg button { flex: 1; justify-content: center; min-height: 36px; }
  }
</style>
