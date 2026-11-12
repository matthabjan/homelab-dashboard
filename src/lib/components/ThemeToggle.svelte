<script lang="ts">
  import { onMount } from 'svelte';

  type Theme = 'system' | 'light' | 'dark';

  // The theme switch in the header. Desktop: system, light and dark side by side, one click to any. Phones, short of
  // room: one button that shows the current choice and steps to the next.

  const OPTIONS: { id: Theme; label: string; d: string }[] = [
    { id: 'system', label: 'System theme', d: 'M3 5h18v11H3zM8 20h8M12 16v4' },
    { id: 'light', label: 'Light theme', d: 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
    { id: 'dark', label: 'Dark theme', d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z' }
  ];
  let current = $state<string>('system');
  const opt = $derived(OPTIONS.find((o) => o.id === current) ?? OPTIONS[0]);
  const next = $derived(OPTIONS[(OPTIONS.indexOf(opt) + 1) % OPTIONS.length]);

  // --bg per theme: the browser and installed-app chrome (theme-color) follows a manually picked theme too
  const BG = { light: '#f4f5f7', dark: '#0a0d12' };
  function themeColor(id: string) {
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      const own = m.getAttribute('media')?.includes('dark') ? BG.dark : BG.light;
      m.setAttribute('content', id === 'light' || id === 'dark' ? BG[id] : own);
    }
  }

  onMount(() => {
    current = document.documentElement.dataset.theme || 'system';
    themeColor(current);
  });

  function pick(id: Theme) {
    current = id;
    document.documentElement.dataset.theme = id;
    themeColor(id);
    try { localStorage.setItem('theme', id); } catch {}
  }
</script>

<div class="seg only-desktop" role="radiogroup" aria-label="Theme">
  {#each OPTIONS as o (o.id)}
    <button role="radio" aria-checked={current === o.id} aria-label={o.label} title={o.label} onclick={() => pick(o.id)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={o.d} /></svg>
    </button>
  {/each}
</div>
<button class="step only-phone" aria-label="{opt.label}. Switch to {next.label.toLowerCase()}" title="{opt.label} · switch to {next.label.toLowerCase()}" onclick={() => pick(next.id)}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={opt.d} /></svg>
</button>

<style>
  /* both the height of their neighbours in the header */
  .seg { display: flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); }
  .seg button { width: 34px; height: 36px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 9px; background: none; color: var(--muted); cursor: pointer; }
  .seg button:hover { color: var(--text); }
  .seg button[aria-checked='true'] { background: var(--surface-3); color: var(--text); }
  .step { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 14px; background: var(--surface); box-shadow: var(--shadow); color: var(--text); cursor: pointer; }
  .step:active { background: var(--surface-2); }
</style>
