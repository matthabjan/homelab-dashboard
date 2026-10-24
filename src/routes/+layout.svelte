<script>
  import '../app.css';
  import { onMount } from 'svelte';
  /** @type {import('./$types').LayoutProps} */
  let { data, children } = $props();

  onMount(() => {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/service-worker.js', { type: 'module' }).catch(() => {});
    }
  });
</script>

<svelte:head>
  <title>{data.meta.title}</title>
  {#if data.meta.favicon}<link rel="icon" href={data.meta.favicon} />{/if}
  {#if data.meta.appleTouchIcon}<link rel="apple-touch-icon" href={data.meta.appleTouchIcon} />{/if}
  <meta name="apple-mobile-web-app-title" content={data.meta.title} />
  {@html `<style>:root{--accent:${data.meta.accent};--accent-dark:${data.meta.accent}}</style>`}
</svelte:head>

{@render children()}
