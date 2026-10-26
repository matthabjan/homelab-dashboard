<script>
  /** 24 h health ribbon: 48 half-hour buckets ending at `end`. Healthy ones form one quiet ribbon; a degraded or down one stands taller in its colour. */
  /** @import { Level } from '$lib/types' */
  /**
   * `note` is added to every slot's tooltip (e.g. the uptime), so hovering anywhere on the strip shows it.
   * `onpick` makes the strip touch-scrubbable (tooltips don't exist on touch): it gets the slot under the finger as text, then null shortly after release
   * @type {{ beats: (Level | 'none')[], end: number, label: string, note?: string, onpick?: (text: string | null) => void }}
   */
  let { beats, end, label, note = '', onpick } = $props();

  const B = 1_800_000;
  const WORD = { ok: 'all up', warn: 'degraded', crit: 'outage', none: 'no data' };
  const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const slotEnd = (i) => end - (beats.length - 1 - i) * B;
  const slot = (i) => `${hm(slotEnd(i) - B)}–${hm(slotEnd(i))}`;

  // problem periods (runs of degraded or down half-hours), so screen readers get what the colours show
  const periods = $derived.by(() => {
    const out = [];
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (b !== 'warn' && b !== 'crit') continue;
      let j = i;
      while (beats[j + 1] === b) j++;
      out.push(`${WORD[b]} ${hm(slotEnd(i) - B)}–${hm(slotEnd(j))}`);
      i = j;
    }
    return out;
  });

  let picked = $state(-1);
  let unpick;
  /** @param {PointerEvent & { currentTarget: HTMLElement }} e */
  function pick(e) {
    if (!onpick || e.pointerType === 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.min(beats.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * beats.length)));
    clearTimeout(unpick);
    if (i === picked) return;
    picked = i;
    onpick(`${slot(i)} · ${WORD[beats[i]]}`);
  }
  function release() {
    clearTimeout(unpick);
    unpick = setTimeout(() => { picked = -1; onpick?.(null); }, 2500);
  }
  $effect(() => () => clearTimeout(unpick));
</script>

<!-- the parent sets the height with --beats-h -->
<div
  class="strip"
  class:pick={!!onpick}
  role="img"
  aria-label="{label}{periods.length ? `; ${periods.join(', ')}` : ''}"
  onpointerdown={pick}
  onpointermove={(e) => e.buttons && pick(e)}
  onpointerup={release}
  onpointercancel={release}
>
  {#each beats as b, i}<span class="lv-{b}" class:on={i === picked} title="{slot(i)} · {WORD[b]}{note ? `\n${note}` : ''}"></span>{/each}
</div>

<style>
  .strip { display: flex; align-items: flex-end; height: var(--beats-h, 20px); }
  .strip span { flex: 1; height: 40%; background: var(--lv); transition: height 0.15s, opacity 0.15s; }
  .strip span:first-child { border-radius: 4px 0 0 4px; }
  .strip span:last-child { border-radius: 0 4px 4px 0; }
  .strip .lv-ok { opacity: 0.55; }
  .strip .lv-warn, .strip .lv-crit { height: 100%; border-radius: 3px; margin: 0 1px; }
  .strip .lv-none { opacity: 0.6; }
  /* hover only where it exists: a tap must not leave a slot raised */
  @media (hover: hover) { .strip span:hover { opacity: 1; height: 100%; } }
  /* scrubbing: sideways drags pick a slot, vertical ones still scroll the page */
  .strip.pick { touch-action: pan-y; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  .strip .on { opacity: 1; height: 100%; box-shadow: 0 0 0 1px var(--surface); }
</style>
