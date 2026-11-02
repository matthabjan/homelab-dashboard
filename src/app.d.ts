import type { SheetRef } from '$lib/types';

declare global {
  namespace App {
    /** shallow routing: the sheets open over the page, outermost first; each level is a history entry */
    interface PageState {
      sheets?: SheetRef[];
    }
  }
}

export {};
