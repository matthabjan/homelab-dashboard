<script lang="ts">
  import type { InfraPanel, Snapshot } from '#lib/types';
  import { isProblem } from '#lib/format.ts';
  import Sparkline from './Sparkline.svelte';

  // Infrastructure and backups in one strip: a cell per area with its figure, a small picture of it and a line of
  // context, worded and judged on the server (the same panels are the sheet's tabs). A problem colours the figure and
  // adds its shape; the cell opens the area's tab of the sheet.
  interface Props {
    snap: Snapshot;
    onopen: (panel: InfraPanel) => void;
  }
  let { snap, onopen }: Props = $props();

  // the fullest storage, and where it turns amber (the tick on its meter)
  const fullest = $derived(snap.storage.filter((r) => r.level !== 'off').reduce<{ pct: number; warn: number | null }>((a, r) => ((r.pct ?? 0) > a.pct ? { pct: r.pct ?? 0, warn: r.warn } : a), { pct: 0, warn: null }));
</script>

<section class="card infra" data-v="home" aria-labelledby="h-infra">
  <h2 id="h-infra" class="sr">Infrastructure</h2>
  {#each snap.infrastructure as c (c.id)}
    <button class="cell lv-{c.level}" class:alert={isProblem(c.level)} onclick={() => onopen(c)}>
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
          {@const cpu = snap.host?.gauges.find((g) => g.key === 'cpu')}
          <Sparkline values={cpu?.series} lo={cpu?.lo} hi={cpu?.hi} area dot minSpan={20} height={34} />
        {:else if c.id === 'storage'}
          <span class="meter"><span style:width="{Math.min(100, fullest.pct)}%"></span>{#if fullest.warn != null}<i style:left="{fullest.warn}%"></i>{/if}</span>
        {:else if c.id === 'drives'}
          <span class="pips">{#each snap.drives.slice(0, 10) as d, i (i)}<span class="lv-{d.level}" class:bad={isProblem(d.level)} class:none={d.status === '—'}></span>{/each}</span>
        {:else if c.id === 'network'}
          {@const t = snap.network?.seriesDown ? snap.network : snap.network?.lan}
          <Sparkline values={t?.seriesDown} values2={t?.seriesUp} area dot minSpan={1} height={34} />
        {:else}
          <span class="pips">{#each snap.backups.days as d, i (i)}<span class="lv-{d}" class:none={d === 'none'} class:bad={isProblem(d)}></span>{/each}</span>
        {/if}
      </span>
      {#if c.sub}<span class="s">{c.sub}</span>{/if}
    </button>
  {/each}
</section>

<style>
  /* infrastructure and backups: one strip, a cell per area: label, figure, a small picture of it, context */
  .infra { display: flex; padding: 6px; }
  .cell { position: relative; flex: 1 1 0; display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 14px 16px; border: 0; border-radius: var(--r-14); background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background-color 0.15s; }
  .cell:hover { background: var(--surface-2); }
  .cell:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  /* a rule between cells, left out next to a hovered one */
  .cell + .cell::before { content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; border-left: 1px solid var(--line); }
  .cell:hover::before, .cell:hover + .cell::before { display: none; }
  /* every cell as wide as the others: System shows CPU and RAM, and its temperature only for a problem, when the
     figures may take a second line */
  .clab { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: var(--fs-13); color: var(--muted); }
  .kw::before { content: '·'; margin-right: 7px; }
  .fig { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 12px; min-width: 0; }
  /* a figure and its unit sit closer than two figures, without a negative margin that would indent a wrapped unit */
  .fig:not(:has(.ist)) { column-gap: 6px; }
  .fig .v, .fig .isv { font-size: var(--fs-20); font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .fig .u { font-size: var(--fs-13); color: var(--muted); white-space: nowrap; }
  .ist { display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap; }
  .isk { font-size: var(--fs-13); color: var(--muted); }
  .isv.hl, .cell.alert .fig .v { color: var(--lv); }
  .viz { position: relative; display: flex; align-items: flex-end; height: 34px; --fill: var(--acc); }
  .cell.alert .viz { --fill: var(--lv); }
  .meter { position: relative; width: 100%; height: 6px; margin-bottom: 5px; border-radius: var(--r-4); background: var(--track); }
  .meter span { display: block; height: 100%; border-radius: var(--r-4); background: var(--fill); }
  .meter i { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: var(--warn); opacity: 0.7; }
  /* pictures of a state (a drive each, a day of backups with today on the right) speak in status colours: full height
     and green when fine, a short bar in its colour where something needs a look, a stub where nothing is known. Both
     use one cell size, a seventh of the picture's width (a week of backups fills it) up to 22 px, so a drive and a day
     look alike in every layout. Pictures of an amount (CPU, storage, traffic) stay in the accent colour */
  .pips { --gap: 4px; display: flex; align-items: flex-end; gap: var(--gap); width: 100%; margin-bottom: 3px; }
  .pips span { flex: 0 1 calc((100% - 6 * var(--gap)) / 7); max-width: 22px; height: 14px; border-radius: var(--r-4); background: var(--lv); opacity: 0.85; }
  .pips span.bad { height: 7px; }
  .pips span.none { height: 3px; background: var(--surface-3); opacity: 1; }
  .cell .s { font-size: var(--fs-12); color: var(--muted); min-width: 0; overflow-wrap: anywhere; }

  @media (max-width: 1000px) {
    /* the strip stays one row, the cells as wide as each other */
    .cell { padding: 12px 12px; }
    .fig { gap: 0 8px; }
    .fig .v, .fig .isv { font-size: var(--fs-20); }
  }
  @media (max-width: 760px) {
    /* the strip as a compact list: a row per area, its label over its figure, the picture on the right, as wide in every
       row: 45% of it (about 145 px on a phone). The line of context shows only for an area with
       a problem (the sheet has the rest) */
    .infra { display: flex; flex-direction: column; padding: 4px 6px; border-radius: var(--r-20); }
    .cell { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) 45%; grid-template-areas: 'lab viz' 'fig viz' 's s'; align-items: center; gap: 1px 14px; padding: 10px 10px; }
    .cell + .cell::before { display: block; left: 10px; right: 10px; top: 0; bottom: auto; border-left: 0; border-top: 1px solid var(--line); }
    .cell:hover::before, .cell:hover + .cell::before { display: block; }
    .cell:active { background: var(--surface-2); }
    .clab { grid-area: lab; font-size: var(--fs-12); }
    .fig { grid-area: fig; gap: 0 9px; }
    .fig .v, .fig .isv { font-size: var(--fs-16); }
    .isk, .fig .u { font-size: var(--fs-12); }
    .viz { grid-area: viz; height: 30px; align-items: center; }
    .viz :global(.spark) { height: 30px !important; }
    .meter { margin: 0; }
    .pips { --gap: 3px; margin: 0; align-items: center; }
    .pips span { height: 12px; border-radius: var(--r-4); }
    .pips span.bad { height: 6px; }
    .cell .s { grid-area: s; display: none; font-size: var(--fs-12); margin-top: 2px; }
    .cell.alert .s { display: block; color: color-mix(in srgb, var(--lv) 75%, var(--text)); }
  }
</style>
