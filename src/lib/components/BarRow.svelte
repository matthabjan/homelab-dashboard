<script lang="ts">
  import type { Level } from '#lib/types';
  import Glyph from './Glyph.svelte';

  // The Infrastructure sheet's row, the same for a storage, a drive and a backup: two lines, the name with its
  // figure, then what it is with a bar. A rule sits above every row but the first of its box. A row with `details`
  // opens in place and lists them (nothing a row knows is only in a tooltip); one with `onclick` leads elsewhere.
  interface Props {
    name: string;
    /** colours the bar and the figure: a problem in its colour, `off` grey */
    level: Level | 'off' | 'none';
    /** the figure at the end of the first line: a fill, when it last ran */
    value?: string;
    /** small facts beside the name (a drive's temperature, its error count) */
    facts?: { text: string; warn?: boolean }[];
    /** its state as a pill, for a problem */
    pill?: { text: string; level: Level | 'none' } | null;
    /** the second line's words */
    meta: string;
    /** the words in a fixed slot, so every bar of the box starts at the same place */
    aligned?: boolean;
    /** the bar's fill in %; without it there is no bar */
    fill?: number | null;
    /** where the bar turns amber, in % */
    tick?: number | null;
    /** instead of the bar: the drive's rated endurance left in %, as a small labelled bar */
    life?: number | null;
    /** what the row has no room for, as labelled lines: with them the row is a button that opens and lists them */
    details?: { k: string; v: string }[];
    /** with it the row is a button that leads elsewhere; `label` is what it says to a screen reader */
    onclick?: () => void;
    label?: string;
  }
  let { name, level, value, facts = [], pill = null, meta, aligned = false, fill = null, tick = null, life = null, details, onclick, label }: Props = $props();
  let open = $state(false);
</script>

{#snippet lines()}
  <span class="row-head">
    <span class="name">{name}</span>
    {#each facts as f}<span class="dfact num" class:lv-warn={f.warn}>{f.text}</span>{/each}
    {#if pill}<span class="dstatus lv-{pill.level}">{pill.text}</span>{/if}
    {#if value != null}<span class="num pct">{value}</span>{/if}
    {#if details}<Glyph name="down" size={14} class={open ? 'chev open' : 'chev'} />{/if}
  </span>
  <span class="row-line">
    <span class="meta-t" class:size={aligned}>{meta}</span>
    {#if life != null}
      <span class="life"><span class="muted">Life left</span><span class="track"><span class="fill" style:width="{Math.max(0, Math.min(100, life))}%"></span></span><span class="num lpct">{life}%</span></span>
    {:else if fill != null}
      <span class="track"><span class="fill" style:width="{Math.min(100, Math.max(0, fill))}%"></span>{#if tick != null}<span class="tick" style:left="{tick}%"></span>{/if}</span>
    {/if}
  </span>
  {#if details && open}
    <span class="more">{#each details as d (d.k)}<span class="fact"><span class="k">{d.k}</span><span class="v num">{d.v}</span></span>{/each}</span>
  {/if}
{/snippet}

{#if details}
  <button class="row bar brow opens lv-{level}" aria-expanded={open} onclick={() => (open = !open)}>{@render lines()}</button>
{:else if onclick}
  <button class="row bar brow lv-{level}" {onclick} aria-label={label}>{@render lines()}</button>
{:else}
  <div class="row bar lv-{level}">{@render lines()}</div>
{/if}

<style>
  /* two lines each (name and figure; what it is and a bar), a rule above every row but the first */
  .row { display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 10px 0 11px; border-top: 1px solid var(--line); }
  .row:first-child { border-top: 0; padding-top: 6px; }
  .row-head { display: flex; align-items: baseline; gap: 10px; }
  .row-head .name { flex: 1 1 auto; min-width: 0; font-size: var(--fs-14); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-line { display: flex; align-items: center; gap: 12px; min-height: 16px; }
  .meta-t { flex: 1 1 auto; min-width: 0; font-size: var(--fs-12); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .num { white-space: nowrap; }
  .pct { flex: none; font-size: var(--fs-14); font-weight: 600; }
  .bar { --fill: var(--acc); }
  .bar.lv-warn, .bar.lv-crit { --fill: var(--lv); }
  .bar.lv-warn .pct, .bar.lv-crit .pct { color: var(--lv); }
  .bar.lv-off { --fill: color-mix(in srgb, var(--muted) 50%, transparent); }
  .bar.lv-off .name, .bar.lv-off .pct { color: var(--muted); }
  .bar.lv-ok { --fill: var(--acc); }
  /* the words in a fixed slot, so every bar starts at the same place */
  .size { flex: none; width: 8.5em; }
  .row-line > .track { flex: 1 1 auto; }
  .dstatus { flex: none; font-size: var(--fs-11); font-weight: 600; padding: 1px 8px; border-radius: var(--r-pill); color: var(--lv); background: var(--lv-soft); }
  .dfact { flex: none; font-size: var(--fs-12); color: var(--muted); }
  .dfact.lv-warn { color: var(--lv); }
  .life { flex: none; display: flex; align-items: center; gap: 6px; font-size: var(--fs-12); }
  /* fixed track and a right-aligned slot wide enough for "100%", so every drive's bar lines up */
  .life .track { display: block; flex: none; width: 56px; }
  .lpct { min-width: 4ch; text-align: right; }
  .track { position: relative; display: block; height: 5px; border-radius: var(--r-4); background: var(--track); overflow: hidden; }
  /* where the bar turns amber, like the dashed line on the charts */
  .tick { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--warn); opacity: 0.7; }
  .bar.lv-off .tick { display: none; }
  .fill { display: block; height: 100%; border-radius: var(--r-4); background: var(--fill); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
  /* a row that opens something: a button that looks like the others */
  .brow { width: 100%; border-left: 0; border-right: 0; border-bottom: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .brow:hover .name { color: var(--acc); }
  .brow:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; border-radius: var(--r-8); }
  .brow .row-head, .brow .row-line { width: 100%; }
  /* a row that opens in place: a chevron at its end, and under it the rest as labelled lines */
  .opens:hover .name { color: var(--text); }
  .row-head :global(.chev) { flex: none; align-self: center; margin-left: -4px; color: var(--muted); transition: transform 0.15s; }
  .row-head :global(.chev.open) { transform: rotate(180deg); }
  .more { display: flex; flex-direction: column; width: 100%; margin-top: 4px; padding: 2px 10px; border-radius: var(--r-12); background: var(--surface); }
  .fact { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: var(--fs-12); }
  .fact + .fact { border-top: 1px solid var(--line); }
  .fact .k { color: var(--muted); }
  .fact .v { text-align: right; white-space: normal; overflow-wrap: anywhere; }
</style>
