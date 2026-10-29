<script>
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';

  /** Command palette: fuzzy search over services and bookmarks. */
  /** @import { Bookmark, Tile } from '$lib/types' */
  /** @type {{ open?: boolean, services?: Tile[], bookmarks?: Bookmark[], mostUsed?: Tile[], target?: string, onopen?: (id: string) => void }} */
  let { open = $bindable(false), services = [], bookmarks = [], mostUsed = [], target = '_blank', onopen } = $props();

  let q = $state('');
  let active = $state(0);
  /** @type {HTMLInputElement | undefined} */
  let input = $state();
  /** @type {HTMLElement | undefined} */
  let list = $state();

  const items = $derived([
    ...services.map((s) => ({ kind: 'service', id: s.id, name: s.name, sub: s.host || s.group, href: s.href, icon: s.icon, iconDark: s.iconDark, level: s.level, hay: `${s.name} ${s.host} ${s.group} ${s.description}`.toLowerCase() })),
    ...bookmarks.map((b) => ({ kind: 'link', id: 'bm-' + b.name, name: b.name, sub: b.group, href: b.href, icon: b.icon, iconDark: b.iconDark, level: null, hay: `${b.name} ${b.group} ${b.href}`.toLowerCase() })),
    // this dashboard's own pages
    { kind: 'page', id: 'page-config', name: 'Config & status', sub: 'problems, widgets, checks', href: '/config', icon: null, iconDark: null, level: null, hay: 'config status settings problems widgets checks secrets icons' }
  ]);

  function score(hay, name, query) {
    const n = name.toLowerCase();
    if (n.startsWith(query)) return 100 - n.length / 100;
    if (n.split(/[\s\-!]+/).some((w) => w.startsWith(query))) return 80;
    if (hay.includes(query)) return 60;
    // subsequence match ("pxm" → "proxmox")
    let i = 0;
    for (const c of n) if (c === query[i]) i++;
    return i === query.length ? 30 : -1;
  }

  const results = $derived.by(() => {
    const query = q.trim().toLowerCase();
    if (!query) {
      const top = mostUsed.map((t) => items.find((i) => i.id === t.id)).filter((i) => i !== undefined);
      const rest = items.filter((i) => i.kind === 'service' && !top.includes(i));
      return [...top, ...rest].slice(0, 9);
    }
    return items
      .map((i) => ({ i, s: score(i.hay, i.name, query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 9)
      .map((x) => x.i);
  });

  $effect(() => {
    if (open) {
      q = '';
      active = 0;
      tick().then(() => input?.focus());
    }
  });
  $effect(() => { q; active = 0; });

  function go(item, newTab = false) {
    if (!item?.href) return;
    if (item.kind === 'service') onopen?.(item.id);
    open = false;
    if (item.kind === 'page' && !newTab) location.assign(item.href);
    else window.open(item.href, newTab ? '_blank' : target, 'noopener');
  }

  function key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, results.length); scroll(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + results.length) % Math.max(1, results.length); scroll(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active], e.metaKey || e.ctrlKey); }
    else if (e.key === 'Escape') { e.preventDefault(); open = false; }
  }
  function scroll() {
    tick().then(() => list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

{#if open}
  <div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && (open = false)}>
    <div class="panel" role="dialog" aria-modal="true" aria-label="Search services">
      <div class="search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <label class="sr" for="palette-q">Search services and links</label>
        <input
          id="palette-q"
          bind:this={input}
          bind:value={q}
          onkeydown={key}
          placeholder="Search services and links…"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="go"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? 'pi-' + results[active].id : undefined}
        />
        <button class="esc" onclick={() => (open = false)} aria-label="Close search">esc</button>
      </div>
      <div class="label">{q.trim() ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'Most used & services'}</div>
      <ul id="palette-list" role="listbox" bind:this={list}>
        {#each results as r, i (r.id)}
          <li id={'pi-' + r.id} role="option" aria-selected={i === active}>
            <a
              href={r.href}
              target={r.kind === 'page' ? undefined : target}
              rel="noopener"
              class:active={i === active}
              onmousemove={() => (active = i)}
              onclick={() => { if (r.kind === 'service') onopen?.(r.id); open = false; }}
            >
              <span class="ic">
                {#if r.icon}<Icon src={r.icon} dark={r.iconDark} name={r.name} size={22} />
                {:else}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>{/if}
              </span>
              <span class="name">{r.name}</span>
              <span class="mono sub">{r.sub}</span>
              {#if r.level}<span class="dot lv-{r.level}"></span>{/if}
            </a>
          </li>
        {:else}
          <li class="empty">No match for “{q}”</li>
        {/each}
      </ul>
      <div class="mono hints"><span>↑↓ navigate</span><span>↵ open</span><span>⌘/Ctrl ↵ new tab</span><span>esc close</span></div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 50; background: var(--scrim);
    display: flex; justify-content: center; align-items: flex-start;
    padding: max(12vh, 24px) 16px 16px; backdrop-filter: blur(2px);
    animation: fade 0.12s ease-out;
  }
  .panel {
    width: 100%; max-width: 620px; background: var(--surface); border: 1px solid var(--line);
    border-radius: 18px; box-shadow: var(--shadow-lg); overflow: hidden;
    animation: rise 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .search { display: flex; align-items: center; gap: 10px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--line); color: var(--muted); }
  input { flex: 1; min-width: 0; min-height: 56px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 16px; outline: none; }
  .esc { border: 0; border-radius: 6px; background: var(--surface-2); color: var(--muted); min-height: 28px; min-width: 44px; font-size: 11px; cursor: pointer; }
  .label { font-size: 11px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); padding: 12px 18px 4px; }
  ul { list-style: none; margin: 0; padding: 4px 8px 8px; max-height: min(420px, 55vh); overflow: auto; }
  a { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 10px; min-height: 46px; }
  a.active { background: var(--surface-2); }
  .ic { width: 30px; height: 30px; border-radius: 9px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  a.active .ic { background: var(--surface); }
  .name { flex: 1; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
  .empty { padding: 20px 10px; color: var(--muted); text-align: center; }
  .hints { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 10px 16px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); }
  @media (hover: none) { .hints { display: none; } }
  /* phones, also in landscape: pinned under the status bar (and clear of the notch) so the keyboard never covers the results */
  @media (max-width: 760px), (max-height: 500px) and (pointer: coarse) {
    .scrim { padding: max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) 10px max(10px, env(safe-area-inset-left)); }
    .panel { border-radius: 20px; }
    ul { max-height: 50dvh; }
    a { min-height: 52px; }
  }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
</style>
