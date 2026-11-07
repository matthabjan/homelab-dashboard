<script lang="ts">
  import { onMount } from 'svelte';
  import type { Level, Snapshot, Traffic, Trend } from '$lib/types';
  import Gauge from './Gauge.svelte';
  import Reading from './Reading.svelte';

  interface Props {
    /** the card's panels: each but Backups is a tab, with its level and line */
    panels: Snapshot['infrastructure'];
    host: Snapshot['host'];
    storage: Snapshot['storage'];
    drives: Snapshot['drives'];
    network: Snapshot['network'];
    target: string;
    /** when the snapshot was made: the right edge of every history */
    now: number;
    /** the panel to open with (a sheet opened from its card); without it, the one this browser last chose */
    initial?: 'system' | 'storage' | 'drives' | 'network';
  }
  let { panels: summaries, host, storage, drives, network, target, now, initial }: Props = $props();

  /** a tab of the card: its panel id, its name and the dot it shows */
  interface Panel {
    id: 'system' | 'storage' | 'drives' | 'network';
    name: string;
    level: Level | null;
    meta?: string;
  }

  // the dot on a tab: a hidden panel must not hide a problem
  const panels: Panel[] = $derived(summaries.flatMap((p) => (p.id === 'backups' ? [] : [{ id: p.id, name: p.label, level: p.level === 'none' || p.level === 'ok' ? null : p.level, meta: p.meta }])));

  // which panel is open. Remembered per browser as a convenience, so storage errors are ignored
  // svelte-ignore state_referenced_locally — the panel it opens with; the tabs change it from there
  let picked = $state<string>(initial ?? 'system');
  onMount(() => {
    if (initial) return;
    try { picked = localStorage.getItem('infraView') ?? picked; } catch {}
  });
  // the remembered panel may have no data (any more): fall back to the first one
  const view = $derived(panels.some((p) => p.id === picked) ? picked : panels[0]?.id);
  const active = $derived(panels.find((p) => p.id === view));
  function show(id: string) {
    picked = id;
    try { localStorage.setItem('infraView', id); } catch {}
  }
  // arrow keys move between the tabs and wrap around, Home and End jump to the ends (roving tabindex)
  function tabKey(e: KeyboardEvent) {
    const i = panels.findIndex((p) => p.id === view);
    const n = panels.length;
    const moves: Partial<Record<string, number>> = { ArrowLeft: (i - 1 + n) % n, ArrowRight: (i + 1) % n, Home: 0, End: n - 1 };
    const to = moves[e.key];
    if (to == null) return;
    e.preventDefault();
    show(panels[to].id);
    document.getElementById(`vt-${panels[to].id}`)?.focus();
  }
  const tabbed = $derived(panels.length > 1);

  /** How a trend moved: first and last reading, and the change, e.g. "24 h: 61% → 62% (+1.2)". */
  function moved(t: Trend | null, unit: string): { text: string; delta: number } | null {
    const vs = t?.values.filter((v): v is number => v != null) ?? [];
    if (!t || vs.length < 2) return null;
    const a = vs[0], b = vs[vs.length - 1], h = Math.max(1, Math.round((now - t.from) / 3_600_000));
    const d = b - a;
    return { delta: d, text: `${h} h: ${a.toFixed(1)}${unit} → ${b.toFixed(1)}${unit} (${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)})` };
  }
  /** rows grouped by `group`, in the order they come (services.yaml order, then by name) */
  function grouped<T extends { group: string }>(rows: T[]): { name: string; rows: T[] }[] {
    const out: { name: string; rows: T[] }[] = [];
    for (const r of rows) {
      const g = out.find((x) => x.name === r.group);
      if (g) g.rows.push(r); else out.push({ name: r.group, rows: [r] });
    }
    return out;
  }
  const storageGroups = $derived(grouped(storage));
  const driveGroups = $derived(grouped(drives));
  /** the drive's meta without its place, which its group already says ("NVMe · 1 TB · pve" under "pve") */
  const driveMeta = (d: Snapshot['drives'][number]) => (d.meta.endsWith(` · ${d.group}`) ? d.meta.slice(0, -(d.group.length + 3)) : d.meta);
  /** how far back the charts go, said once above them instead of under each */
  const span = (from: number | null | undefined) => `Last ${from ? Math.max(1, Math.round((now - from) / 3_600_000)) : 24} h`;
  const fmtRate = (v: number | null) => (v == null ? '—' : v >= 100 ? Math.round(v) : v.toFixed(1));
  const fmtNum = (n: number | null) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
