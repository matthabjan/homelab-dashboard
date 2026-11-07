// What's Up Docker (WUD) — same fields as homepage (url, username, password); basic auth only when WUD has it on.
// Reads which watched containers have a newer image; each one is a note in Activity, like apt updates.
import { trimUrl, basicAuth } from '../http.ts';
import { card, plural } from '../format.ts';
import type { Alert, Context, Stat, Widget, WidgetResult } from '$lib/types';

/** An entry of GET /api/containers, the fields read here. */
export interface WudContainer {
  id: string;
  name: string;
  displayName?: string;
  /** the WUD watcher (Docker host) that sees it, "local" by default */
  watcher?: string;
  image?: { name?: string; tag?: { value?: string } };
  updateAvailable?: boolean;
  /** tag: a newer tag; digest: the same tag points to a new image */
  updateKind?: { kind?: 'tag' | 'digest' | 'unknown'; localValue?: string; remoteValue?: string; semverDiff?: string };
  /** the last registry lookup failed */
  error?: { message?: string };
}

/** "1.2.3 → 1.3.0 (minor)", or "new image for :latest" when only the digest changed. */
function whatChanged(c: WudContainer) {
  const k = c.updateKind;
  if (k?.kind === 'tag' && k.localValue && k.remoteValue) return `${k.localValue} → ${k.remoteValue}${k.semverDiff && k.semverDiff !== 'unknown' ? ` (${k.semverDiff})` : ''}`;
  const tag = c.image?.tag?.value;
  return tag ? `new image for :${tag}` : 'new image';
}

export async function collect(w: Widget, ctx: Context): Promise<WidgetResult> {
  const auth: Record<string, string> = w.username != null || w.password != null ? { Authorization: basicAuth(w.username, w.password) } : {};
  const list = await ctx.getJson<WudContainer[]>(`${trimUrl(w.url)}/api/containers`, { headers: auth, insecure: ctx.insecure });
  if (!Array.isArray(list)) throw new Error('Unexpected answer from /api/containers');

  const updates = list.filter((c) => c.updateAvailable).sort((a, b) => a.name.localeCompare(b.name));
  const failed = list.filter((c) => c.error);
  // the name is unique per watcher, and stays when the container is recreated, so a note keeps its age
  const alerts: Alert[] = updates.map((c) => ({ sev: 'info', key: `update-${c.watcher ?? 'local'}-${c.name}`, title: `Update available for ${c.displayName || c.name}`, detail: whatChanged(c) }));

  const facts: [Stat, string][] = [
    [{ k: 'updates', v: String(updates.length) }, updates.length ? `${plural(updates.length, 'update')} available` : 'Up to date'],
    [{ k: 'watched', v: String(list.length) }, `${list.length} watched`]
  ];
  // the error text comes from the registry, so only the count is shown
  if (failed.length) facts.push([{ k: 'lookup errors', v: String(failed.length) }, plural(failed.length, 'lookup error')]);
  return { ...card(facts), alerts };
}
