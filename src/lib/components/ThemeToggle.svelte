<script>
  import { onMount } from 'svelte';

  const OPTIONS = [
    { id: 'system', label: 'System theme', d: 'M3 5h18v11H3zM8 20h8M12 16v4' },
    { id: 'light', label: 'Light theme', d: 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
    { id: 'dark', label: 'Dark theme', d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z' }
  ];
  let current = $state('system');
  const opt = $derived(OPTIONS.find((o) => o.id === current) ?? OPTIONS[0]);

  // --bg per theme: the browser and installed-app chrome (theme-color) follows a manually picked theme too
  const BG = { light: '#f4f5f7', dark: '#0a0d12' };
  function themeColor(id) {
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      const own = m.getAttribute('media')?.includes('dark') ? BG.dark : BG.light;
      m.setAttribute('content', id === 'light' || id === 'dark' ? BG[id] : own);
    }
  }

  onMount(() => {
    current = document.documentElement.dataset.theme || 'system';
    themeColor(current);
  });

  function pick(id) {
    current = id;
    document.documentElement.dataset.theme = id;
    themeColor(id);
    try { localStorage.setItem('theme', id); } catch {}
  }
</script>

<div class="toggle only-desktop" role="radiogroup" aria-label="Theme">
  {#each OPTIONS as o}
    <button role="radio" aria-checked={current === o.id} aria-label={o.label} title={o.label} class:on={current === o.id} onclick={() => pick(o.id)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={o.d} /></svg>
    </button>
  {/each}
</div>
<!-- phones: one button cycling system → light → dark -->
<button class="cycle only-phone" aria-label="{opt.label}, tap to change" title={opt.label} onclick={() => pick(OPTIONS[(OPTIONS.indexOf(opt) + 1) % OPTIONS.length].id)}>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={opt.d} /></svg>
</button>

<style>
  .toggle { display: flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--surface-2); }
  button {
    width: 36px; height: 34px; border: 0; border-radius: 9px; background: transparent; color: var(--muted);
    display: flex; align-items: center; justify-content: center; cursor: pointer;
  }
  button:hover { color: var(--text); }
  .cycle { width: 44px; height: 44px; border-radius: 14px; background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
  button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
</style>
