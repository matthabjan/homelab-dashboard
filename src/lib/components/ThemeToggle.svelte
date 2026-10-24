<script>
  import { onMount } from 'svelte';

  const OPTIONS = [
    { id: 'system', label: 'System theme', d: 'M3 5h18v11H3zM8 20h8M12 16v4' },
    { id: 'light', label: 'Light theme', d: 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
    { id: 'dark', label: 'Dark theme', d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z' }
  ];
  let current = $state('system');

  onMount(() => {
    current = document.documentElement.dataset.theme || 'system';
  });

  function pick(id) {
    current = id;
    document.documentElement.dataset.theme = id;
    try { localStorage.setItem('theme', id); } catch {}
  }
</script>

<div class="toggle" role="radiogroup" aria-label="Theme">
  {#each OPTIONS as o}
    <button role="radio" aria-checked={current === o.id} aria-label={o.label} title={o.label} class:on={current === o.id} onclick={() => pick(o.id)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={o.d} /></svg>
    </button>
  {/each}
</div>

<style>
  .toggle { display: flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--surface-2); }
  button {
    width: 36px; height: 34px; border: 0; border-radius: 9px; background: transparent; color: var(--muted);
    display: flex; align-items: center; justify-content: center; cursor: pointer;
  }
  button:hover { color: var(--text); }
  button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
</style>
