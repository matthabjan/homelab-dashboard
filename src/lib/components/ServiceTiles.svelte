<script lang="ts">
  import type { Snapshot } from '#lib/types';
  import { isProblem } from '#lib/format.ts';
  import { longpress } from '#lib/actions/longpress.ts';
  import Icon from './Icon.svelte';
  import Glyph from './Glyph.svelte';

  // One tile per service and job: it opens the service, and its line says how it is. The button at its end (and a
  // long press) opens the details; what has nothing to open opens its details at once.
  interface Props {
    groups: Snapshot['groups'];
    /** ids whose level just changed */
    flash: Set<string>;
    target: string;
    ondetails: (id: string) => void;
    /** a service was opened from its tile */
    onopened: (id: string) => void;
  }
  let { groups: all, flash, target, ondetails, onopened }: Props = $props();

  // every service and job in its group, or only those with a problem
  let only = $state<'all' | 'problems'>('all');
  const count = $derived(all.reduce((n, g) => n + g.services.length, 0));
  const nBad = $derived(all.reduce((n, g) => n + g.services.filter((t) => isProblem(t.level)).length, 0));
  $effect(() => { if (!nBad) only = 'all'; });
  const groups = $derived(all.map((g) => ({ ...g, services: g.services.filter((t) => only === 'all' || isProblem(t.level)) })).filter((g) => g.services.length));
</script>

<section data-v="services" class="card sec services" aria-labelledby="h-services">
  <div class="thead">
    <h2 id="h-services">Services</h2>
    {#if nBad}
      <div class="chips" role="group" aria-label="Show">
        <button class="chip" aria-pressed={only === 'all'} onclick={() => (only = 'all')}>All {count}</button>
        <button class="chip" aria-pressed={only === 'problems'} onclick={() => (only = 'problems')}><span class="dot lv-warn" aria-hidden="true"></span>Problems {nBad}</button>
      </div>
    {/if}
  </div>
  {#each groups as g (g.name)}
    <div class="sgroup">
      <h3>{g.name}</h3>
      <ul class="tiles">
        {#each g.services as t (t.id)}
          {@const bad = isProblem(t.level)}
          <li class="tile lv-{t.level}" class:alert={bad} class:flash={flash.has(t.id)}>
            {#snippet inner()}
              <span class="ic"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={24} /></span>
              <span class="tx"><span class="t">{t.name}</span><span class="d" class:hl={isProblem(t.lineLevel)}>{t.line || t.status}</span></span>
            {/snippet}
            {#if t.href}
              <a class="tmain" href={t.href} target={target} rel="noopener" onclick={() => onopened(t.id)} use:longpress={() => ondetails(t.id)}>{@render inner()}</a>
            {:else}
              <button class="tmain" onclick={() => ondetails(t.id)}>{@render inner()}</button>
            {/if}
            <button class="inf" onclick={() => ondetails(t.id)} aria-label="Details of {t.name}{bad ? `, ${t.status}` : ''}" title="Details">
              {#if bad}<span class="dot lv-{t.level}" aria-hidden="true"></span>
              {:else}<Glyph name="details" size={17} stroke={1.9} />{/if}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="muted">No services in <code>services.yaml</code> yet.</p>
  {/each}
</section>

<style>
  .sgroup { display: flex; flex-direction: column; gap: 4px; }
  .sgroup h3 { padding: 6px 8px 2px; }
  .tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 2px 8px; }
  /* a tile: the service to open, with its line, and at its end the way to its details */
  .tile { display: flex; align-items: center; min-width: 0; border-radius: 12px; transition: background-color 0.15s; }
  .tile:hover, .tile:focus-within { background: var(--surface-2); }
  .tmain { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 9px 2px 9px 8px; border: 0; border-radius: 12px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; -webkit-touch-callout: none; user-select: none; }
  .tmain:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  .tx { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .tx .t { font-size: 14.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tx .d { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tx .d.hl { color: color-mix(in srgb, var(--lv) 85%, var(--text)); }
  /* a tile with a problem says it in full, on two lines at most; healthy tiles keep to one */
  .tile.alert .tx .d { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  .inf { flex: none; width: 36px; height: 36px; margin-right: 4px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 10px; background: none; color: var(--muted); cursor: pointer; }
  .inf:hover { background: var(--surface-3); color: var(--text); }
  /* the details button of a healthy tile shows when the tile is pointed at or focused; a problem's shape always */
  .inf :global(svg) { opacity: 0; transition: opacity 0.15s; }
  .tile:hover .inf :global(svg), .inf:focus-visible :global(svg) { opacity: 1; }
  @media (hover: none) { .inf :global(svg) { opacity: 1; } }

  @media (max-width: 760px) {
    .tiles { grid-template-columns: minmax(0, 1fr); }
    .tile { min-height: 56px; }
    .tile:hover { background: none; }
    .tile:active { background: var(--surface-2); }
    .inf { width: 44px; height: 44px; margin: 0; }
  }
</style>
