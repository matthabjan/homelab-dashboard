<script>
  import { onMount } from 'svelte';
  import Gauge from './Gauge.svelte';
  import Sparkline from './Sparkline.svelte';

  /** @typedef {import('$lib/types').Snapshot} Snapshot */
  /** @type {{ host: Snapshot['host'], storage: Snapshot['storage'], drives: Snapshot['drives'], network: Snapshot['network'], target: string }} */
  let { host, storage, drives, network, target } = $props();

  /** the worst problem among the levels, for the dot on a tab: a hidden panel must not hide one */
  const worst = (/** @type {string[]} */ levels) => (levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : null);
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const charted = (t) => (t?.seriesDown ?? []).filter((v) => v != null).length > 1;

  const panels = $derived.by(() => {
    const list = [];
    if (host) list.push({ id: 'system', name: 'System', level: worst(host.gauges.map((g) => g.level)) });
    if (storage.length) {
      const off = storage.filter((s) => s.level === 'off').length;
      list.push({ id: 'storage', name: 'Storage', level: worst(storage.map((s) => s.level)), meta: count(storage.length, 'storage') + (off ? ` · ${off} offline` : '') });
    }
    if (drives.length) {
      const failing = drives.filter((d) => d.status === 'failing').length;
      const check = drives.filter((d) => d.status === 'check').length;
      const smart = failing ? `${failing} failing` : check ? `${check} to check` : drives.every((d) => d.status === 'ok') ? 'SMART ok' : '';
      list.push({ id: 'drives', name: 'Drives', level: worst(drives.flatMap((d) => [d.level, d.lifeLevel])), meta: count(drives.length, 'drive') + (smart ? ` · ${smart}` : '') });
    }
    if (network) {
      const span = charted(network) ? network.spanH : charted(network.lan) ? network.lan?.spanH : null;
      list.push({ id: 'network', name: 'Network', level: null, meta: span ? `Last ${span} h` : '' });
    }
    return list;
  });

  // which panel is open. Remembered per browser as a convenience, so storage errors are ignored
  let picked = $state('system');
  onMount(() => {
    try { picked = localStorage.getItem('vitalsView') ?? picked; } catch {}
  });
  // the remembered panel may have no data (any more): fall back to the first one
  const view = $derived(panels.some((p) => p.id === picked) ? picked : panels[0]?.id);
  const active = $derived(panels.find((p) => p.id === view));
  function show(id) {
    picked = id;
    try { localStorage.setItem('vitalsView', id); } catch {}
  }
  // arrow keys move between the tabs and wrap around, Home and End jump to the ends (roving tabindex)
  function tabKey(e) {
    const i = panels.findIndex((p) => p.id === view);
    const n = panels.length;
    const to = { ArrowLeft: (i - 1 + n) % n, ArrowRight: (i + 1) % n, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    show(panels[to].id);
    document.getElementById(`vt-${panels[to].id}`)?.focus();
  }
  const tabbed = $derived(panels.length > 1);

  const fmtRate = (v) => (v == null ? '—' : v >= 100 ? Math.round(v) : v.toFixed(1));
  const fmtNum = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
</script>

{#snippet traffic(t, what, downWord, upWord)}
  <!-- one traffic reading: where it comes from, the current rates, then the recent chart -->
  <div class="cell">
    <div class="net-row">
      <span class="net-src"><span class="net-what">{what}</span><span class="muted">{t.source}</span></span>
      <span class="net-vals mono"><span style:color="var(--acc)">{fmtRate(t.down)}</span> <span class="muted">{downWord}</span> <span style:color="var(--acc-2)">{fmtRate(t.up)}</span> <span class="muted">{upWord} Mbit/s</span></span>
    </div>
    <!-- a fresh metric has fewer than two points: no chart, so no blank space either -->
    {#if charted(t)}
      {@const down = t.seriesDown.filter((v) => v != null)}
      <div class="netchart">
        <div class="layer"><Sparkline values={t.seriesDown} color="var(--acc)" area height={40} min={0} label="{what} {downWord}, last {t.spanH ?? 24} hours" /></div>
        <div class="layer"><Sparkline values={t.seriesUp} color="var(--acc-2)" height={40} min={0} max={Math.max(1, ...down) * 1.1} /></div>
      </div>
    {/if}
  </div>
{/snippet}

<div class="card vitals-card">
  <div class="head">
    {#if tabbed}
      <div class="tabs" role="tablist" aria-label="Vitals" style:--n={panels.length}>
        {#each panels as p (p.id)}
          <button role="tab" id="vt-{p.id}" aria-selected={view === p.id} aria-controls="vp-{p.id}" tabindex={view === p.id ? 0 : -1} onclick={() => show(p.id)} onkeydown={tabKey}>
            {p.name}{#if p.level}<span class="dot lv-{p.level}" aria-hidden="true"></span><span class="vh">, {p.level === 'crit' ? 'critical' : 'warning'}</span>{/if}
          </button>
        {/each}
      </div>
    {:else if active}
      <!-- one panel: no tabs, just its name (the section header above says "Vitals") -->
      <span class="solo">{active.name}</span>
    {/if}
    <!-- what the open panel shows; System labels each value -->
    {#if view === 'system' && host}
      <dl class="meta host-facts">
        <div><dt>Node</dt><dd>{#if host.href}<a class="node" href={host.href} target={target} rel="noopener">{host.name}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg></a>{:else}{host.name}{/if}</dd></div>
        {#each host.facts as f (f.label)}<div><dt>{f.label}</dt><dd>{f.value}</dd></div>{/each}
      </dl>
    {:else if active?.meta}
      <span class="meta muted">{active.meta}</span>
    {/if}
  </div>

  <!-- every panel sits in the same cell, so the card keeps the tallest one's height and nothing below moves on a switch (phones: natural height) -->
  <div class="panels">
    {#each panels as p (p.id)}
      <div class="panel {p.id}" class:off={view !== p.id} id="vp-{p.id}" role={tabbed ? 'tabpanel' : undefined} aria-labelledby={tabbed ? `vt-${p.id}` : undefined}>
        {#if p.id === 'system' && host}
          <div class="gauges">
            {#each host.gauges as g (g.key)}<Gauge {g} />{/each}
          </div>
        {:else if p.id === 'storage'}
          <div class="rows">
            {#each storage as s}
              <!-- an off row (unavailable, detached) is grey: its reason in the sub column, the bar at the last known fill -->
              <div class="bar lv-{s.level}" title="{s.name} · {s.sub}">
                <div class="bar-head"><span class="name">{s.name}</span><span class="mono muted sub">{s.sub}</span><span class="mono pct">{s.pct != null ? `${Math.round(s.pct)}%` : '—'}</span></div>
                <div class="track"><div class="fill" style:width="{Math.min(100, s.pct ?? 0)}%"></div></div>
              </div>
            {/each}
          </div>
        {:else if p.id === 'drives'}
          <div class="rows ruled">
            {#each drives as d}
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
                    <span class="life" title="{d.life}% of the drive's rated write endurance remains"><span class="muted">Life left</span><span class="track"><span class="fill" style:width="{Math.max(0, Math.min(100, d.life))}%"></span></span><span class="mono pct">{d.life}%</span></span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else if p.id === 'network' && network}
          <div class="net">
            {#if network.source}{@render traffic(network, 'WAN', 'down', 'up')}{/if}
            {#if network.lan}{@render traffic(network.lan, 'LAN', 'in', 'out')}{/if}
            {#if network.dns}
              <a class="cell net-row dns" href={network.dns.href} target={target} rel="noopener">
                <span class="net-src"><span class="net-what">DNS</span><span class="muted">{network.dns.name}{network.dns.period ? ` · ${network.dns.period}` : ''}</span></span>
                <span class="net-vals mono">{fmtNum(network.dns.queries)} <span class="muted">queries</span> {network.dns.blockedPct.toFixed(1)}% <span class="muted">blocked</span></span>
              </a>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /* panels lay out by the card's width, not the viewport's, so they look the same wherever the card is */
  .vitals-card { container: vitals / inline-size; padding: 22px; display: flex; flex-direction: column; gap: 16px; }
  .solo { font-size: 14px; font-weight: 600; }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* tabs on the left, what the open panel shows on the right; the context wraps below when it doesn't fit */
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; min-height: 34px; }
  .meta { font-size: 12px; }
  .host-facts { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 0; }
  .host-facts div { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .host-facts dt { color: var(--muted); }
  .host-facts dd { margin: 0; font-size: 13px; font-weight: 500; }
  .host-facts .node { display: inline-flex; align-items: center; gap: 3px; }
  .host-facts .node:hover { color: var(--acc); }

  /* segmented control: a recessed track with the selected view raised on it */
  .tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--surface-2); }
  .tabs button {
    all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    font-size: 14px; font-weight: 600; color: var(--muted); padding: 6px 16px; min-height: 22px; border-radius: 8px;
    transition: background-color 0.15s, color 0.15s, box-shadow 0.15s;
  }
  .tabs button:hover { color: var(--text); }
  .tabs button[aria-selected='true'] { color: var(--text); background: var(--raised); box-shadow: 0 1px 3px rgba(16, 24, 40, 0.12), 0 0 0 1px var(--line); }
  .tabs button:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
  .tabs .dot { width: 7px; height: 7px; }
  .tabs .dot.lv-warn { width: 9px; height: 8px; }
  @media (pointer: coarse) { .tabs button { min-height: 28px; } }

  .panels { display: grid; }
  .panel { grid-area: 1 / 1; display: flex; flex-direction: column; min-width: 0; }
  /* hidden panels still hold their height; visibility also takes them out of the tab order and the accessibility tree */
  .panel.off { visibility: hidden; }

  /* system: one slot per gauge kind, so a missing one leaves the others their usual size */
  .gauges { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }

  /* storage and drives: rows flow into as many columns as fit */
  .rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px 32px; align-content: start; }
  /* drives are two lines each: a rule above every row; the first row's is clipped off */
  .rows.ruled { gap: 10px 32px; margin-top: -11px; clip-path: inset(1px 0 0 0); grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); }
  .bar { --fill: var(--acc); display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .bar.lv-warn, .bar.lv-crit { --fill: var(--lv); }
  .bar-head { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
  .bar-head .name { flex: 0 1 auto; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-head .sub { flex: 1 1 auto; min-width: 0; text-align: right; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pct { flex: none; font-size: 14px; font-weight: 500; }
  .bar.lv-warn .pct, .bar.lv-crit .pct { color: var(--lv); }
  .bar.lv-off { --fill: color-mix(in srgb, var(--muted) 50%, transparent); }
  .bar.lv-off .name, .bar.lv-off .pct { color: var(--muted); }
  .off-sub { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .drive { gap: 4px; padding-top: 10px; border-top: 1px solid var(--track); }
  .drive .name { flex: 1 1 auto; max-width: none; }
  .dstatus { flex: none; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; color: var(--lv); background: var(--lv-soft); }
  .dfact { flex: none; font-size: 11px; color: var(--muted); white-space: nowrap; }
  .dfact.lv-warn { color: var(--lv); }
  .dline { display: flex; align-items: center; gap: 12px; }
  .dline .off-sub { flex: 1 1 auto; min-width: 0; }
  .life { flex: none; display: flex; align-items: center; gap: 6px; font-size: 11px; }
  /* fixed track and a right-aligned slot wide enough for "100%", so every drive's bar lines up */
  .life .track { display: block; flex: none; width: 56px; height: 4px; }
  .life .pct { min-width: 4ch; text-align: right; font-size: 11px; font-weight: 400; }
  .life .fill { display: block; }
  .track { height: 6px; border-radius: 4px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; border-radius: 4px; background: var(--fill); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }

  /* network: WAN, LAN and DNS stacked with a rule between them; side by side once the card is wide */
  .net { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px 24px; }
  .net > .cell + .cell { padding-top: 14px; border-top: 1px solid var(--track); }
  .cell { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  /* always two lines (where it comes from, then the values): one line only fits the shorter sources, so blocks would differ */
  .net-row { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
  .net-src { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .net-src .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .net-what { font-weight: 600; }
  .net-vals { white-space: nowrap; }
  .net-vals > :not(.muted) { font-size: 15px; font-weight: 500; }
  .netchart { position: relative; height: 40px; }
  .layer { position: absolute; inset: 0; }
  .dns { color: inherit; text-decoration: none; gap: 2px; }

  @container vitals (min-width: 520px) {
    /* WAN and LAN side by side, DNS across below them */
    .net:has(> .cell:nth-child(2)) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .net > .cell:nth-child(2) { padding-top: 0; border-top: 0; padding-left: 24px; border-left: 1px solid var(--track); }
    .net > .cell:nth-child(3) { grid-column: 1 / -1; }
  }
  @container vitals (min-width: 880px) {
    .net:has(> .cell:nth-child(3)) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .net > .cell:nth-child(3) { grid-column: auto; padding-top: 0; border-top: 0; padding-left: 24px; border-left: 1px solid var(--track); }
  }
  @container vitals (max-width: 519.98px) {
    /* phones: four equal segments across the card */
    .tabs { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); flex: 1 1 100%; }
    .tabs button { padding: 8px 2px; gap: 4px; }
    .gauges { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  }
  /* the smallest phones: a label and its dot must still fit a quarter of the card */
  @container vitals (max-width: 299.98px) { .tabs button { font-size: 13px; padding-inline: 0; gap: 3px; } }
  @media (max-width: 760px) {
    .vitals-card { padding: 16px; border-radius: 22px; gap: 14px; }
    /* phones: each panel only as tall as it needs */
    .panel.off { display: none; }
  }
</style>
