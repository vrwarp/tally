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
    refreshRoster,
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
