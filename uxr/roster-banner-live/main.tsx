/**
 * The four boxes a failed roster read can put on the check-in screen, mounted
 * from `src/` so they cannot drift from what ships.
 *
 * Same argument as `transitions-live/main.tsx`: a copy of a banner is a
 * photograph of nothing. What renders below is the app's own
 * `RosterErrorBanner` — its markup, its `ErrorBanner`, its `Button`, its
 * `PlanningCenterErrorDetails`, the real `en.json` wording and the app's own
 * stylesheet. What is faked is the one hook it reads (`stubs.tsx`) and the
 * contents of the failure it is handed.
 *
 * The grey label above each frame is harness chrome and appears nowhere in the
 * app; everything inside the dashed box is the app.
 */
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'use-intl';
import '@/index.css';
import { RosterErrorBanner } from '@/components/RosterErrorBanner';
import { EmptyState } from '@/components/ui';
import type { PcoErrorReport } from '@/types';
import { BannerContext, type BannerState } from './stubs';
import en from '../../messages/en.json';

const WHEN = '2026-09-12T10:14:37.221Z';

/** A student, as far as the banner is concerned: it counts them, nothing more. */
const SOMEBODY = {} as unknown;

/**
 * A 502 out of Planning Center that outlived all five attempts.
 *
 * The server's own sentence, because `reportBackendFailure` throws
 * `unavailable` for any status that is not 429/401/403 and the client shows
 * what the server said — which is the only path that puts the words "Planning
 * Center" in this box.
 */
const GATEWAY: PcoErrorReport = {
  message: 'Could not reach Planning Center to load the roster.',
  code: 'functions/unavailable',
  reportedAt: WHEN,
  debug: {
    kind: 'api',
    operation: 'load the roster',
    occurredAt: WHEN,
    message: 'Planning Center returned 502 for /people/v2/people',
    request: {
      method: 'GET',
      url: 'https://api.planningcenteronline.com/people/v2/people?include=field_data&offset=200&per_page=100',
      headers: { Authorization: 'Basic ***', Accept: 'application/json' },
      attempts: 5,
    },
    response: {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-request-id': '4f2c91ab' },
      body: '<html><body><h1>502 Bad Gateway</h1></body></html>',
      bodyTruncated: false,
      durationMs: 4183,
    },
    errors: [],
  },
};

/**
 * The browser giving up before the function did: `getRoster` runs on the SDK's
 * 70-second default while the server is allowed 120. Nothing came back, so
 * there is no debug payload and the sentence is the client's own — which is
 * why this one says "your church directory" rather than naming anybody.
 */
const DEADLINE: PcoErrorReport = {
  message: 'Could not reach your church directory to load the roster. Check the wifi, then try again.',
  code: 'functions/deadline-exceeded',
  reportedAt: WHEN,
  debug: null,
};

const base: BannerState = {
  students: [],
  rosterError: null,
  rosterBackends: [],
  rosterLoading: false,
  refreshRoster: async () => {},
};

interface Frame {
  id: string;
  label: string;
  note: string;
  state: BannerState;
  /** Drawn under the banner, when the screen would have drawn it. */
  below?: 'empty';
}

const FRAMES: Frame[] = [
  {
    id: 'stale-showing',
    label: 'A — the likely one: names on screen, the read behind them failed',
    note: 'rosterError set, students.length > 0. The server tried Planning Center and got a 502 five times.',
    state: { ...base, students: [SOMEBODY, SOMEBODY, SOMEBODY], rosterError: GATEWAY },
  },
  {
    id: 'details-open',
    label: 'B — the same box with Details opened',
    note: 'Not a different state: the disclosure inside frame A, which is what to tap if it happens again.',
    state: { ...base, students: [SOMEBODY, SOMEBODY, SOMEBODY], rosterError: GATEWAY },
  },
  {
    id: 'stale-empty',
    label: 'C — nothing on screen at all, and the browser timed out first',
    note: 'rosterError set, students.length === 0. Different second line, and the list below it changes too.',
    state: { ...base, students: [], rosterError: DEADLINE },
    below: 'empty',
  },
  {
    id: 'backend-down',
    label: 'D — the other box with a Try again button (amber, not red)',
    note: 'rosterError null, one backend of two reported down. Only possible with a second directory connected.',
    state: {
      ...base,
      students: [SOMEBODY, SOMEBODY],
      rosterBackends: [
        { backendId: 'pco', displayName: 'Planning Center', ok: false },
        { backendId: 'a32', displayName: 'Attendees', ok: true },
      ],
    },
  },
];

createRoot(document.getElementById('root')!).render(
  <IntlProvider locale="en" messages={en} timeZone="America/Los_Angeles">
    <div className="min-h-dvh bg-ink-950 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        {FRAMES.map((frame) => (
          <section key={frame.id} data-frame={frame.id} className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {frame.label}
            </p>
            <p className="font-mono text-[11px] leading-relaxed text-ink-600">{frame.note}</p>
            <div className="rounded-2xl border border-dashed border-ink-700 p-3">
              <BannerContext.Provider value={frame.state}>
                <RosterErrorBanner />
              </BannerContext.Provider>
              {frame.below === 'empty' ? (
                <EmptyState
                  className="pt-10"
                  icon="⚠️"
                  title={en.CheckIn.emptyRosterError}
                  description={en.CheckIn.emptyRosterErrorBody}
                />
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  </IntlProvider>,
);
