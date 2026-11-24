<script lang="ts" module>
  // The app's line icons, by name: 24 × 24, drawn with the text colour. Service icons are images (Icon.svelte).
  const GLYPHS = {
    /** leaves the dashboard: a link to a service */
    out: '<path d="M7 17 17 7M9 7h8v8" />',
    'out-wide': '<path d="M7 17 17 7M8 7h9v9" />',
    right: '<path d="m9 6 6 6-6 6" />',
    down: '<path d="m6 9 6 6 6-6" />',
    left: '<path d="m15 18-6-6 6-6" />',
    close: '<path d="M6 6l12 12M18 6 6 18" />',
    search: '<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />',
    /** the four severities of an event or alert */
    crit: '<path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />',
    warn: '<path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
    info: '<path d="M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
    ok: '<path d="M20 6 9 17l-5-5" />',
    /** a tile's details button */
    details: '<circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" />',
    /** the verdict's mark */
    check: '<path d="m5 12.5 4.5 4.5L19 7.5" />',
    bang: '<path d="M12 7v6M12 17h.01" />',
    setup: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" />',
    'setup-row': '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />',
    home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4" />'
  } as const;
  export type GlyphName = keyof typeof GLYPHS;
</script>

<script lang="ts">
  interface Props {
    /** which icon; or `d`, a path of one's own */
    name?: GlyphName;
    d?: string;
    /** width and height in px */
    size?: number;
    /** stroke width */
    stroke?: number;
    /** no size or stroke of its own: the parent's CSS draws it (`:global(svg)`) */
    bare?: boolean;
    class?: string;
  }
  let { name, d, size = 16, stroke = 2, bare = false, class: cls }: Props = $props();
  // the bodies are the constants above (or a path's `d`, set as an attribute), never data
  const body = $derived(name ? GLYPHS[name] : '');
</script>

{#if bare}
  <svg class={cls} viewBox="0 0 24 24" aria-hidden="true">{#if d}<path {d} />{:else}{@html body}{/if}</svg>
{:else}
  <svg class={cls} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{#if d}<path {d} />{:else}{@html body}{/if}</svg>
{/if}
