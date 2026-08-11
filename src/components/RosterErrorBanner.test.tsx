/**
 * The failure that used to be silent.
 *
 * These assert on the words a counselor reads, not on the component's shape:
 * the bug this guards against was not a rendering fault, it was a screen that
 * said "No students on the roster yet" while `getRoster` returned 503 on every
 * call. Any change that puts Tally back to saying nothing should fail here.
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RosterErrorBanner } from '@/components/RosterErrorBanner';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import type { RosterBackendStatus } from '@/services/functions';
import { makeSettings, makeStudent } from '../../tests/factories';
import type { PcoErrorReport } from '@/types';

const FAILURE: PcoErrorReport = {
  message: 'Could not reach Planning Center for the roster.',
  code: 'functions/unavailable',
  reportedAt: '2026-07-26T05:29:32.529Z',
  debug: {
    kind: 'network',
    operation: 'load the roster',
    occurredAt: '2026-07-26T05:29:32.529Z',
    message: 'Could not reach Planning Center at /people/v2/people?offset=100&per_page=100',
    request: {
      method: 'GET',
      url: '/people/v2/people?offset=100&per_page=100',
      headers: { Authorization: '[redacted]' },
      attempts: 5,
    },
    response: null,
    errors: ['TypeError: Failed to parse URL'],
  },
};

function backendReport(overrides: Partial<RosterBackendStatus>): RosterBackendStatus {
  return {
    backendId: 'pco',
    displayName: 'Planning Center',
    ok: true,
    error: null,
    people: 12,
    unresolved: 0,
    missing: 0,
    cached: false,
    fetchedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function harness(overrides: Partial<DataContextValue> = {}) {
  const refreshRoster = vi.fn(async () => {});
  const value: DataContextValue = {
    students: [],
    events: [],
    series: [],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: null,
    rosterBackends: [],
    // Nothing restricted, which is the state every screen has to keep working in.
    access: new Map(),
    canWork: () => true,
    refreshRoster,
    applyRosterPerson: () => {},
    upstreamEdits: [],
    ...overrides,
  };

  const wrap = (children: ReactNode) => (
    <DataContext.Provider value={value}>{children}</DataContext.Provider>
  );
  return { refreshRoster, wrap };
}

describe('RosterErrorBanner', () => {
  it('says nothing at all when the roster read succeeded', () => {
    const { wrap } = harness();
    const { container } = render(wrap(<RosterErrorBanner />));
    expect(container).toBeEmptyDOMElement();
  });

  it('states the failure and offers a retry that skips the server cache', async () => {
    const { refreshRoster, wrap } = harness({ rosterError: FAILURE });
    render(wrap(<RosterErrorBanner />));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not reach Planning Center for the roster.',
    );

    screen.getByRole('button', { name: 'Try again' }).click();
    // `force`, because the held answer is the one that just failed.
    expect(refreshRoster).toHaveBeenCalledWith(true);
  });

  /**
   * The distinction the roster's own failure mode turns on: an empty screen is
   * "we cannot read them", a populated one is "these may be out of date". Both
   * were previously rendered as nothing at all.
   */
  it('explains that an empty screen is not an empty roster', () => {
    const { wrap } = harness({ rosterError: FAILURE });
    render(wrap(<RosterErrorBanner />));

    expect(screen.getByRole('alert')).toHaveTextContent(/have not been lost/i);
  });

  it('warns that names already on screen came from this device', () => {
    const { wrap } = harness({
      rosterError: FAILURE,
      rosterOffline: true,
      students: [makeStudent({ id: 'pco_1' })],
    });
    render(wrap(<RosterErrorBanner />));

    expect(screen.getByRole('alert')).toHaveTextContent(/saved earlier/i);
  });

  /**
   * One backend down while another answered is not the red banner: the roster
   * on screen is real, one slice of it is just older. It is also not nothing —
   * a leader wondering where the Attendees kids went deserves the sentence.
   */
  it('says when one backend of several did not answer, as a warning', () => {
    const { refreshRoster, wrap } = harness({
      rosterBackends: [
        backendReport({}),
        backendReport({
          backendId: 'a32',
          displayName: 'Attendees',
          ok: false,
          error: 'HTTP 503',
          people: 0,
        }),
      ],
    });
    render(wrap(<RosterErrorBanner />));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Attendees could not be reached/);

    screen.getByRole('button', { name: 'Try again' }).click();
    expect(refreshRoster).toHaveBeenCalledWith(true);
  });

  it('stays silent when every backend answered', () => {
    const { wrap } = harness({
      rosterBackends: [backendReport({}), backendReport({ backendId: 'a32', displayName: 'Attendees' })],
    });
    const { container } = render(wrap(<RosterErrorBanner />));
    expect(container).toBeEmptyDOMElement();
  });

  /** The whole point of carrying the report rather than a sentence. */
  it('carries the request behind the failure for whoever has to fix it', () => {
    const { wrap } = harness({ rosterError: FAILURE });
    render(wrap(<RosterErrorBanner />));

    expect(screen.getByText('Show details')).toBeInTheDocument();
    // More than once: the underlying error names the URL and so does the
    // request block. Either is enough to act on.
    expect(screen.getAllByText(/people\/v2\/people\?offset=100/).length).toBeGreaterThan(0);
  });
});
