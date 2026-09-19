/**
 * What tapping the language switcher is allowed to cost, and what it has to buy.
 *
 * The provider writes sentences — "Could not load events: …", "Could not reach
 * your church directory…" — and for a long time it wrote them at the moment
 * the failure arrived, which meant it held `tErrors` and `tServer`. Both change
 * identity when the reader changes language, and both were in the dependency
 * list of the effect that opens the five root Firestore listeners and of the
 * callback that reads the Planning Center roster. So choosing Chinese closed
 * five listeners, opened five more, and spent a full uncached roster read — and
 * in the measurement that found it, three of each, because the callback rebuild
 * cascaded through the effect below it.
 *
 * The fix is to hold what failed and say it later. That has a second half which
 * is not an optimisation at all and is the reason a latest-ref would not have
 * done: a banner that is already up has to change language too. Firestore's
 * error handler is terminal, and the roster ladder's last rung is up to ten
 * minutes from the one before it, so "it will be right the next time it fails"
 * can mean a Chinese reader staring at an English sentence until they reload.
 */
import { act, render, waitFor } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '@/context/DataProvider';
import { useData, type DataContextValue } from '@/context/dataContext';
import { useLocaleControl, type LocaleControl } from '@/i18n/localeContext';
import type { AppSettings, EventAccess, EventSeries, Student, TallyEvent } from '@/types';

/** One stream's handler, plus how many times the provider asked for it. */
interface Stream<T> {
  deliver: (value: T) => void;
  fail: (cause: Error) => void;
  opened: number;
}

const streams = vi.hoisted(() => ({
  students: { deliver: () => {}, fail: () => {}, opened: 0 },
  events: { deliver: () => {}, fail: () => {}, opened: 0 },
  series: { deliver: () => {}, fail: () => {}, opened: 0 },
  settings: { deliver: () => {}, fail: () => {}, opened: 0 },
  access: { deliver: () => {}, fail: () => {}, opened: 0 },
})) as unknown as {
  students: Stream<Student[]>;
  events: Stream<TallyEvent[]>;
  series: Stream<EventSeries[]>;
  settings: Stream<AppSettings>;
  access: Stream<Map<string, EventAccess>>;
};

const fetchRoster = vi.hoisted(() => vi.fn());

function connect<T>(stream: Stream<T>, first: T) {
  return (next: (value: T) => void, onError?: (cause: Error) => void) => {
    stream.opened += 1;
    stream.deliver = next;
    stream.fail = onError ?? (() => {});
    next(first);
    return () => {};
  };
}

vi.mock('@/services/students', () => ({ subscribeStudents: connect(streams.students, []) }));
vi.mock('@/services/eventAccess', () => ({
  subscribeEventAccess: connect(streams.access, new Map()),
}));
vi.mock('@/services/upstreamEdits', () => ({
  subscribeUpstreamEdits: (next: (value: never[]) => void) => {
    next([]);
    return () => {};
  },
}));
vi.mock('@/services/events', async () => {
  const { DEFAULT_SETTINGS } = await import('@/types');
  return {
    subscribeEvents: (
      next: (value: TallyEvent[]) => void,
      _options: unknown,
      onError?: (cause: Error) => void,
    ) => connect(streams.events, [])(next, onError),
    subscribeEventSeries: connect(streams.series, []),
    subscribeSettings: connect(streams.settings, DEFAULT_SETTINGS),
  };
});
vi.mock('@/services/roster', () => ({
  fetchRoster,
  rememberRosterPerson: vi.fn(),
  cachedRoster: () => null,
  mergeRoster: (roster: Student[]) => roster,
}));
vi.mock('@/context/authContext', () => ({
  useAuth: () => ({ profile: { id: 'uid-core' }, can: () => false }),
}));

let latest: DataContextValue | null = null;
let locale: LocaleControl | null = null;

function Probe() {
  latest = useData();
  locale = useLocaleControl();
  return null;
}

