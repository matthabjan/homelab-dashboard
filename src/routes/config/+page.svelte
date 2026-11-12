<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll, pushState } from '$app/navigation';
  import { page } from '$app/state';
  import type { CheckKind, ConfigView, Level } from '$lib/types';
  import Icon from '$lib/components/Icon.svelte';
  import AppHeader from '$lib/components/AppHeader.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
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

  /** a row in a few words, for phones: "HTTP · proxmox connected" */

  // a row opens the service's details in a sheet; it is a history entry, so back closes it
  const openId = $derived(page.state.setup ?? null);
  const opened = $derived(openId ? rows.find((r) => r.id === openId) ?? null : null);
  const open = (id: string) => pushState('', { setup: id });
  const close = () => { if (openId) history.back(); };

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
  <AppHeader title={view.title} logo={shell.logo} logoDark={shell.logoDark} demo={view.demo} current="setup" deepLink={shell.deepLink} target={shell.linkTarget} configProblems={view.problems.length} />
  <div class="ttl">
    <h1>Setup</h1>
    <p class="muted">What {view.title} loaded from your config, read-only. Credentials, tokens and URL paths are never shown.</p>
  </div>

  <!-- is the config right? four answers in one strip, each leading to its section -->
  <nav class="card strip" aria-label="Summary">
    <a class="cell lv-{problemsLevel}" class:alert={problemsLevel !== 'ok'} href="#problems" id={view.problems.length ? undefined : 'problems'}>
      <span class="k">Config files{#if problemsLevel !== 'ok'}<span class="dot lv-{problemsLevel}" aria-hidden="true"></span>{/if}</span>
      <span class="v">{view.problems.length ? `${view.problems.length} problem${view.problems.length === 1 ? '' : 's'}` : 'No problems'}</span>
      <span class="s">{view.problems.length ? 'listed below' : 'every file loaded, every secret set'}</span>
    </a>
    <a class="cell" href="#services">
      <span class="k">Services</span>
      <span class="v">{rows.length}</span>
      <span class="s">{fromLabels ? `${rows.length - fromLabels} from services.yaml, ${fromLabels} from labels` : 'from services.yaml'}</span>
    </a>
    <a class="cell lv-{widgetsLevel}" class:alert={widgetsLevel !== 'ok'} href="#services">
      <span class="k">Widgets{#if widgetsLevel !== 'ok'}<span class="dot lv-{widgetsLevel}" aria-hidden="true"></span>{/if}</span>
      <span class="v">{connected} / {view.widgets.length} <small>connected</small></span>
      <span class="s">{fixCount ? `${fixCount} need${fixCount === 1 ? 's' : ''} a fix` : 'URL, credentials and permissions work'}</span>
    </a>
    <a class="cell" href="#settings">
      <span class="k">Settings</span>
      <span class="v">{changed.length} <small>changed</small></span>
      <span class="s">of {view.settings.length}, the rest default</span>
    </a>
  </nav>

  {#if view.problems.length}
    <section class="card sec" id="problems" aria-labelledby="h-problems">
      <h2 id="h-problems">Problems</h2>
      <ul class="problems">
        {#each view.problems as p}
          <li class="lv-{p.level}">
            <span class="dot lv-{p.level}" aria-hidden="true"></span>
            <span class="pt"><span class="mono file">{p.file}</span> {p.message}</span>
            <span class="sev">{p.level === 'crit' ? 'Error' : 'Warning'}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="lower">
    <section class="card sec" id="services" aria-labelledby="h-services">
      <div class="sec-head">
        <h2 id="h-services">Services</h2>
        {#if fixCount}
          <div class="chips" role="group" aria-label="Show">
            <button class="chip" aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>All {rows.length}</button>
            <button class="chip" aria-pressed={filter === 'fix'} onclick={() => (filter = 'fix')}><span class="dot lv-crit" aria-hidden="true"></span>Needs a fix {fixCount}</button>
          </div>
        {:else}
          <span class="muted small">{rows.length}</span>
        {/if}
      </div>
      <p class="muted intro">How each service is set up; how it is doing is on the dashboard. A row opens its details.</p>

      {#if !rows.length}
        <p class="muted">No services in <code>services.yaml</code> yet.</p>
      {:else}
        <div class="cols" aria-hidden="true"><span>Service</span><span>Check</span><span>Widget</span><span></span></div>
        {#each groups as [group, list] (group)}
          <section class="group" aria-label={group}>
            <h3>{group}</h3>
            <ul class="rows">
              {#each list as r (r.id)}
                {@const [wl, word] = r.widget ? CONN[r.widget.status] : ['none', '']}
                <li>
                  <!-- wide: the check and the widget beside the name. Phones: the name and one line; the rest is in the sheet -->
                  <button class="row" onclick={() => open(r.id)}>
                    <span class="svc">
                      <span class="ic"><Icon src={r.icon ?? `/assets/monogram/${encodeURIComponent(r.name)}.svg`} dark={r.iconDark} name={r.name} size={22} /></span>
                      <span class="who">
                        <span class="n">{r.name}</span>
                        <!-- phones: the check and the widget as labelled lines under the name (wide screens have columns) -->
                        <span class="pl">
                          <span class="pline"><span class="lab">Check</span>{#if r.check}<b>{KIND[r.check.kind]}</b>{#if r.check.kind === 'heartbeat'}<span>{r.check.interval}</span>{:else if r.check.kind === 'container'}<span>{r.source !== 'services.yaml' ? `from ${r.source}` : r.check.interval}</span>{:else}<span class="mono">{r.check.target.replace(/^[a-z]+:\/\//, '')}</span>{/if}{:else}<span>none</span>{/if}</span>
                          {#if r.widget}
                            <span class="pline"><span class="lab">Widget</span><span class="dot lv-{wl}" aria-hidden="true"></span><b>{r.widget.type}</b><span>{word.toLowerCase()}{#if r.widget.status === 'ok' || r.widget.status === 'error'}&nbsp;· {since(r.widget.lastOk)}{/if}</span></span>
                            {#if r.widget.error}<span class="perr">{r.widget.error}</span>{/if}
                          {/if}
                        </span>
                        {#if r.source !== 'services.yaml'}<span class="sub muted wide">{r.source}</span>{/if}
                      </span>
                    </span>
                    <span class="cell wide">
                      {#if r.check}
                        <span class="what">{KIND[r.check.kind]}<span class="sep">·</span><span class="muted">{r.check.interval}</span></span>
                        {#if r.check.kind !== 'container'}<span class="sub mono">{r.check.target}</span>{/if}
                      {:else}
                        <span class="muted">No check</span>
                      {/if}
                    </span>
                    <span class="cell wide">
                      {#if r.widget}
                        <span class="what"><span class="state"><span class="dot lv-{wl}" aria-hidden="true"></span>{word}</span>{#if r.widget.status === 'ok' || r.widget.status === 'error'}<span class="sep">·</span><span class="muted when">{since(r.widget.lastOk)}</span>{/if}</span>
                        <span class="sub mono">{r.widget.type}<span class="sep">·</span>{r.widget.origin ?? '—'}</span>
                        {#if r.widget.error}<span class="sub err lv-crit">{r.widget.error}</span>{/if}
                      {:else}
                        <span class="muted">No widget</span>
                      {/if}
                    </span>
                    <span class="end">{#if r.fix}<span class="dot lv-{wl}" aria-hidden="true"></span><span class="sr">needs a fix</span>{/if}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </section>

    <section class="card sec" id="settings" aria-labelledby="h-settings">
      <h2 id="h-settings">Settings</h2>
      <div class="theme"><span>Theme</span><ThemeToggle /></div>
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
</div>

<!-- how one service is set up: everything the row says and what it leaves out on phones -->
<Sheet open={!!opened} title={opened?.name ?? ''} sub={opened ? `${opened.group} · how it is set up` : ''} onback={close} onclose={close}>
  {#if opened}
    {@const r = opened}
    {@const [wl, word] = r.widget ? CONN[r.widget.status] : ['none', '']}
    <div class="sh-head">
      <span class="ic big"><Icon src={r.icon ?? `/assets/monogram/${encodeURIComponent(r.name)}.svg`} dark={r.iconDark} name={r.name} size={28} /></span>
      <span class="who">
        <span class="state lv-{r.fix ? wl : 'ok'}"><span class="dot lv-{r.fix ? wl : 'ok'}" aria-hidden="true"></span>{r.fix ? 'Needs a fix' : 'Nothing to fix'}</span>
        <span class="muted">{r.fix ? (r.widget?.error ?? 'This dashboard has no integration for this widget type.') : r.widget ? 'Its widget connects with the URL and credentials given.' : 'It has no widget to connect.'}</span>
      </span>
    </div>
    <dl class="facts">
      <div><dt>Check</dt><dd>{#if r.check}{KIND[r.check.kind]} · {r.check.interval}{:else}none{/if}</dd></div>
      {#if r.check && r.check.kind !== 'container'}<div><dt>{r.check.kind === 'heartbeat' ? 'Reports to' : 'Target'}</dt><dd class="mono">{r.check.target}</dd></div>{/if}
      <div><dt>Widget</dt><dd>{#if r.widget}{#if r.widget.docs}<a class="docs" href={r.widget.docs} target="_blank" rel="noopener">{r.widget.type}<span class="sr"> (documentation, opens in a new tab)</span></a>{:else}{r.widget.type}{/if}{:else}none{/if}</dd></div>
      {#if r.widget}
        <div><dt>Address</dt><dd class="mono">{r.widget.origin ?? '—'}</dd></div>
        <div><dt>Connection</dt><dd><span class="state"><span class="dot lv-{wl}" aria-hidden="true"></span>{word}</span>{#if r.widget.status === 'ok' || r.widget.status === 'error'}<span class="muted">&nbsp;· last success {since(r.widget.lastOk)}</span>{/if}</dd></div>
        {#each r.widget.options as o (o.k)}<div><dt class="mono">{o.k}</dt><dd class="mono">{o.v}</dd></div>{/each}
      {/if}
      <div><dt>Icon</dt><dd>{#if r.auto}<span class="mono">{r.auto.icon}</span> · picked automatically{:else if r.icon}set in the config{:else}its initials{/if}</dd></div>
      <div><dt>Defined in</dt><dd>{r.source}</dd></div>
    </dl>
    {#if r.auto}<p class="muted intro">The icon was picked by name, image or widget type. To use another, set <code>icon</code> in <code>services.yaml</code>.</p>{/if}
  {/if}
</Sheet>

<TabBar needCount={shell.needCount} level={shell.level} />

<style>
  .page { max-width: 1240px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 16px; }
  .ttl { min-width: 0; padding-top: 4px; }
  .ttl h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
  .ttl p { margin: 2px 0 0; font-size: 14px; }
  .small { font-size: 13px; }

  /* summary: four answers in one strip, like the dashboard's infrastructure */
  .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 6px; }
  .strip .cell { position: relative; display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 14px 16px; border-radius: 14px; transition: background-color 0.15s; }
  .strip .cell:hover { background: var(--surface-2); }
  .strip .cell + .cell::before { content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; border-left: 1px solid var(--line); }
  .strip .cell:hover::before, .strip .cell:hover + .cell::before { display: none; }
  .strip .k { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--muted); }
  .strip .v { font-size: 20px; font-weight: 600; letter-spacing: -0.015em; font-variant-numeric: tabular-nums; }
  .strip .v small { font-size: 13px; font-weight: 400; color: var(--muted); letter-spacing: 0; }
  .strip .alert .v { color: var(--lv); }
  .strip .s { font-size: 12.5px; color: var(--muted); }

  .lower { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .sec { padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; min-width: 0; scroll-margin-top: 16px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h2 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
  h3 { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; padding: 12px 8px 4px; }
  .count { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 8px; background: var(--surface-2); color: var(--muted); }
  .intro { margin: -4px 0 0; font-size: 13px; }
  code { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; }
  .sub { display: block; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 11px; border: 0; border-radius: 999px; background: var(--surface-2); color: var(--muted); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
  .chip[aria-pressed='true'] { background: var(--text); color: var(--bg); }
  .chip[aria-pressed='true'] .dot { background: currentColor; }

  .problems { list-style: none; margin: 0; padding: 0; }
  .problems li { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: baseline; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); font-size: 14px; }
  .problems li:first-child { border-top: 0; }
  .problems .dot { align-self: center; justify-self: center; }
  .pt { overflow-wrap: anywhere; }
  .sev { font-size: 12.5px; color: var(--muted); }
  .file { font-size: 12px; font-weight: 500; }

  /* services: one row per service, check and widget beside it; the whole row opens the details */
  .cols, .row { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 1.5fr) 14px; gap: 16px; }
  .cols { font-size: 12.5px; color: var(--muted); padding: 2px 8px 0; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row { width: 100%; box-sizing: border-box; align-items: center; padding: 9px 8px; border: 0; border-radius: 12px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background-color 0.15s; }
  .row:hover { background: var(--surface-2); }
  .svc { display: flex; gap: 12px; align-items: center; min-width: 0; }
  .ic { width: 36px; height: 36px; border-radius: 11px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex: none; }
  .ic.big { width: 50px; height: 50px; border-radius: 15px; }
  .who, .cell { display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 13.5px; }
  .n { font-size: 14.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pl { display: none; }
  .pline { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; color: var(--muted); white-space: nowrap; }
  .pline > :last-child { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .pline b { font-weight: 500; color: var(--text); flex: none; }
  .pline .lab { width: 46px; flex: none; font-size: 11.5px; }
  .pline .dot { flex: none; }
  .pline .mono { font-size: 11.5px; }
  .perr { padding-left: 52px; font-size: 12.5px; color: color-mix(in srgb, var(--crit) 85%, var(--text)); overflow-wrap: anywhere; }
  .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state { display: inline-flex; align-items: baseline; gap: 7px; font-weight: 500; }
  .state .dot { position: relative; top: -1px; }
  .err { color: color-mix(in srgb, var(--lv) 80%, var(--text)); white-space: normal; }
  .sep { padding: 0 0.5ch; color: var(--muted); }
  .end { display: flex; justify-content: center; }

  /* settings */
  .theme { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  .kv th, .kv td { text-align: left; vertical-align: top; padding: 7px 12px 7px 0; border-top: 1px solid var(--line); font-size: 12px; overflow-wrap: anywhere; }
  .kv th { width: 55%; color: var(--muted); font-weight: 400; }
  .kv td { text-align: right; padding-right: 0; }
  .kv.changed th { color: var(--text); }
  .kv caption { text-align: left; font-size: 12px; font-weight: 600; padding-bottom: 6px; }
  .kvs { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 12px; }
  .is-changed th { color: var(--text); }
  .is-changed th::before, .mark { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--acc); vertical-align: middle; }
  .mark { margin: 0 2px 0 4px; }
  details summary { cursor: pointer; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; min-height: 36px; }
  details[open] summary { margin-bottom: 4px; }

  /* the details sheet */
  .sh-head { display: flex; align-items: center; gap: 14px; }
  .sh-head .who { font-size: 13.5px; gap: 3px; }
  .sh-head .state { font-size: 14px; font-weight: 600; }
  .facts { margin: 0; display: flex; flex-direction: column; }
  .facts > div { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 14.5px; }
  .facts dt { color: var(--muted); flex: none; }
  .facts dd { margin: 0; text-align: right; overflow-wrap: anywhere; min-width: 0; }
  .facts .mono { font-size: 12.5px; }
  .docs { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line); }

  @media (max-width: 1000px) {
    .lower { grid-template-columns: minmax(0, 1fr); }
    .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .strip .cell + .cell::before { display: none; }
    .kvs { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px 32px; }
  }
  /* phones: a service is its name and one line; the row opens the rest */
  @media (max-width: 760px) {
    .page { gap: 12px; padding-bottom: calc(86px + env(safe-area-inset-bottom)); }
    .ttl h1 { font-size: 22px; }
    .strip { border-radius: 22px; }
    .strip .cell { padding: 12px 14px; }
    .strip .v { font-size: 19px; }
    .sec { padding: 16px 14px; border-radius: 20px; }
    .cols, .wide { display: none; }
    .row { grid-template-columns: minmax(0, 1fr) 10px; gap: 8px; min-height: 56px; }
    .row:hover { background: none; }
    .row:active { background: var(--surface-2); }
    .pl { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
    .row { align-items: start; }
    .svc { align-items: flex-start; }
    .end { padding-top: 12px; }
    /* a service that needs a fix, tinted so it is found while scrolling */
    .row:has(.perr) { background: color-mix(in srgb, var(--crit) 8%, transparent); }
    .chip { min-height: 36px; }
  }
</style>
