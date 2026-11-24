<script lang="ts">
  import type { AttentionItem, Snapshot } from '#lib/types';
  import type { View } from '#lib/logic.ts';
  import { ago } from '#lib/ago.ts';
  import { isProblem, since } from '#lib/format.ts';
  import Icon from './Icon.svelte';
  import Glyph from './Glyph.svelte';

  // The answer first: one sentence. While something needs attention, beside it everything that does, once; a single
  // problem is the sentence itself, with what to do about it. Otherwise the most used services.
  interface Props {
    snap: Snapshot;
    /** every warning and critical item, the top one first */
    problems: AttentionItem[];
    /** the data is old or the stream is down: no status colour */
    degraded: boolean;
    /** ids whose level just changed ('verdict' for the card itself) */
    flash: Set<string>;
    now: number;
    target: string;
    /** where a link opens: this dashboard's own pages in place */
    linkTarget: (href: string | null | undefined) => string | undefined;
    onview: (v: View) => void;
    ondetails: (id: string) => void;
    /** a service was opened from Most used */
    onopened: (id: string) => void;
  }
  let { snap, problems, degraded, flash, now, target, linkTarget, onview, ondetails, onopened }: Props = $props();

  const nCrit = $derived(problems.filter((a) => a.sev === 'crit').length);
  let sev = $state<'all' | 'crit' | 'warn'>('all');
  const listed = $derived(problems.filter((a) => sev === 'all' || a.sev === sev));
  // wide screens show the first few; the phone's Alerts view lists them all
  const TRIAGE = 5;
  let triageAll = $state(false);
  $effect(() => { if (!problems.some((a) => a.sev === sev)) sev = 'all'; });
</script>

