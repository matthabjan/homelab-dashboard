<script lang="ts">
  import { onMount } from 'svelte';

  type Theme = 'system' | 'light' | 'dark';

  // The theme switch in the header: one button that steps through system, light and dark, showing the current one.

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

<button class="step" aria-label="{opt.label}. Switch to {next.label.toLowerCase()}" title="{opt.label} · switch to {next.label.toLowerCase()}" onclick={() => pick(next.id)}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={opt.d} /></svg>
</button>

<style>
  /* the same size and look as its neighbours in the header */
  .step { width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); color: var(--text); cursor: pointer; }
  .step:hover { background: var(--surface-2); }
  @media (max-width: 760px) { .step { width: 44px; height: 44px; border-radius: 14px; } }
</style>