function mount() {
  return render(
    <DataProvider>
      <Probe />
    </DataProvider>,
  );
}

/** What a counselor does: one tap, in the middle of a session. */
function chooseChinese() {
  act(() => locale?.setLocale('zh-Hant'));
}

beforeEach(() => {
  latest = null;
  locale = null;
  for (const stream of Object.values(streams)) stream.opened = 0;
  fetchRoster.mockReset();
  fetchRoster.mockResolvedValue({ students: [], fetchedAt: new Date(), offline: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('choosing another language', () => {
  it('does not close and re-open the five root listeners', async () => {
    mount();
    await waitFor(() => expect(latest?.loading).toBe(false));

    chooseChinese();

    // Every one of these is a Firestore listener over a collection the whole
    // app reads. Tearing them down mid-session empties every screen and pays
    // for the first snapshot of each all over again.
    expect(streams.students.opened).toBe(1);
    expect(streams.events.opened).toBe(1);
    expect(streams.series.opened).toBe(1);
    expect(streams.settings.opened).toBe(1);
    expect(streams.access.opened).toBe(1);
  });

  it('does not re-read the Planning Center roster', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterSettled).toBe(true));
    expect(fetchRoster).toHaveBeenCalledTimes(1);

    chooseChinese();

    // A paged read of every child in the church, for a tap that changed
    // nothing about who is on the roster.
    await waitFor(() => expect(latest?.rosterSettled).toBe(true));
    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });

  it('says a stream banner that is already up in the new language', async () => {
    mount();
    await waitFor(() => expect(latest?.loading).toBe(false));
    act(() => streams.events.fail(new Error('Missing or insufficient permissions.')));
    expect(latest?.error).toBe('Could not load events: Missing or insufficient permissions.');

    chooseChinese();

    /*
     * The half a latest-ref cannot do. Firestore's error handler is terminal —
     * the listener is gone — so nothing will ever call `fail` again for this
     * stream, and a sentence written once would stay in English for the rest of
     * the session.
     *
     * The reason Firestore gave stays as Firestore said it: it is the server's
     * own words and this side cannot translate them.
     */
    expect(latest?.streamErrors?.events).toBe('無法載入events：Missing or insufficient permissions.');
    expect(latest?.error).toBe('無法載入events：Missing or insufficient permissions.');
  });

  it('carries the access stream hint into the new language too', async () => {
    // The one stream whose sentence is two sentences, and the second one is the
    // only warning a counselor gets before a gathering refuses them.
    mount();
    await waitFor(() => expect(latest?.loading).toBe(false));
    act(() => streams.access.fail(new Error('Missing or insufficient permissions.')));

    chooseChinese();

    expect(latest?.streamErrors?.access).toBe(
      '無法載入access：Missing or insufficient permissions. ' +
        '無法確認今晚各場聚會的名單——若有聚會無法進入，請輔導將你加入名單。',
    );
  });

  it('says a roster banner that is already up in the new language', async () => {
    fetchRoster.mockRejectedValue(new Error('network request failed'));
    mount();
    await waitFor(() => expect(latest?.rosterError).not.toBeNull());
    expect(latest?.rosterError?.message).toBe(
      'Could not reach your church directory to load the roster. Check the wifi, then try again.',
    );

    chooseChinese();

    // The ladder's last rung is up to ten minutes from the one before it, so
    // waiting for the next failure to re-say this is waiting most of a session.
    expect(latest?.rosterError?.message).toBe(
      '無法連線教會名錄來讀取名單。請檢查網路後再試一次。',
    );
  });

  it('leaves a healthy session with nothing to say', async () => {
    // The banner must not appear *because* somebody changed language: an empty
    // failure map has to derive to an empty sentence map in every language.
    mount();
    await waitFor(() => expect(latest?.loading).toBe(false));

    chooseChinese();

    expect(latest?.streamErrors).toEqual({});
    expect(latest?.error).toBeNull();
    expect(latest?.rosterError).toBeNull();
  });
});
