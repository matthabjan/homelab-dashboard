<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { fly } from 'svelte/transition';

  // Details on demand: a modal side panel on desktop, a bottom sheet on phones. The native <dialog> brings focus
  // handling, Esc, Android's back gesture and the backdrop; a click on the backdrop closes it too. On phones the
  // sheet has no X: it opens part of the way up and follows the finger, up to the full height and down to any height
  // or closed in one pull, and its handle is a button that closes it, the tap alternative to the drag (WCAG 2.5.7).
  // Sheets stack: a deeper level slides in from the right with a back button to the one below. Esc and Android's back
  // gesture go up one level (`onback`); the close button, the backdrop and a swipe close them all (`onclose`).
  interface Props {
    open: boolean;
    /** how many levels are open: a change slides the content in from the side it came from */
    depth?: number;
    title: string;
    /** a line under the title */
    sub?: string;
    /** the title of the level below, for the back button; unset on the first level */
    backTo?: string;
    /** phones: open at the full height (a sheet with a lot in it) */
    tall?: boolean;
    onback: () => void;
    onclose: () => void;
    children: Snippet;
  }
  let { open, depth = 1, title, sub, backTo, tall = false, onback, onclose, children }: Props = $props();
  // phones: at the full height, or part of the way up
  let full = $state(false);
  let dialog: HTMLDialogElement | undefined = $state();
  let body: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      full = untrack(() => tall);
      dialog.style.height = '';
      dialog.style.maxHeight = '';
      dialog.style.transform = '';
      dialog.style.transition = '';
      dialog.showModal();
      // the title takes focus, not the close button: a mouse click shouldn't open a sheet with a ring on Close, and a
      // screen reader starts at the title; Tab goes on to Back and Close
      dialog.querySelector<HTMLElement>('#sheet-title')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  });

  // which way the content slides: in from the right going deeper, from the left coming back; to the top either way
  let prev = 1;
  let dir = $state(1);
  $effect.pre(() => {
    const d = depth;
    untrack(() => {
      dir = d >= prev ? 1 : -1;
      if (d !== prev && body) body.scrollTop = 0;
      prev = d;
    });
  });
  const reduce = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // dragging (phones only), one fluid gesture. The sheet's top edge follows the finger: above where it started the
  // sheet grows (up to the full height), below it slides down. Letting go, the sheet carries on with the finger's speed
  // for a moment and stays where that lands: closed when that is under a third of where it opened or past the bottom
  // (or on a quick flick down),
  // full when it is near the top, otherwise at that height. A pull starts on a downward move with the content
  // scrolled to the top, or an upward one while the sheet isn't full; any other move scrolls the content
  $effect(() => {
    const d = dialog;
    if (!d) return;
    const phone = window.matchMedia('(max-width: 760px)');
    let start: { y: number; h: number } | null = null;
    let dragging = false;
    let maxH = 0;
    let vis = 0;
    // the last moments of the move, for the speed when letting go
    let trail: { y: number; t: number }[] = [];
    // the room above the sheet at full height, as the CSS leaves it: 20 px and the notch
    const fullHeight = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
      document.body.append(probe);
      const inset = probe.offsetHeight;
      probe.remove();
      return window.innerHeight - 20 - inset;
    };
    const motion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
    const down = (e: TouchEvent) => {
      if (!phone.matches || e.touches.length !== 1) return;
      start = { y: e.touches[0].clientY, h: d.offsetHeight };
      dragging = false;
      trail = [{ y: e.touches[0].clientY, t: performance.now() }];
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const y = e.touches[0].clientY;
      const dy = y - start.y;
      if (!dragging) {
        if (Math.abs(dy) <= 6) return;
        maxH = fullHeight();
        const grow = dy < 0 && start.h < maxH - 2;
        const pull = dy > 0 && (body?.scrollTop ?? 0) <= 0;
        if (!grow && !pull) { start = null; return; }
        dragging = true;
        d.style.transition = 'none';
        d.style.maxHeight = 'none';
      }
      e.preventDefault();
      const now = performance.now();
      trail.push({ y, t: now });
      while (trail.length > 2 && now - trail[0].t > 100) trail.shift();
      vis = Math.min(maxH, start.h - dy);
      if (vis >= start.h) { d.style.height = `${vis}px`; d.style.transform = ''; }
      else { d.style.height = `${start.h}px`; d.style.transform = `translateY(${start.h - vis}px)`; }
    };
    const up = () => {
      const s = start;
      start = null;
      if (!s || !dragging) return;
      dragging = false;
      const first = trail[0], last = trail[trail.length - 1];
      // px per ms, positive downwards
      const speed = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      const lands = vis - speed * 220;
      const opened = Math.min(maxH, Math.max(s.h, 160));
      // a quick flick down closes from any height, as a long pull does
      if (lands < opened / 3 || lands < 120 || (speed > 0.8 && s.h - vis > 40)) {
        // closed: slide out from where it is
        const gone = () => { onclose(); };
        if (!motion()) return gone();
        d.style.transition = `transform 0.2s ${EASE}`;
        d.style.transform = `translateY(${d.offsetHeight}px)`;
        setTimeout(gone, 200);
        return;
      }
      const to = maxH - lands < 72 ? maxH : Math.min(maxH, lands);
      full = to >= maxH;
      // from what is shown now (its height, no offset) to where it lands, as one movement
      d.style.transition = 'none';
      d.style.height = `${vis}px`;
      d.style.transform = '';
      void d.offsetHeight;
      d.style.transition = motion() ? `height 0.26s ${EASE}` : '';
      d.style.height = `${to}px`;
    };
    d.addEventListener('touchstart', down, { passive: true });
    d.addEventListener('touchmove', move, { passive: false });
    d.addEventListener('touchend', up);
    d.addEventListener('touchcancel', up);
    return () => {
      d.removeEventListener('touchstart', down);
      d.removeEventListener('touchmove', move);
      d.removeEventListener('touchend', up);
      d.removeEventListener('touchcancel', up);
    };
  });
