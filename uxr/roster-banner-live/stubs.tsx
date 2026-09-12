/**
 * The one thing `RosterErrorBanner` reads, made settable per instance.
 *
 * The banner asks `useData()` for five fields and nothing else, so the whole
 * harness is a context the frames can put a different answer into — four
 * states side by side in one paint, rather than four dev servers. Everything
 * the banner is made of stays the app's: `ErrorBanner`, `Button`,
 * `PlanningCenterErrorDetails`, `en.json` and the app's own stylesheet.
 */
import { createContext, useContext } from 'react';
import type { PcoErrorReport } from '@/types';

export interface BannerState {
  students: readonly unknown[];
  rosterError: PcoErrorReport | null;
  rosterBackends: readonly { backendId: string; displayName: string; ok: boolean }[];
  rosterLoading: boolean;
  refreshRoster: (force?: boolean) => Promise<void>;
}

const IDLE: BannerState = {
  students: [],
  rosterError: null,
  rosterBackends: [],
  rosterLoading: false,
  refreshRoster: async () => {},
};

export const BannerContext = createContext<BannerState>(IDLE);

export function useData(): BannerState {
  return useContext(BannerContext);
}
