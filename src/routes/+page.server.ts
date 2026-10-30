import type { PageServerLoad } from './$types';
import { getEngine } from '$lib/server/engine.ts';

export const load: PageServerLoad = () => {
  return { snapshot: getEngine().snapshot };
};