</script>

<!-- Esc and the back gesture (cancel) go up a level; the dialog closing any other way closes all -->
<dialog
  bind:this={dialog} class="sheet" class:full aria-labelledby="sheet-title"
  oncancel={(e) => { e.preventDefault(); onback(); }}
  onclose={() => { if (open) onclose(); }}
  onclick={(e) => { if (e.target === dialog) onclose(); }}
>
  <div class="body" bind:this={body}>
    <button class="grabber" onclick={onclose} aria-label={backTo ? 'Close all' : 'Close'}><span></span></button>
    <header>
      <div class="ttl">
        {#if backTo}
          <button class="back" onclick={onback}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            <span class="vh">Back to </span>{backTo}
          </button>
        {/if}
        <h2 id="sheet-title" tabindex="-1">{title}</h2>
        {#if sub}<p class="muted">{sub}</p>{/if}
      </div>
      <button class="close" onclick={onclose} aria-label={backTo ? 'Close all' : 'Close'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>
    {#if open}
      {#key depth}
        <div class="level" in:fly={{ x: dir * 28, duration: reduce() || (depth === 1 && dir === 1) ? 0 : 220, opacity: 0 }}>{@render children()}</div>
      {/key}
    {/if}
  </div>
</dialog>

<style>
  .sheet {
    margin: 12px 12px 12px auto; padding: 0; width: min(520px, calc(100vw - 24px)); height: calc(100dvh - 24px); max-height: none;
    border: 0; border-radius: 24px; background: var(--surface); color: var(--text); box-shadow: var(--shadow-lg);
  }
  .sheet::backdrop { background: rgba(10, 13, 18, 0.36); }
  .body { height: 100%; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 22px 24px 28px; display: flex; flex-direction: column; gap: 18px; }
  header { display: flex; align-items: flex-start; gap: 12px; }
  .ttl { flex: 1; min-width: 0; }
  h2 { font-size: 21px; font-weight: 700; letter-spacing: -0.015em; }
  h2:focus { outline: none; }
  .ttl p { margin: 2px 0 0; font-size: 13px; }
  .close { flex: none; width: 40px; height: 40px; border: 0; border-radius: 12px; background: var(--surface-2); color: var(--text); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .close:hover { background: var(--surface-3); }
  .level { display: flex; flex-direction: column; gap: inherit; min-width: 0; }
  .back {
    display: inline-flex; align-items: center; gap: 2px; margin: -4px 0 4px -6px; padding: 4px 8px 4px 4px; min-height: 32px;
    border: 0; border-radius: 8px; background: none; color: var(--acc); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  }
  .back:hover { background: var(--surface-2); }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .grabber { display: none; }
  @media (prefers-reduced-motion: no-preference) {
    .sheet[open] { animation: in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }
    @keyframes in { from { transform: translateX(24px); opacity: 0; } }
  }
  /* phones: a bottom sheet */
  @media (max-width: 760px) {
    /* as tall as its content up to three quarters of the screen; `full` after a drag up, or from the start (`tall`) */
    .sheet { margin: auto 0 0; width: 100vw; max-width: 100vw; height: auto; max-height: 76dvh; border-radius: 26px 26px 0 0; }
    .sheet.full { height: calc(100dvh - 20px - env(safe-area-inset-top)); max-height: none; }
    .body { padding: 0 16px calc(24px + env(safe-area-inset-bottom)); gap: 14px; }
    .close { display: none; }
    /* the handle: what drags, and a button that closes; the sheet itself follows the finger */
    .grabber { display: flex; align-items: center; justify-content: center; flex: none; width: 100%; height: 30px; margin-bottom: -8px; padding: 0; border: 0; background: none; cursor: grab; }
    .grabber span { width: 40px; height: 5px; border-radius: 3px; background: var(--muted); opacity: 0.45; }
    .grabber:focus-visible { outline: 0; }
    .grabber:focus-visible span { opacity: 1; background: var(--acc); }
    @media (prefers-reduced-motion: no-preference) { .sheet { transition: height 0.24s cubic-bezier(0.2, 0.8, 0.2, 1); } }
    @media (prefers-reduced-motion: no-preference) {
      .sheet[open] { animation: up 0.24s cubic-bezier(0.2, 0.8, 0.2, 1); }
      @keyframes up { from { transform: translateY(32px); opacity: 0; } }
    }
  }
</style>
