import { getEngine } from '$lib/server/engine.js';

export function load() {
  return { snapshot: getEngine().snapshot };
}
