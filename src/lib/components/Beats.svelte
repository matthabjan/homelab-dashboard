<script>
  /** 24 h health ribbon: 48 half-hour buckets ending at `end`. Healthy ones form one quiet ribbon; a degraded or down one stands taller in its colour. */
  /** @import { Level } from '$lib/types' */
  /** `note` is added to every slot's tooltip (e.g. the uptime), so hovering anywhere on the strip shows it */
  /** @type {{ beats: (Level | 'none')[], end: number, label: string, note?: string }} */
  let { beats, end, label, note = '' } = $props();

  const B = 1_800_000;
  const WORD = { ok: 'all up', warn: 'degraded', crit: 'outage', none: 'no data' };
  const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const slot = (i) => {
    const e = end - (beats.length - 1 - i) * B;
    return `${hm(e - B)}–${hm(e)}`;
  };
</script>

<!-- the parent sets the height with --beats-h -->
<div class="strip" role="img" aria-label={label}>
  {#each beats as b, i}<span class="lv-{b}" title="{slot(i)} · {WORD[b]}{note ? `\n${note}` : ''}"></span>{/each}
</div>

<style>
  .strip { display: flex; align-items: flex-end; height: var(--beats-h, 20px); }
  .strip span { flex: 1; height: 40%; background: var(--lv); transition: height 0.15s, opacity 0.15s; }
  .strip span:first-child { border-radius: 4px 0 0 4px; }
  .strip span:last-child { border-radius: 0 4px 4px 0; }
  .strip .lv-ok { opacity: 0.55; }
  .strip .lv-warn, .strip .lv-crit { height: 100%; border-radius: 3px; margin: 0 1px; }
  .strip .lv-none { opacity: 0.6; }
  .strip span:hover { opacity: 1; height: 100%; }
</style>
