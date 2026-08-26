/**
 * What a counselor is told when the roster will not load.
 *
 * The sentence depends on which failure it was, and the server cannot know
 * that: it answers a callable, not "a roster read on a check-in screen". So the
 * mapping lives on this side, and these are the five sentences it produces.
 *
 * Two of them defer to the server instead, and that is the interesting half.
 * Rate-limiting and no-backend-configured are the cases where the server's own
 * message names *which* backend is in trouble — "Planning Center is
 * rate-limiting us", "Could not reach Attendees to load the roster" — which
 * this side has no way to work out. The fallbacks underneath them are for a
 * server that said nothing at all.
 *
 * The developer-facing message is never lost either way: `pcoErrorReport` keeps
 * it under `debug`, and the details panel shows it as "Underlying error".
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '@/context/DataProvider';
import { useData, type DataContextValue } from '@/context/dataContext';
import { makeStudent } from '../../tests/factories';
import type { Student } from '@/types';

const fetchRoster = vi.hoisted(() => vi.fn());
const rememberRosterPerson = vi.hoisted(() => vi.fn());

/** `vi.mock` factories are hoisted, so anything they close over must be too. */
const quiet = vi.hoisted(() => (next: (value: never[]) => void) => {
  next([]);
  return () => {};
});

vi.mock('@/services/students', () => ({ subscribeStudents: quiet }));
vi.mock('@/services/upstreamEdits', () => ({ subscribeUpstreamEdits: quiet }));
vi.mock('@/services/eventAccess', () => ({
  subscribeEventAccess: (next: (value: Map<string, never>) => void) => {
    next(new Map());
    return () => {};
  },
}));
vi.mock('@/services/events', async () => {
  const { DEFAULT_SETTINGS } = await import('@/types');
  return {
    subscribeEvents: (next: (value: never[]) => void) => {
      next([]);
      return () => {};
    },
    subscribeEventSeries: quiet,
    subscribeSettings: (next: (value: unknown) => void) => {
      next(DEFAULT_SETTINGS);
      return () => {};
    },
  };
});
vi.mock('@/services/roster', () => ({
  fetchRoster,
  rememberRosterPerson,
  cachedRoster: () => null,
  mergeRoster: (roster: Student[]) => roster,
}));
vi.mock('@/context/authContext', () => ({
  useAuth: () => ({ profile: { id: 'uid-core' }, can: () => false }),
}));

let latest: DataContextValue | null = null;

function Probe() {
  latest = useData();
  return null;
}

function mount() {
  return render(
    <DataProvider>
      <Probe />
    </DataProvider>,
  );
}

/** A callable failure, as `httpsCallable` throws it. */
function callableError(code: string, message = '') {
  return Object.assign(new Error(message), { code });
}

async function sentenceFor(cause: unknown): Promise<string | undefined> {
  fetchRoster.mockRejectedValueOnce(cause);
  mount();
  await waitFor(() => expect(latest?.rosterError).not.toBeNull());
  return latest?.rosterError?.message;
}

