import { getEngine } from '$lib/server/engine.js';

getEngine().start();

export async function handle({ event, resolve }) {
  const theme = getEngine().cfg?.settings?.theme;
  const def = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  return resolve(event, {
    // server-side default theme; the inline script in app.html overrides it with the viewer's choice
    transformPageChunk: ({ html }) => html.replace('data-theme="system"', `data-theme="${def}" data-default-theme="${def}"`)
  });
}
