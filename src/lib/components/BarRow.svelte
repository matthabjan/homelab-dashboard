<script lang="ts">
  import type { Level } from '#lib/types';

  // The Infrastructure sheet's row, the same for a storage, a drive and a backup: two lines, the name with its
  // figure, then what it is with a bar. A rule sits above every row but the first of its box.
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
    /** the details the row has no room for */
    title?: string;
    /** with it the row is a button; `label` is what it says to a screen reader */
    onclick?: () => void;
    label?: string;
  }
  let { name, level, value, facts = [], pill = null, meta, aligned = false, fill = null, tick = null, life = null, title, onclick, label }: Props = $props();
</script>

{#snippet lines()}
  <span class="row-head">
    <span class="name">{name}</span>
    {#each facts as f}<span class="dfact num" class:lv-warn={f.warn}>{f.text}</span>{/each}
    {#if pill}<span class="dstatus lv-{pill.level}">{pill.text}</span>{/if}
    {#if value != null}<span class="num pct">{value}</span>{/if}
  </span>
  <span class="row-line">
    <span class="meta-t" class:size={aligned}>{meta}</span>
    {#if life != null}
      <span class="life" title="{life}% of the drive's rated write endurance remains"><span class="muted">Life left</span><span class="track"><span class="fill" style:width="{Math.max(0, Math.min(100, life))}%"></span></span><span class="num lpct">{life}%</span></span>
    {:else if fill != null}
      <span class="track"><span class="fill" style:width="{Math.min(100, Math.max(0, fill))}%"></span>{#if tick != null}<span class="tick" style:left="{tick}%" title="amber from {tick}%"></span>{/if}</span>
    {/if}
  </span>
{/snippet}

{#if onclick}
  <button class="row bar brow lv-{level}" {title} {onclick} aria-label={label}>{@render lines()}</button>
{:else}
  <div class="row bar lv-{level}" {title} aria-label={label}>{@render lines()}</div>
{/if}

<style>
  /* two lines each (name and figure; what it is and a bar), a rule above every row but the first */
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
  .bar.lv-ok { --fill: var(--acc); }
  /* the words in a fixed slot, so every bar starts at the same place */
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
  /* a row that opens something: a button that looks like the others */
  .brow { width: 100%; border-left: 0; border-right: 0; border-bottom: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .brow:hover .name { color: var(--acc); }
  .brow:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; border-radius: 6px; }
  .brow .row-head, .brow .row-line { width: 100%; }
</style>
