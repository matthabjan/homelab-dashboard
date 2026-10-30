<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { CheckKind, ConfigView, KeyValue, Level } from '$lib/types';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import type { PageProps } from './$types';
  import { ago } from '$lib/ago.ts';

  let { data }: PageProps = $props();
  const view = $derived(data.view);
  let now = $state(Date.now());
  let copied = $state('');

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

  async function copy(i: ConfigView['icons'][number]) {
    try {
      await navigator.clipboard.writeText(i.yaml);
      copied = `Copied the icon for ${i.name}`;
    } catch {
      copied = `Copy failed: select the text for ${i.name} instead`;
    }
  }

  // settings by section: `intervals.probe` → intervals / probe; top-level keys are "general"
  const settingGroups = $derived.by(() => {
    const groups = new Map<string, KeyValue[]>();
    for (const { k, v } of view.settings) {
      const [head, ...rest] = k.split('.');
      const g = rest.length ? head : 'general';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)?.push({ k: rest.length ? rest.join('.') : k, v });
    }
    return [...groups];
  });

  const STATUS: Record<ConfigView['widgets'][number]['status'], [Level | 'none', string]> = { ok: ['ok', 'OK'], error: ['crit', 'Error'], never: ['none', 'Not run yet'], unsupported: ['warn', 'Not supported'] };
  const KIND: Record<CheckKind, string> = { http: 'HTTP', tcp: 'TCP', container: 'Container', heartbeat: 'Heartbeat' };
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

  <section class="card sec" id="problems" aria-labelledby="h-problems">
    <h2 id="h-problems">Problems <span class="count mono">{view.problems.length}</span></h2>
    {#if view.problems.length}
      <ul class="problems">
        {#each view.problems as p}
          <li class="lv-{p.level}">
            <span class="dot lv-{p.level}" aria-hidden="true"></span>
            <span class="txt"><span class="sev">{p.level === 'crit' ? 'Error' : 'Warning'}</span> <span class="mono file">{p.file}</span> {p.message}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">None: every file loaded and every secret is set.</p>
    {/if}
  </section>

  <section class="card sec" aria-labelledby="h-widgets">
    <h2 id="h-widgets">Widgets <span class="count mono">{view.widgets.length}</span></h2>
    {#if view.widgets.length}
      <table>
        <thead><tr><th scope="col">Service</th><th scope="col">Type</th><th scope="col">Endpoint</th><th scope="col">Status</th><th scope="col">Last success</th><th scope="col">Source</th></tr></thead>
        <tbody>
          {#each view.widgets as w (w.id)}
            {@const [lv, word] = STATUS[w.status]}
            <tr>
              <th scope="row" data-label="Service"><span class="n">{w.name}</span><span class="muted sub">{w.group}</span></th>
              <td data-label="Type">{#if w.docs}<a class="docs" href={w.docs} target="_blank" rel="noopener">{w.type}<span class="sr"> (documentation, opens in a new tab)</span></a>{:else}<span class="mono">{w.type}</span>{/if}</td>
              <td data-label="Endpoint"><span class="mono">{w.origin ?? '—'}</span>{#each w.options as o}<span class="mono muted opt">{o.k}: {o.v}</span>{/each}</td>
              <td data-label="Status"><span class="state lv-{lv}"><span class="dot lv-{lv}" aria-hidden="true"></span>{word}</span>{#if w.error}<span class="muted sub err">{w.error}</span>{/if}</td>
              <td data-label="Last success" class="mono">{since(w.lastOk)}</td>
              <td data-label="Source" class="muted">{w.source}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="muted">No service has a <code>widget:</code> block.</p>
    {/if}
  </section>

  <section class="card sec" aria-labelledby="h-checks">
    <h2 id="h-checks">Checks <span class="count mono">{view.checks.length}</span></h2>
    {#if view.checks.length}
      <table>
        <thead><tr><th scope="col">Service</th><th scope="col">Kind</th><th scope="col">Target</th><th scope="col">Interval</th><th scope="col">State</th></tr></thead>
        <tbody>
          {#each view.checks as c (c.id)}
            {@const lv = c.level === 'unknown' ? 'none' : c.level}
            <tr>
              <th scope="row" data-label="Service"><span class="n">{c.name}</span><span class="muted sub">{c.group}</span></th>
              <td data-label="Kind">{KIND[c.kind]}</td>
              <td data-label="Target" class="mono">{c.target}</td>
              <td data-label="Interval">{c.interval}</td>
              <td data-label="State"><span class="state lv-{lv}"><span class="dot lv-{lv}" aria-hidden="true"></span>{c.state}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="muted">No service has a <code>siteMonitor</code>, a heartbeat or a container behind it.</p>
    {/if}
  </section>

  {#if view.icons.length}
    <section class="card sec" aria-labelledby="h-icons">
      <h2 id="h-icons">Automatic icons <span class="count mono">{view.icons.length}</span></h2>
      <p class="muted intro">Picked by name or image. To keep one, copy it into the service in <code>services.yaml</code>.</p>
      <ul class="icons">
        {#each view.icons as i (i.id)}
          <li>
            <span class="iname"><span class="n">{i.name}</span><span class="muted sub">{i.group}</span></span>
            <code class="yaml">{i.yaml}</code>
            <button class="copy" onclick={() => copy(i)} aria-label="Copy YAML for {i.name}">Copy YAML</button>
          </li>
        {/each}
      </ul>
      <p class="sr" aria-live="polite">{copied}</p>
    </section>
  {/if}

  <section class="card sec" aria-labelledby="h-settings">
    <h2 id="h-settings">Settings</h2>
    <p class="muted intro">The effective values: <code>settings.yaml</code> over the defaults.</p>
    <div class="kvs">
      {#each settingGroups as [group, rows] (group)}
        <table class="kv">
          <caption class="mono">{group}</caption>
          <thead class="sr"><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead>
          <tbody>
            {#each rows as s (s.k)}
              <tr><th scope="row" class="mono">{s.k}</th><td class="mono">{s.v}</td></tr>
            {/each}
          </tbody>
        </table>
      {/each}
    </div>
  </section>
</div>

<style>
  .page { max-width: 1200px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left)); display: flex; flex-direction: column; gap: 20px; }
  .top { display: flex; align-items: center; gap: 16px 20px; flex-wrap: wrap; }
  .back { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px 0 10px; border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); font-size: 13px; font-weight: 500; }
  .ttl { flex: 1 1 320px; min-width: 0; }
  .ttl h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
  .ttl p { margin: 2px 0 0; font-size: 13px; }
  .right { margin-left: auto; }
  .demo { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 5px; background: var(--surface-3); color: var(--text); }

  .sec { padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  h2 { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .count { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 8px; background: var(--surface-2); color: var(--muted); }
  .intro { margin: -4px 0 0; font-size: 13px; }
  code { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; }
  .sub { display: block; font-size: 12px; font-weight: 400; }
  .n { font-weight: 500; }

  .problems { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .problems li { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--lv-soft); }
  .problems .dot { position: relative; top: -1px; }
  .sev { font-weight: 600; color: var(--lv); }
  .file { font-size: 12px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { text-align: left; font-size: 11px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); padding: 0 12px 8px 0; }
  tbody th, tbody td { text-align: left; vertical-align: top; padding: 10px 12px 10px 0; border-top: 1px solid var(--line); }
  tbody th { font-weight: 400; }
  .docs { color: var(--acc); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
  .opt { display: block; font-size: 11px; }
  .state { display: inline-flex; align-items: center; gap: 7px; font-weight: 500; }
  .err { overflow-wrap: anywhere; }
  .kvs { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px 32px; align-items: start; }
  .kv caption { text-align: left; font-size: 12px; font-weight: 600; padding-bottom: 6px; }
  .kv tbody th, .kv tbody td { padding: 6px 12px 6px 0; }
  .kv th { width: 55%; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .kv td { font-size: 12px; overflow-wrap: anywhere; }

  .icons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .icons li { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr) auto; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .yaml { white-space: pre; padding: 6px 10px; border-radius: 8px; background: var(--surface-2); overflow-x: auto; }
  .copy { min-height: 36px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--surface-2); font-size: 13px; font-weight: 500; cursor: pointer; }
  .copy:hover { background: var(--surface-3); }

  /* phones: one column; each table row becomes a small card of labelled lines */
  @media (max-width: 760px) {
    .page { gap: 16px; }
    .ttl h1 { font-size: 22px; }
    .sec { padding: 16px; border-radius: 18px; }
    table:not(.kv) thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    table:not(.kv), table:not(.kv) tbody, table:not(.kv) tr, table:not(.kv) th, table:not(.kv) td { display: block; }
    table:not(.kv) tr { padding: 10px 0; border-top: 1px solid var(--line); }
    table:not(.kv) tbody th, table:not(.kv) tbody td { border: 0; padding: 2px 0; }
    table:not(.kv) td { display: grid; grid-template-columns: 7.5em minmax(0, 1fr); gap: 8px; }
    table:not(.kv) td::before { content: attr(data-label); color: var(--muted); font-size: 12px; font-family: 'Geist', system-ui, sans-serif; }
    table:not(.kv) td > * { grid-column: 2; }
    table:not(.kv) td > :first-child { grid-row: 1; }
    .icons li { grid-template-columns: minmax(0, 1fr) auto; }
    .yaml { grid-column: 1 / -1; grid-row: 2; }
    .copy { min-height: 44px; }
  }
</style>
