<script lang="ts">
  import type { Snippet } from 'svelte';

  // Details on demand: a modal side panel on desktop, a bottom sheet on phones. The native <dialog> brings focus
  // handling, Esc, Android's back gesture and the backdrop; a click on the backdrop closes it too. On phones the
  // sheet can also be swiped down; the close button stays, as the tap alternative to the drag (WCAG 2.5.7).
  interface Props {
    open: boolean;
    title: string;
    /** a line under the title */
    sub?: string;
    children: Snippet;
  }
  let { open = $bindable(), title, sub, children }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let body: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.style.transform = '';
      dialog.style.transition = '';
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  // swipe down to close (phones only): starts when the content is scrolled to the top, follows the finger, and
  // closes past a quarter of the sheet's height or on a quick flick; otherwise the sheet snaps back
  $effect(() => {
    const d = dialog;
    if (!d) return;
    const phone = window.matchMedia('(max-width: 760px)');
    let start: { y: number; t: number } | null = null;
    let dy = 0;
    let dragging = false;
    const settle = (to: string, then?: () => void) => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      d.style.transition = reduce ? '' : 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
      d.style.transform = to;
      if (then) (reduce ? then() : setTimeout(then, 200));
    };
    const down = (e: TouchEvent) => {
      if (!phone.matches || e.touches.length !== 1) return;
      start = { y: e.touches[0].clientY, t: e.timeStamp };
      dy = 0;
      dragging = false;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      dy = e.touches[0].clientY - start.y;
      if (!dragging) {
        // a pull down from the top drags the sheet; anything else scrolls as usual
        if (dy > 6 && (body?.scrollTop ?? 0) <= 0) dragging = true;
        else if (Math.abs(dy) > 6) { start = null; return; }
        else return;
      }
      e.preventDefault();
      d.style.transition = '';
      d.style.transform = `translateY(${Math.max(0, dy)}px)`;
    };
    const up = (e: TouchEvent) => {
      if (!start || !dragging) { start = null; return; }
      const fast = dy / Math.max(1, e.timeStamp - start.t) > 0.5;
      start = null;
      if (dy > d.offsetHeight / 4 || (fast && dy > 30)) settle('translateY(100%)', () => (open = false));
      else settle('');
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

<dialog bind:this={dialog} class="sheet" aria-labelledby="sheet-title" onclose={() => (open = false)} onclick={(e) => { if (e.target === dialog) open = false; }}>
  <div class="body" bind:this={body}>
    <span class="grabber" aria-hidden="true"></span>
    <header>
      <div class="ttl">
        <h2 id="sheet-title">{title}</h2>
        {#if sub}<p class="muted">{sub}</p>{/if}
      </div>
      <button class="close" onclick={() => (open = false)} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>
    {#if open}{@render children()}{/if}
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
  .ttl p { margin: 2px 0 0; font-size: 13px; }
  .close { flex: none; width: 40px; height: 40px; border: 0; border-radius: 12px; background: var(--surface-2); color: var(--text); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .close:hover { background: var(--surface-3); }
  .grabber { display: none; }
  @media (prefers-reduced-motion: no-preference) {
    .sheet[open] { animation: in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }
    @keyframes in { from { transform: translateX(24px); opacity: 0; } }
  }
  /* phones: a bottom sheet */
  @media (max-width: 760px) {
    .sheet { margin: auto 0 0; width: 100vw; max-width: 100vw; height: auto; max-height: 88dvh; border-radius: 22px 22px 0 0; }
    .body { padding: 8px 16px calc(24px + env(safe-area-inset-bottom)); gap: 14px; }
    /* the swipe affordance; the sheet itself is what drags */
    .grabber { display: block; flex: none; align-self: center; width: 36px; height: 5px; border-radius: 3px; background: var(--muted); opacity: 0.45; margin-bottom: 2px; }
    @media (prefers-reduced-motion: no-preference) {
      .sheet[open] { animation: up 0.24s cubic-bezier(0.2, 0.8, 0.2, 1); }
      @keyframes up { from { transform: translateY(32px); opacity: 0; } }
    }
  }
</style>