beforeEach(() => {
  latest = null;
  fetchRoster.mockReset();
  fetchRoster.mockResolvedValue({ students: [], fetchedAt: new Date(), offline: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sentence for a failed roster read', () => {
  it('sends an expired session back to sign in', async () => {
    expect(await sentenceFor(callableError('functions/unauthenticated'))).toBe(
      'Your session expired. Sign in again.',
    );
  });

  it('tells a deactivated account what is actually wrong', async () => {
    expect(await sentenceFor(callableError('functions/permission-denied'))).toBe(
      'Your access to Tally is not active.',
    );
  });

  it('repeats what the server said about rate-limiting, because it names the backend', async () => {
    expect(
      await sentenceFor(
        callableError('functions/resource-exhausted', 'Planning Center is rate-limiting us.'),
      ),
    ).toBe('Planning Center is rate-limiting us.');
  });

  it('has its own words for rate-limiting when the server had none', async () => {
    expect(await sentenceFor(callableError('functions/resource-exhausted'))).toBe(
      'The roster is being rate-limited upstream. It will refresh shortly.',
    );
  });

  it('repeats what the server said about a missing backend', async () => {
    expect(
      await sentenceFor(
        callableError('functions/failed-precondition', 'Attendees is not configured.'),
      ),
    ).toBe('Attendees is not configured.');
  });

  it('has its own words for a missing backend when the server had none', async () => {
    expect(await sentenceFor(callableError('functions/failed-precondition'))).toBe(
      'No people backend is configured.',
    );
  });

  it('repeats what the server said when the backend was unreachable', async () => {
    expect(
      await sentenceFor(
        callableError('functions/unavailable', 'Could not reach Attendees to load the roster.'),
      ),
    ).toBe('Could not reach Attendees to load the roster.');
  });

  it('falls back to its own words when unavailable came with nothing to say', async () => {
    // `unavailable` alone is not more informative than the general case, so it
    // is deliberately not a sentence of its own.
    expect(await sentenceFor(callableError('functions/unavailable'))).toBe(
      'Could not reach the people backend for the roster.',
    );
  });

  it('has a sentence for a failure with no code at all', async () => {
    expect(await sentenceFor(new Error('socket hang up'))).toBe(
      'Could not reach the people backend for the roster.',
    );
  });

  it('has a sentence for something thrown that was not an error', async () => {
    expect(await sentenceFor('nope')).toBe('Could not reach the people backend for the roster.');
  });

  it('keeps the underlying message for the details panel', async () => {
    fetchRoster.mockRejectedValueOnce(callableError('functions/internal', 'PCO said 502'));
    mount();
    await waitFor(() => expect(latest?.rosterError).not.toBeNull());

    // The sentence a counselor reads is this side's; the one a developer needs
    // is still on the report.
    expect(latest?.rosterError?.message).toBe('Could not reach the people backend for the roster.');
    expect(latest?.rosterError?.code).toBe('functions/internal');
  });

  it('marks the roster offline and keeps whatever was on screen', async () => {
    const held = makeStudent({ id: 'pco_1', firstName: 'Amara' });
    fetchRoster.mockResolvedValueOnce({
      students: [held],
      fetchedAt: new Date(),
      offline: false,
    });
    mount();
    await waitFor(() => expect(latest?.students).toHaveLength(1));

    fetchRoster.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await latest?.refreshRoster(true);
    });

    // Whatever is already on screen is more useful than nothing, and
    // `rosterOffline` is what says where it came from.
    expect(latest?.students.map((student) => student.id)).toEqual(['pco_1']);
    expect(latest?.rosterOffline).toBe(true);
  });

  it('clears the failure once a read lands', async () => {
    fetchRoster.mockRejectedValueOnce(new Error('offline'));
    mount();
    await waitFor(() => expect(latest?.rosterError).not.toBeNull());

    await act(async () => {
      await latest?.refreshRoster(true);
    });

    expect(latest?.rosterError).toBeNull();
    expect(latest?.rosterOffline).toBe(false);
  });
});

describe('the per-backend report', () => {
  const report = (ok: boolean, people: number) => [
    { backendId: 'pco' as const, ok, error: null, people, unresolved: 0, missing: 0 },
  ];

  it('publishes what the read said about each backend', async () => {
    fetchRoster.mockResolvedValue({
      students: [],
      fetchedAt: new Date(),
      offline: false,
      perBackend: report(true, 12),
    });

    mount();
    await waitFor(() => expect(latest?.rosterBackends).toHaveLength(1));
    expect(latest?.rosterBackends[0]?.people).toBe(12);
  });

  it('holds the same array when two reads say the same thing', async () => {
    // Every read builds a fresh object; publishing it re-renders every screen
    // reading the context for a settings-screen line that has not changed.
    fetchRoster.mockImplementation(async () => ({
      students: [],
      fetchedAt: new Date('2026-02-13T19:30:00Z'),
      offline: false,
      perBackend: report(true, 12),
    }));

    mount();
    await waitFor(() => expect(latest?.rosterBackends).toHaveLength(1));
    const first = latest?.rosterBackends;

    await act(async () => {
      await latest?.refreshRoster(true);
    });

    expect(latest?.rosterBackends).toBe(first);
  });

  it('publishes a new one when a backend starts failing', async () => {
    fetchRoster.mockImplementationOnce(async () => ({
      students: [],
      fetchedAt: new Date('2026-02-13T19:30:00Z'),
      offline: false,
      perBackend: report(true, 12),
    }));

    mount();
    await waitFor(() => expect(latest?.rosterBackends).toHaveLength(1));
    const first = latest?.rosterBackends;

    fetchRoster.mockImplementationOnce(async () => ({
      students: [],
      fetchedAt: new Date('2026-02-13T19:30:00Z'),
      offline: false,
      perBackend: report(false, 12),
    }));
    await act(async () => {
      await latest?.refreshRoster(true);
    });

    expect(latest?.rosterBackends).not.toBe(first);
    expect(latest?.rosterBackends[0]?.ok).toBe(false);
  });

  it('treats a read that reported no backends as an empty list', async () => {
    fetchRoster.mockResolvedValue({ students: [], fetchedAt: new Date(), offline: false });

    mount();
    await waitFor(() => expect(latest?.rosterSettled).toBe(true));
    expect(latest?.rosterBackends).toEqual([]);
  });
});
