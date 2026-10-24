import { getEngine } from '$lib/server/engine.js';
import { assetUrl } from '$lib/server/config.js';

export function load() {
  const { settings } = getEngine().cfg;
  return {
    meta: {
      title: settings.title,
      theme: ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system',
      accent: /^#[0-9a-f]{3,8}$/i.test(settings.accent) ? settings.accent : '#4F8DF7',
      favicon: assetUrl(settings.pwa.favicon),
      appleTouchIcon: assetUrl(settings.pwa.appleTouchIcon)
    }
  };
}
