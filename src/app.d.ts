import type { SheetRef } from '$lib/types';

declare global {
  namespace App {
    /** shallow routing: the sheets open over the page, outermost first; each level is a history entry */
    interface PageState {
      sheets?: SheetRef[];
      /** phones: which of the dashboard's views shows (home when unset) */
      view?: 'home' | 'services' | 'alerts';
      /** the view was entered from Home with its own history entry, so Home is one step back */
      viewPushed?: boolean;
      /** Setup: the service whose details sheet is open */
      setup?: string;
    }
  }
}

export {};