<section data-v="home alerts" class="card top lv-{degraded ? 'none' : snap.verdict.level}" class:calm={!problems.length} class:flash={flash.has('verdict')} aria-label="Overall status">
  <div class="verdict" data-v="home">
    <div class="vrow">
      <span class="mark" aria-hidden="true"><Glyph bare name={snap.verdict.level === 'ok' ? 'check' : 'bang'} /></span>
      <div class="say">
        {#if degraded}<span class="tag">Last known state</span>{/if}
        <h1>{snap.verdict.title}</h1>
        {#if snap.verdict.sub || snap.lastChange}
          <p class="muted">{[snap.verdict.sub, !snap.needCount && snap.lastChange ? `last change ${since(snap.lastChange, now)}` : ''].filter(Boolean).join(' · ')}</p>
        {/if}
      </div>
    </div>
    {#if problems.length > 1}
      <!-- several problems: the sentence counts them. Phones lead to the whole list; wide screens have it beside this,
           where every row opens its service -->
      <div class="acts only-phone"><button class="btn primary" onclick={() => onview('alerts')}>Review all {problems.length} problems</button></div>
    {:else if problems.length || snap.verdict.action}
      {@const first = problems[0]}
      <div class="acts">
        {#if first?.sid}{@const sid = first.sid}<button class="btn primary" onclick={() => ondetails(sid)}>See details</button>{/if}
        {#if snap.verdict.action}
          <a class="btn" class:primary={!first?.sid} href={snap.verdict.action.href} target={linkTarget(snap.verdict.action.href)} rel="noopener">{snap.verdict.action.label} <Glyph name="out" size={13} stroke={2.4} /></a>
        {/if}
      </div>
    {/if}
  </div>

  {#if problems.length}
    <div class="triage" data-v="alerts">
      <div class="thead">
        <h2>Needs attention</h2>
        {#if nCrit && nCrit < problems.length}
          <div class="chips" role="group" aria-label="Show">
            <button class="chip" aria-pressed={sev === 'all'} onclick={() => (sev = 'all')}>All {problems.length}</button>
            <button class="chip" aria-pressed={sev === 'crit'} onclick={() => (sev = 'crit')}><span class="dot lv-crit" aria-hidden="true"></span>{nCrit} critical</button>
            <button class="chip" aria-pressed={sev === 'warn'} onclick={() => (sev = 'warn')}><span class="dot lv-warn" aria-hidden="true"></span>{problems.length - nCrit} warning{problems.length - nCrit === 1 ? '' : 's'}</button>
          </div>
        {:else}
          <span class="muted small num">{problems.length}</span>
        {/if}
      </div>
      <ul class="rows" id="triage">
        {#each listed as a, i (a.key)}
          <li class="lv-{a.sev}" class:extra={i >= TRIAGE && !triageAll} class:flash={!!a.sid && flash.has(a.sid)}>
            <!-- a row opens the service's details; one that isn't about a service (the config) leads where it says -->
            <svelte:element
              this={a.sid ? 'button' : a.href ? 'a' : 'div'} class="arow" class:tap={!!a.sid || !!a.href}
              href={!a.sid && a.href ? a.href : undefined} target={!a.sid ? linkTarget(a.href) : undefined}
              onclick={a.sid ? () => ondetails(a.sid ?? '') : undefined} role={a.sid || a.href ? undefined : 'group'}
            >
              <span class="dot lv-{a.sev}" aria-hidden="true"></span>
              <span class="t"><span class="sr">{a.sev === 'crit' ? 'Critical: ' : 'Warning: '}</span>{a.title}</span>
              <span class="w num">{ago(a.ts, now)}</span>
              {#if a.detail}<span class="d">{a.detail}</span>{/if}
            </svelte:element>
          </li>
        {/each}
      </ul>
      {#if listed.length > TRIAGE}
        <button class="link-btn more" aria-expanded={triageAll} aria-controls="triage" onclick={() => (triageAll = !triageAll)}>{triageAll ? 'Show fewer' : `Show all ${listed.length}`}</button>
      {/if}
    </div>
  {:else}
    <!-- phones, the Alerts view with nothing in it: a calm, centred all clear, not an empty list -->
    <div class="quiet only-phone lv-ok" data-v="alerts">
      <span class="mark" aria-hidden="true"><Glyph bare name="check" /></span>
      <p class="qt">Nothing needs attention</p>
      <p class="muted">{snap.verdict.title}{snap.lastChange ? ` · last change ${since(snap.lastChange, now)}` : ''}</p>
    </div>
  {/if}

  <!-- wide: while something needs attention the card holds only that. Phones: Home always has the most used -->
  {#if snap.mostUsed.length}
    <div class="most" class:need={problems.length > 0} data-v="home">
      <h2 class="k">Most used</h2>
      <div class="apps">
        {#each snap.mostUsed as t (t.id)}
          <a class="app lift" href={t.href} target={target} rel="noopener" onclick={() => onopened(t.id)} aria-label="{t.name}{isProblem(t.level) ? `, ${t.status}` : ''}">
            <span class="ic big lv-{t.level}"><Icon src={t.icon} dark={t.iconDark} name={t.name} size={28} />{#if isProblem(t.level)}<span class="pmark" aria-hidden="true"></span>{/if}</span>
            <span class="an" class:one={!/\s/.test(t.name)}>{t.name}</span>
          </a>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  /* the sentence and what to do, and beside it what needs attention (or, when calm, the most used services) */
  .top { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); }
  .top.calm { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
  .verdict { padding: 28px 30px; display: flex; flex-direction: column; justify-content: center; gap: 18px; min-width: 0; }
  .vrow { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
  .mark { width: 46px; height: 46px; margin-top: 1px; border-radius: 50%; background: var(--lv-soft); color: var(--lv); display: flex; align-items: center; justify-content: center; flex: none; }
  .mark :global(svg) { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .top.lv-none .mark { color: var(--muted); }
  .say { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
  .tag { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: clamp(26px, 2.9vw, 34px); line-height: 1.1; font-weight: 700; letter-spacing: -0.025em; text-wrap: balance; }
  .say p { margin: 0; font-size: 14.5px; }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; }
  .triage { padding: 20px 22px 14px; border-left: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .rows li + li { border-top: 1px solid var(--line); }
  .rows li.extra { display: none; }
  .rows li.flash { border-radius: 10px; }
  /* a problem: its shape, what it is in full, how long it has been raised, and the detail under it */
  .arow { width: 100%; box-sizing: border-box; display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: baseline; gap: 2px 10px; padding: 10px 6px; border: 0; border-radius: 10px; background: none; color: var(--text); font: inherit; text-align: left; }
  .arow.tap { cursor: pointer; transition: background-color 0.15s; }
  .arow.tap:hover { background: var(--surface-2); }
  .arow.tap:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
  .arow .dot { align-self: center; justify-self: center; }
  .arow .t { font-size: 14.5px; font-weight: 500; overflow-wrap: anywhere; }
  .arow .w { font-size: 12.5px; color: var(--muted); }
  .arow .d { grid-column: 2; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
  .quiet { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 36px 24px 32px; text-align: center; }
  .quiet .mark { width: 56px; height: 56px; margin: 0 0 6px; }
  .quiet .mark :global(svg) { width: 28px; height: 28px; }
  .quiet p { margin: 0; text-wrap: balance; }
  .quiet .qt { font-size: 20px; font-weight: 600; letter-spacing: -0.015em; }
  .quiet .muted { font-size: 14px; }
  .most { display: flex; flex-direction: column; gap: 6px; padding: 20px 26px 20px 8px; }
  .most .k { padding-left: 10px; }
  @media not all and (max-width: 760px) { .most.need { display: none; } }
  .apps { display: flex; flex-wrap: wrap; gap: 4px; }
  .app { width: 92px; display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 10px 2px; border-radius: 14px; text-align: center; font-size: 13px; }
  .app:hover { background: var(--surface-2); }
  /* a name wraps at its spaces onto two lines at most; a single word too long for the tile ends in an ellipsis, never split */
  .an { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: normal; word-break: normal; line-height: 1.25; max-width: 100%; }
  .an.one { display: block; white-space: nowrap; text-overflow: ellipsis; }
  /* a most used service with a problem: one small marker, its colour from the level */
  .pmark { position: absolute; top: -3px; right: -3px; width: 12px; height: 12px; border-radius: 50%; background: var(--lv); box-shadow: 0 0 0 2px var(--surface); }

  /* narrower: the list goes under the sentence */
  @media (max-width: 1000px) {
    .top, .top.calm { grid-template-columns: minmax(0, 1fr); }
    .triage { border-left: 0; border-top: 1px solid var(--line); }
    .most { padding: 0 22px 20px; }
  }
  @media (max-width: 760px) {
    .top { border-radius: 22px; }
    .verdict { padding: 20px; gap: 16px; }
    .mark { width: 36px; height: 36px; margin-top: 0; }
    .mark :global(svg) { width: 19px; height: 19px; }
    .vrow { gap: 12px; }
    h1 { font-size: 26px; }
    .say p { font-size: 14px; }
    .acts { flex-direction: column; }
    /* the Alerts view is the list, whole */
    .triage { border-top: 0; padding: 16px 14px; }
    .rows li.extra { display: block; }
    .more { display: none; }
    .arow { padding: 13px 6px; }
    .most { padding: 0 12px 14px; }
    .apps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .app { width: auto; }
  }
</style>
