// What the pages decide without the DOM: small pure functions, tested with node (logic.test.ts).
import type { Snapshot } from '#lib/types';

/** The services whose level changed between two snapshots, and 'verdict' when the verdict's did: what the page flashes. */
export function changes(prev: Snapshot, next: Snapshot): string[] {
  const was = new Map(prev.groups.flatMap((g) => g.services).map((t) => [t.id, t.level]));
  const ids = next.groups.flatMap((g) => g.services).filter((t) => was.has(t.id) && was.get(t.id) !== t.level).map((t) => t.id);
  if (prev.verdict.level !== next.verdict.level) ids.push('verdict');
  return ids;
}

export type View = 'home' | 'services' | 'alerts';
/**
 * Phones: what a tap on a tab does to history. Leaving Home adds an entry (`push`), so back returns to Home and then
 * leaves the app; switching between the other two replaces it (`replace`); going Home steps back onto that entry
 * (`back`) or, when the view was not entered from Home (a link by hash), clears the state (`reset`). The current
 * view's own tab scrolls to the top (`stay`).
 */
export function viewStep(current: View, to: View, pushed: boolean): 'stay' | 'back' | 'reset' | 'push' | 'replace' {
  if (to === current) return 'stay';
  if (to === 'home') return pushed ? 'back' : 'reset';
  return current === 'home' ? 'push' : 'replace';
}

/**
 * How well a palette item matches a query (both lowercased by the caller, except `name`): the name starts with it
 * (shorter names first), a word of the name does, the item's text contains it, or its letters appear in the name in
 * order ("pxm" → "proxmox"); -1 when it doesn't match.
 */
export function score(hay: string, name: string, query: string): number {
  const n = name.toLowerCase();
  if (n.startsWith(query)) return 100 - n.length / 100;
  if (n.split(/[\s\-!]+/).some((w) => w.startsWith(query))) return 80;
  if (hay.includes(query)) return 60;
  let i = 0;
  for (const c of n) if (c === query[i]) i++;
  return i === query.length ? 30 : -1;
}

/** Rows grouped by `group`, groups and rows in the order they come. */
export function grouped<T extends { group: string }>(rows: T[]): { name: string; rows: T[] }[] {
  const out: { name: string; rows: T[] }[] = [];
  for (const r of rows) {
    const g = out.find((x) => x.name === r.group);
    if (g) g.rows.push(r); else out.push({ name: r.group, rows: [r] });
  }
  return out;
}

/** How a trend moved up to `now`: first and last reading, and the change, e.g. "24 h: 61.0% → 62.2% (+1.2)". */
export function moved(t: { values: (number | null)[]; from: number } | null, unit: string, now: number): { text: string; delta: number } | null {
  const vs = t?.values.filter((v): v is number => v != null) ?? [];
  if (!t || vs.length < 2) return null;
  const a = vs[0], b = vs[vs.length - 1], h = Math.max(1, Math.round((now - t.from) / 3_600_000));
  const d = b - a;
  return { delta: d, text: `${h} h: ${a.toFixed(1)}${unit} → ${b.toFixed(1)}${unit} (${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)})` };
}
