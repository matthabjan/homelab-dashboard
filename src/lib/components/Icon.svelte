<script>
  /** Service/bookmark logo with optional dark-theme variant and a monogram fallback. */
  let { src, dark = null, name = '', size = 24 } = $props();
  const mono = $derived('/assets/monogram/' + encodeURIComponent(name || '?') + '.svg');
  let failed = $state(false);
  let failedDark = $state(false);
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
  onerror={() => (failed = true)}
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
    onerror={() => (failedDark = true)}
  />
{/if}

<style>
  img { object-fit: contain; display: block; }
</style>
