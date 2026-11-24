<script lang="ts">
  import type { FeedItem, SheetRef } from '#lib/types';
  import EventList from './EventList.svelte';
  import Glyph from './Glyph.svelte';

  // Activity: what happened first; the notes (pending updates and the like) fold into one row under it, so they don't
  // crowd out what happened.
  interface Props {
    feed: FeedItem[];
    now: number;
    /** a row opens the sheet that tells more */
    onopen: (to: SheetRef) => void;
  }
  let { feed, now, onopen }: Props = $props();

  const notes = $derived(feed.filter((a) => 'key' in a && a.sev === 'info'));
  const happened = $derived(feed.filter((a) => !('key' in a && a.sev === 'info')));
  const FEED = 5;
</script>

<section class="card sec activity" data-v="home" aria-labelledby="h-activity">
  <div class="thead"><h2 id="h-activity">Activity</h2>{#if happened.length > FEED}<button class="link-btn" onclick={() => onopen({ kind: 'activity' })}>Show all</button>{:else}<span class="muted small">Last 24 hours</span>{/if}</div>
  {#if happened.length}
    <EventList items={happened.slice(0, FEED)} {now} {onopen} />
  {:else}
    <p class="muted small">No changes in the last 24 hours.</p>
  {/if}
  {#if notes.length}
    <details class="notes">
      <summary><span class="ev-ico"><Glyph name="info" size={15} /></span><span class="t">{notes.length} note{notes.length === 1 ? '' : 's'}</span><span class="muted small">updates and the like</span><Glyph name="down" class="nchev" /></summary>
      <EventList items={notes} {now} {onopen} />
    </details>
  {/if}
</section>

<style>
  /* the notes, folded: one row that opens them */
  .notes { border-top: 1px solid var(--line); margin-top: -6px; }
  .notes summary { display: flex; align-items: center; gap: 12px; margin: 4px -8px 0; padding: 8px; border-radius: 12px; list-style: none; cursor: pointer; --lv: var(--acc); --lv-soft: var(--surface-2); }
  .notes summary::-webkit-details-marker { display: none; }
  .notes summary:hover { background: var(--surface-2); }
  .notes summary .t { font-size: 15px; font-weight: 500; }
  .notes summary .small { flex: 1; }
  .ev-ico { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--lv-soft); color: var(--lv); flex: none; }
  .notes summary :global(.nchev) { flex: none; color: var(--muted); transition: transform 0.15s; }
  .notes[open] summary :global(.nchev) { transform: rotate(180deg); }
</style>
