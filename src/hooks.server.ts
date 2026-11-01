import type { Handle } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine.ts';

getEngine().start();

// docker stop (SIGTERM) or Ctrl-C: stop the rounds and end the open streams. The Node adapter then closes the server
// as soon as the last request is done; without this its timers kept the process alive until Docker killed it.
const g = globalThis as typeof globalThis & { __homelabSignals?: boolean };
if (!g.__homelabSignals) {
  g.__homelabSignals = true; // once per process: dev reloads this module on every change
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => getEngine().stop());
}

export const handle: Handle = async ({ event, resolve }) => {
  const theme = getEngine().cfg?.settings?.theme;
  const def = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  return resolve(event, {
    // server-side default theme; the inline script in app.html overrides it with the viewer's choice
    transformPageChunk: ({ html }) => html.replace('data-theme="system"', `data-theme="${def}" data-default-theme="${def}"`)
  });
};
