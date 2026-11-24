<script lang="ts">
  import type { FeedItem, SheetRef } from '#lib/types';
  import { ago } from '#lib/ago.ts';
  import Glyph from './Glyph.svelte';

  // Events and alerts as a list: what happened, about which service, and when. Activity's rows open the sheet that
  // tells more (`onopen`); a sheet's rows show what a note is about (`full`: the pending packages).
  interface Props {
    items: FeedItem[];
    /** the page's clock */
    now: number;
    /** with it, a row that names a sheet (`open`) is a button that opens it */
    onopen?: (to: SheetRef) => void;
    /** list what the item is about under it (`items`), the first few and the rest on request */
    full?: boolean;
    id?: string;
  }
  let { items, now, onopen, full = false, id }: Props = $props();
  /** the lines a note shows under it (pending packages) before "N more" */
  const LINES = 5;
</script>

<ul class="evs" {id}>
  {#each items as a (a.ts + a.title)}
    {@const to = onopen ? a.open : null}
    <li class="ev lv-{a.sev}">
      <svelte:element this={to ? 'button' : 'div'} class="ev-row" class:tap={!!to} onclick={to ? () => onopen?.($state.snapshot(to)) : undefined} role={to ? undefined : 'group'}>
        <span class="ev-ico"><Glyph name={a.sev} size={15} /></span>
        <span class="txt"><span class="t">{a.title}</span>{#if a.detail}<span class="d muted">{a.detail}</span>{/if}</span>
        <span class="num muted when">{ago(a.ts, now)}</span>
        {#if to}<Glyph name="right" class="ev-chev" />{/if}
      </svelte:element>
      {#if full && a.items?.length}
        <ul class="ev-items mono">
          {#each a.items.slice(0, LINES) as line, i (i)}<li>{line}</li>{/each}
        </ul>
        {#if a.items.length > LINES}
          <details class="ev-more"><summary>{a.items.length - LINES} more</summary><ul class="ev-items mono">{#each a.items.slice(LINES) as line, i (i)}<li>{line}</li>{/each}</ul></details>
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<style>
  .evs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .ev { padding: 12px 0; border-top: 1px solid var(--line); }
  .ev:first-child { border-top: 0; }
  .ev-row { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; }
  /* a row that opens a sheet: the whole row is the button, its hover reaching a little past the text */
  .ev:has(.tap) { padding: 4px 0; }
  .ev-row.tap { margin: 0 -8px; width: calc(100% + 16px); padding: 8px; border: 0; border-radius: 12px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color 0.15s; }
  .ev-row.tap:hover { background: var(--surface-2); }
  .ev-row.tap:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  .ev-ico { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--lv-soft); color: var(--lv); flex: none; }
  .ev.lv-ok .ev-ico { background: var(--surface-2); color: var(--muted); }
  .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .t { font-size: 15px; font-weight: 500; }
  .d { font-size: 13.5px; overflow-wrap: anywhere; }
  .when { flex: none; font-size: 13px; }
  .ev-row :global(.ev-chev) { flex: none; margin-left: -4px; color: var(--muted); }
  .ev-items { list-style: none; margin: 8px 0 0 44px; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
  .ev-more { margin-left: 44px; }
  .ev-more summary { margin-top: 6px; padding: 6px; list-style: none; cursor: pointer; color: var(--acc); font-size: 13px; font-weight: 500; }
  .ev-more summary::-webkit-details-marker { display: none; }
  .ev-more[open] summary { display: none; }
  .ev-more .ev-items { margin-left: 0; }
</style>
