<script lang="ts">
  import { onMount } from 'svelte';
  import type { Backups, Level, Snapshot } from '#lib/types';
  import Glyph from './Glyph.svelte';
  import SystemTab from './SystemTab.svelte';
  import StorageTab from './StorageTab.svelte';
  import DrivesTab from './DrivesTab.svelte';
  import NetworkTab from './NetworkTab.svelte';
  import BackupsTab from './BackupsTab.svelte';

  // The Infrastructure sheet: a tab per area that has data, each drawn by its own component in one style (rounded
  // boxes of two-line rows with a bar, or chart tiles). The tabs and the line beside them say what the strip's cells do.
  interface Props {
    /** the strip's panels: each is a tab, with its level and line */
    panels: Snapshot['infrastructure'];
    host: Snapshot['host'];
    storage: Snapshot['storage'];
    drives: Snapshot['drives'];
    network: Snapshot['network'];
    target: string;
    /** when the snapshot was made: the right edge of every history */
    now: number;
    /** the panel to open with (a sheet opened from its card); without it, the one this browser last chose */
    initial?: Panel['id'];
    /** the Backups tab: its summary, the week and a row per backup; without it there is no tab */
    backups?: Backups | null;
    /** a backup row opens its service's sheet, which the page keeps */
    onbackup?: (id: string) => void;
    /** when something last happened: the Backups tab's Recent list is read again */
    lastChange?: number | null;
    /** the page's clock, which the Recent list's times are measured from */
    clock?: number;
  }
  let { panels: summaries, host, storage, drives, network, target, now, initial, backups, onbackup, lastChange = null, clock }: Props = $props();

  /** a tab of the card: its panel id, its name and the dot it shows */
  interface Panel {
    id: Snapshot['infrastructure'][number]['id'];
    name: string;
    level: Level | null;
    meta?: string;
  }

  // the dot on a tab: a hidden panel must not hide a problem. Backups' line is its summary ("All 7 on schedule · next: …")
  const panels: Panel[] = $derived(summaries.flatMap((p) => (p.id === 'backups' && !backups ? [] : [{ id: p.id, name: p.label, level: p.level === 'none' || p.level === 'ok' ? null : p.level, meta: p.id === 'backups' && backups ? [backups.title, backups.sub].filter(Boolean).join(' · ') : p.meta }])));

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

  /** how far back the charts go, said once above them instead of under each */
  const span = (from: number | null | undefined) => `Last ${from ? Math.max(1, Math.round((now - from) / 3_600_000)) : 24} h`;
</script>

<div class="infra-card">
  <div class="head">
    {#if tabbed}
      <div class="tabs" role="tablist" aria-label="Infrastructure" style:--n={panels.length}>
        {#each panels as p (p.id)}
          <button role="tab" id="vt-{p.id}" aria-selected={view === p.id} aria-controls="vp-{p.id}" tabindex={view === p.id ? 0 : -1} onclick={() => show(p.id)} onkeydown={tabKey}>
            {p.name}{#if p.level}<span class="dot lv-{p.level}" aria-hidden="true"></span><span class="sr">, {p.level === 'crit' ? 'critical' : 'warning'}</span>{/if}
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
        <div><dt>Node</dt><dd>{#if host.href}<a class="node" href={host.href} target={target} rel="noopener">{host.name}<Glyph name="out-wide" size={12} /></a>{:else}{host.name}{/if}</dd></div>
        {#each host.facts as f (f.label)}<div><dt>{f.label}</dt><dd>{f.value}</dd></div>{/each}
      </dl>
    {:else if active?.meta}
      <span class="meta muted" class:hl={!!active.level} class:lv-warn={active.level === 'warn'} class:lv-crit={active.level === 'crit'}>{active.meta}</span>
    {/if}
  </div>

  <!-- every panel sits in the same cell, so the card keeps the tallest one's height and nothing below moves on a switch (phones: natural height) -->
  <div class="panels">
    {#each panels as p (p.id)}
      <div class="panel {p.id}" class:off={view !== p.id} id="vp-{p.id}" role={tabbed ? 'tabpanel' : undefined} aria-labelledby={tabbed ? `vt-${p.id}` : undefined}>
        {#if p.id === 'system' && host}
          <SystemTab {host} {target} {now} {span} />
        {:else if p.id === 'storage'}
          <StorageTab {storage} {now} />
        {:else if p.id === 'drives'}
          <DrivesTab {drives} />
        {:else if p.id === 'network' && network}
          <NetworkTab {network} {target} {now} {span} />
        {:else if p.id === 'backups' && backups}
          <BackupsTab {backups} {now} clock={clock ?? now} {lastChange} {onbackup} />
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /* panels lay out by the card's width, not the viewport's, so they look the same wherever the card is */
  /* in the sheet, so no frame of its own: the sheet's padding is the only inset */
  .infra-card { container: infra / inline-size; display: flex; flex-direction: column; gap: 16px; }
  .solo { font-size: var(--fs-14); font-weight: 600; }

  /* tabs on the left, what the open panel shows on the right; the context wraps below when it doesn't fit */
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; min-height: 34px; }
  .meta { font-size: var(--fs-12); }
  /* the line of a panel with a problem (Backups: what is overdue) in its colour */
  .meta.hl { color: color-mix(in srgb, var(--lv) 85%, var(--text)); }
  .host-facts { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 0; }
  .host-facts div { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .host-facts dt { color: var(--muted); }
  .host-facts dd { margin: 0; font-size: var(--fs-13); font-weight: 500; }
  .host-facts .node { display: inline-flex; align-items: center; gap: 3px; }
  .host-facts .node:hover { color: var(--acc); }

  /* segmented control: a recessed track with the selected view raised on it */
  .tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--r-12); background: var(--surface-2); }
  .tabs button {
    all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    font-size: var(--fs-14); font-weight: 600; color: var(--muted); padding: 6px 16px; min-height: 22px; border-radius: var(--r-8);
    transition: background-color 0.15s, color 0.15s, box-shadow 0.15s;
  }
  .tabs button:hover { color: var(--text); }
  .tabs button[aria-selected='true'] { color: var(--text); background: var(--raised); box-shadow: 0 1px 3px rgba(16, 24, 40, 0.12), 0 0 0 1px var(--line); }
  .tabs button:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
  .tabs .dot { width: 7px; height: 7px; }
  .tabs .dot.lv-warn { width: 9px; height: 8px; }
  @media (pointer: coarse) { .tabs button { min-height: 28px; } }

  /* the charts' plot height: taller where the card is wide */
  .panels { display: grid; --chart-h: 120px; }
  @container infra (min-width: 520px) { .panels { --chart-h: 150px; } }
  .panel { grid-area: 1 / 1; display: flex; flex-direction: column; min-width: 0; }
  /* hidden panels still hold their height; visibility also takes them out of the tab order and the accessibility tree */
  .panel.off { visibility: hidden; }

  /* Storage, Drives and Backups are boxes, one under the other */
  .panel.storage, .panel.drives, .panel.backups { gap: 12px; }

  @container infra (max-width: 519.98px) {
    /* phones: equal segments across the card */
    .tabs { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); flex: 1 1 100%; }
    .tabs button { padding: 8px 0; gap: 3px; font-size: var(--fs-13); }
  }
  /* the smallest phones: a label and its dot must still fit a quarter of the card */
  @container infra (max-width: 339.98px) { .tabs button { font-size: var(--fs-12); gap: 2px; } }
  @media (max-width: 760px) {
    .infra-card { gap: 14px; }
    /* phones: each panel only as tall as it needs */
    .panel.off { display: none; }
  }
</style>
