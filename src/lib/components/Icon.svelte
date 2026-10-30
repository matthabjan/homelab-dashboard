<script lang="ts">
  /** Service/bookmark logo with optional dark-theme variant and a monogram fallback. */
  import type { Attachment } from 'svelte/attachments';

  interface Props {
    src: string | null;
    dark?: string | null;
    name?: string;
    size?: number;
  }
  let { src, dark = null, name = '', size = 24 }: Props = $props();
  const mono = $derived('/assets/monogram/' + encodeURIComponent(name || '?') + '.svg');
  let failed = $state(false);
  let failedDark = $state(false);
  // a new URL (icon fixed in services.yaml, automatic icon found) gets another try
  $effect.pre(() => { void src; failed = false; });
  $effect.pre(() => { void dark; failedDark = false; });

  /**
   * Calls `onfail` when the image can't load. Attached on the client rather than as `onerror`: Svelte renders that as an
   * inline handler (to replay errors from before hydration), which the nonce CSP blocks. So a failure that already
   * happened is caught here instead: a finished image that won't decode is broken.
   */
  const fallback = (onfail: () => void): Attachment<HTMLImageElement> => (img) => {
    if (img.complete) img.decode().catch(onfail);
    img.addEventListener('error', onfail);
    return () => img.removeEventListener('error', onfail);
  };
</script>

<img
  class="on-light"
  class:has-dark={!!dark && !failedDark}
  src={failed ? mono : src}
  alt=""
  width={size}
  height={size}
  loading="lazy"
  decoding="async"
  style:width="{size}px"
  style:height="{size}px"
  {@attach fallback(() => (failed = true))}
/>
{#if dark && !failedDark}
  <img
    class="on-dark"
    src={dark}
    alt=""
    width={size}
    height={size}
    loading="lazy"
    decoding="async"
    style:width="{size}px"
    style:height="{size}px"
    {@attach fallback(() => (failedDark = true))}
  />
{/if}

<style>
  img { object-fit: contain; display: block; }
</style>