</script>

{#snippet traffic(t: Traffic, what: string)}
  <!-- one traffic reading as a tile: download filled, upload as a second line, both in Mbit/s -->
  <Reading
    label={what} source={t.source} href={t.href} {target} {now}
    current={{ a: `↓${fmtRate(t.down)}`, b: `↑${fmtRate(t.up)}`, unit: 'Mbit/s' }}
    values={t.seriesDown} values2={t.seriesUp} from={t.from}
    at={(v, v2) => ({ a: `↓${fmtRate(v)}`, b: `↑${fmtRate(v2)}`, unit: 'Mbit/s' })}
    format={(v) => `${fmtRate(v)} Mbit/s down`}
  />
{/snippet}

<div class="infra-card">
  <div class="head">
    {#if tabbed}
      <div class="tabs" role="tablist" aria-label="Infrastructure" style:--n={panels.length}>
        {#each panels as p (p.id)}
          <button role="tab" id="vt-{p.id}" aria-selected={view === p.id} aria-controls="vp-{p.id}" tabindex={view === p.id ? 0 : -1} onclick={() => show(p.id)} onkeydown={tabKey}>
            {p.name}{#if p.level}<span class="dot lv-{p.level}" aria-hidden="true"></span><span class="vh">, {p.level === 'crit' ? 'critical' : 'warning'}</span>{/if}
          </button>
        {/each}
      </div>
    {:else if active}
      <!-- one panel: no tabs, just its name (the sheet title says "Infrastructure") -->
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
          <p class="span">{span(host.gauges.find((g) => g.from)?.from)}</p>
          <div class="gauges">
            {#each host.gauges as g (g.key)}<Gauge {g} {now} />{/each}
          </div>
        {:else if p.id === 'storage'}
          <!-- grouped by the service that reports them, each group a box like the chart tiles; the order inside stays stable -->
          <div class="groups">
            {#each storageGroups as g (g.name)}
              <section class="group" aria-label={g.name}>
                <h3 class="ghead">{g.name}</h3>
                <div class="rows">
                  {#each g.rows as s (s.name)}
                    {@const m = moved(s.trend, '%')}
                    <!-- a storage in two lines, like a drive: name and fill; size (or why it is off) and the bar with a tick
                         where it turns amber. An off row (unavailable, detached) is grey, the bar at the last known fill -->
                    <div class="row bar lv-{s.level}" title="{s.name} · {s.sub}{m ? ` · ${m.text}` : ''}">
                      <div class="row-head">
                        <span class="name">{s.name}</span>
                        <span class="num pct">{s.pct != null ? `${Math.round(s.pct)}%` : '—'}</span>
                      </div>
                      <div class="row-line">
                        <span class="meta-t size">{s.sub}</span>
                        <span class="track"><span class="fill" style:width="{Math.min(100, s.pct ?? 0)}%"></span><span class="tick" style:left="{s.warn}%" title="amber from {s.warn}%"></span></span>
                      </div>
                    </div>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {:else if p.id === 'drives'}
          <!-- grouped by where they sit, like Storage -->
          <div class="groups">
            {#each driveGroups as g (g.name)}
              <section class="group" aria-label={g.name}>
                <h3 class="ghead">{g.name}</h3>
                <div class="rows">
                  {#each g.rows as d}
                    <!-- a drive in two lines: model, temperature and (only when it is not ok) its SMART verdict; what it is and
                         its life left as a labelled bar. The rest is in the tooltip -->
                    <div class="row bar lv-{d.lifeLevel}" title="{d.name} · {d.meta} · {d.detail}">
                      <div class="row-head">
                        <span class="name">{d.name}</span>
                        {#each d.facts as f}<span class="dfact num" class:lv-warn={f.level === 'warn'}>{f.v}{f.k ? ` ${f.k}` : ''}</span>{/each}
                        {#if d.status !== 'ok'}<span class="dstatus lv-{d.level}">{d.status}</span>{/if}
                      </div>
                      <div class="row-line">
                        <span class="meta-t">{driveMeta(d)}</span>
                        {#if d.life != null}
                          <span class="life" title="{d.life}% of the drive's rated write endurance remains"><span class="muted">Life left</span><span class="track"><span class="fill" style:width="{Math.max(0, Math.min(100, d.life))}%"></span></span><span class="num lpct">{d.life}%</span></span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {:else if p.id === 'network' && network}
          <p class="span">{span(network.from ?? network.lan?.from)}</p>
          <div class="net">
            {#if network.source}{@render traffic(network, 'WAN')}{/if}
            {#if network.lan}{@render traffic(network.lan, 'LAN')}{/if}
            {#if network.dns}
              {@const d = network.dns}
              <!-- DNS: the share blocked, over the server's statistics interval when it reports one per hour (AdGuard) -->
              <Reading
                label="DNS" source={d.name} href={d.href} {target} {now}
                current={{ a: `${d.blockedPct.toFixed(1)}%`, unit: 'blocked' }}
                detail="{fmtNum(d.queries)} queries{d.period ? ` · ${d.period}` : ''}"
                values={d.blockedSeries} from={d.blockedSeries && d.stepMs ? now - d.blockedSeries.length * d.stepMs : null}
                at={(v) => ({ a: `${v.toFixed(1)}%`, unit: 'blocked' })}
                format={(v) => `${v.toFixed(1)}% blocked`} min={null} minSpan={10}
              />
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /* panels lay out by the card's width, not the viewport's, so they look the same wherever the card is */
  /* in the sheet, so no frame of its own: the sheet's padding is the only inset */
  .infra-card { container: infra / inline-size; display: flex; flex-direction: column; gap: 16px; }
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

  /* system: tiles like Network's, one per row in the sheet, side by side only where the card is wide */
  .gauges { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; }

  /* storage and drives: one row pattern, two lines each (name and figure; what it is and a bar), a rule above
     every row (the first row's is clipped off); rows flow into as many columns as fit */
  .groups { display: flex; flex-direction: column; gap: 12px; }
  .group { padding: 10px 14px 2px; border-radius: 14px; background: var(--surface-2); }
  .ghead { font-size: 12px; font-weight: 500; color: var(--muted); margin: 0 0 1px; }
  .rows { display: flex; flex-direction: column; }
  .row { display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 10px 0 11px; border-top: 1px solid var(--line); }
  .row:first-child { border-top: 0; padding-top: 6px; }
  .row-head { display: flex; align-items: baseline; gap: 10px; }
  .row-head .name { flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-line { display: flex; align-items: center; gap: 12px; min-height: 16px; }
  .meta-t { flex: 1 1 auto; min-width: 0; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* words in the text font, figures with even digits */
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pct { flex: none; font-size: 14px; font-weight: 600; }
  .bar { --fill: var(--acc); }
  .bar.lv-warn, .bar.lv-crit { --fill: var(--lv); }
  .bar.lv-warn .pct, .bar.lv-crit .pct { color: var(--lv); }
  .bar.lv-off { --fill: color-mix(in srgb, var(--muted) 50%, transparent); }
  .bar.lv-off .name, .bar.lv-off .pct { color: var(--muted); }
  /* storage: the size in a fixed slot, so every bar starts at the same place */
  .size { flex: none; width: 8.5em; }
  .row-line > .track { flex: 1 1 auto; }
  .dstatus { flex: none; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; color: var(--lv); background: var(--lv-soft); }
  .dfact { flex: none; font-size: 12px; color: var(--muted); }
  .dfact.lv-warn { color: var(--lv); }
  .life { flex: none; display: flex; align-items: center; gap: 6px; font-size: 12px; }
  /* fixed track and a right-aligned slot wide enough for "100%", so every drive's bar lines up */
  .life .track { display: block; flex: none; width: 56px; }
  .lpct { min-width: 4ch; text-align: right; }
  .track { position: relative; display: block; height: 5px; border-radius: 4px; background: var(--track); overflow: hidden; }
  /* where the bar turns amber, like the dashed line on the charts */
  .tick { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--warn); opacity: 0.7; }
  .bar.lv-off .tick { display: none; }
  .fill { display: block; height: 100%; border-radius: 4px; background: var(--fill); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }

  /* network: WAN, LAN and DNS as tiles like System's, stacked in the sheet, side by side when the card is wide */
  .span { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
  .net { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; }

  @container infra (max-width: 519.98px) {
    /* phones: four equal segments across the card */
    .tabs { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); flex: 1 1 100%; }
    .tabs button { padding: 8px 2px; gap: 4px; }
  }
  /* the smallest phones: a label and its dot must still fit a quarter of the card */
  @container infra (max-width: 299.98px) { .tabs button { font-size: 13px; padding-inline: 0; gap: 3px; } }
  @media (max-width: 760px) {
    .infra-card { gap: 14px; }
    /* phones: each panel only as tall as it needs */
    .panel.off { display: none; }
  }
</style>
