<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  onMount(() => {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/service-worker.js', { type: 'module' }).catch(() => {});
    }
  });
</script>

<svelte:head>
  <title>{data.meta.title}</title>
  <!-- with a dark variant, the browser picks by its own theme (the tab strip's, not the page's) -->
  {#if data.meta.favicon}<link rel="icon" href={data.meta.favicon} media={data.meta.faviconDark ? '(prefers-color-scheme: light)' : undefined} />{/if}
  {#if data.meta.faviconDark}<link rel="icon" href={data.meta.faviconDark} media="(prefers-color-scheme: dark)" />{/if}
  {#if data.meta.appleTouchIcon}<link rel="apple-touch-icon" href={data.meta.appleTouchIcon} />{/if}
  <meta name="apple-mobile-web-app-title" content={data.meta.title} />
  {@html `<style>:root{--accent:${data.meta.accent};--accent-dark:${data.meta.accent}}</style>`}
</svelte:head>

{@render children()}
