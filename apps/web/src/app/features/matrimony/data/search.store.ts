import { computed } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import type { Diet, ProfileSearchQuery } from '@eventhub/contracts';

interface SearchState {
  filters: ProfileSearchQuery;
  page: number;
}

const initial: SearchState = {
  filters: { sort: 'recent' },
  page: 1,
};

/**
 * The second and last SignalStore in the application.
 *
 * It earns its place for one reason: these filters have to survive
 * back-navigation. A family narrows a search over several minutes - community,
 * city, age band, gotra exclusions - then opens a profile, then comes back.
 * Losing that on the way back is the difference between a usable product and an
 * infuriating one, and component state cannot outlive the component.
 *
 * Everything else in this feature is a plain signal or an httpResource.
 */
export const MatrimonySearchStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed(({ filters }) => ({
    /** How many filters are narrowing the results, for the "clear" affordance. */
    activeFilterCount: computed(
      () =>
        Object.entries(filters()).filter(
          ([key, value]) =>
            key !== 'sort' &&
            value !== undefined &&
            value !== '' &&
            !(Array.isArray(value) && value.length === 0),
        ).length,
    ),
    excludedGotras: computed(() => filters().excludeGotras ?? []),
  })),
  withMethods((store) => ({
    /** Any filter change returns to page one; page 3 of a new search is noise. */
    setFilter<K extends keyof ProfileSearchQuery>(
      key: K,
      value: ProfileSearchQuery[K],
    ): void {
      const next = { ...store.filters() };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      patchState(store, { filters: next, page: 1 });
    },

    addExcludedGotra(gotra: string): void {
      const trimmed = gotra.trim();
      if (!trimmed) return;
      const current = store.filters().excludeGotras ?? [];
      if (current.some((g) => g.toLowerCase() === trimmed.toLowerCase())) return;

      patchState(store, {
        filters: { ...store.filters(), excludeGotras: [...current, trimmed] },
        page: 1,
      });
    },

    removeExcludedGotra(gotra: string): void {
      patchState(store, {
        filters: {
          ...store.filters(),
          excludeGotras: (store.filters().excludeGotras ?? []).filter(
            (g) => g !== gotra,
          ),
        },
        page: 1,
      });
    },

    setDiet(diet: Diet | undefined): void {
      const next = { ...store.filters() };
      if (diet) next.diet = diet;
      else delete next.diet;
      patchState(store, { filters: next, page: 1 });
    },

    setPage(page: number): void {
      patchState(store, { page: Math.max(1, page) });
    },

    clear(): void {
      patchState(store, initial);
    },
  })),
);
