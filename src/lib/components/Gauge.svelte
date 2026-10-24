<script>
  import Sparkline from './Sparkline.svelte';
  let { g } = $props();
  const R = 34;
  const C = 2 * Math.PI * R;
  const pct = $derived(Math.max(0, Math.min(100, g.pct ?? 0)));
  const dash = $derived(`${((pct / 100) * C).toFixed(1)} ${C.toFixed(1)}`);
</script>

<div class="gauge lv-{g.level}">
  <div class="ring">
    <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label="{g.label} {g.val} {g.unit}">
      <circle cx="42" cy="42" r={R} fill="none" stroke="var(--track)" stroke-width="7" />
      <circle class="arc" cx="42" cy="42" r={R} fill="none" stroke-width="7" stroke-linecap="round" stroke-dasharray={dash} transform="rotate(-90 42 42)" />
    </svg>
    <div class="val">
      <span class="mono num">{g.val}</span>
      <span class="mono unit">{g.unit}</span>
    </div>
  </div>
  <span class="label">{g.label}</span>
  <span class="mono sub">{g.sub ?? ''}</span>
  <div class="spark">
    {#if g.series}<Sparkline values={g.series} max={g.max} min={g.max ? 0 : null} color="var(--arc)" label="{g.label}, last 24 hours" />{/if}
  </div>
</div>

<!-- phones: compact card (no ring, no sparkline); the two variants switch by media query -->
<div class="mini lv-{g.level}" role="img" aria-label="{g.label} {g.val} {g.unit}{g.sub ? ', ' + g.sub : ''}">
  <div class="mini-head"><span class="label">{g.label}</span><span class="mono sub">{g.sub?.replace(/ threads$/, ' thr') ?? ''}</span></div>
  <div class="mini-val"><span class="mono">{g.val}</span><span class="mono unit">{g.unit}</span></div>
  <div class="bar"><div style:width="{pct}%"></div></div>
</div>

<style>
  .gauge {
    --arc: var(--acc);
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 14px 10px 10px; border-radius: 16px; background: var(--surface-2); min-width: 0;
  }
  .gauge.lv-warn, .gauge.lv-crit { --arc: var(--lv); }
  .arc { stroke: var(--arc); transition: stroke-dasharray 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .ring { position: relative; width: 84px; height: 84px; }
  .val { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .num { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }
  .unit { font-size: 10px; color: var(--muted); max-width: 64px; text-align: center; line-height: 1.1; }
  .label { font-size: 12px; font-weight: 500; }
  .sub { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .spark { width: 100%; height: 24px; }

  .mini { display: none; }
  @media (max-width: 760px) {
    .gauge { display: none; }
    .mini {
      --arc: var(--acc);
      display: flex; flex-direction: column; gap: 6px; min-width: 0;
      padding: 14px; border-radius: 16px; background: var(--surface); box-shadow: var(--shadow);
    }
    .mini.lv-warn, .mini.lv-crit { --arc: var(--lv); }
    .mini-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .mini .label { font-size: 13px; flex: none; }
    .mini .sub { min-width: 0; }
    .mini-val { display: flex; align-items: baseline; gap: 5px; min-width: 0; white-space: nowrap; }
    .mini-val > :first-child { font-size: 24px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.15; }
    .mini-val .unit { font-size: 12px; max-width: none; overflow: hidden; text-overflow: ellipsis; }
    .bar { height: 6px; border-radius: 4px; background: var(--track); overflow: hidden; margin-top: 2px; }
    .bar > div { height: 100%; border-radius: 4px; background: var(--arc); transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
  }
</style>
