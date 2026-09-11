/**
 * The header's two answers to "who is on this gathering", and the select that
 * demotes rather than hides.
 *
 * The chip names the sheet it opens and carries the count, leaving the
 * suspended out — a counselor acts on that number. The select keeps every
 * gathering, the ones the reader is not on under "Not yours" at the foot, and
 * choosing one of those must do two things and not a third: open the sheet
 * for that gathering, keep reading the night being worked, and never navigate
 * — a select reading "Sunday School" over a Friday roster for even a moment is
 * the mistake the whole app is built around.
 */
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type * as Router from 'react-router-dom';
import { act, fireEvent, render, screen, within } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { EventHeader } from '@/features/checkin/EventHeader';
import type { EventAccess, TallyEvent, UserProfile } from '@/types';
import { makeEvent, makeUser, NOW } from '../../../tests/factories';

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  useNavigate: () => navigate,
}));

/*
 * Asking to be added reaches Firestore, and every screen that draws a locked
 * gathering now offers it. Mocked at the service boundary the way the access
 * writes above are — `src/services/accessRequests.test.ts` is where the writes
 * themselves are pinned, and an unmocked import loads Firebase and throws on
 * the config.
 */
vi.mock('@/services/accessRequests', () => ({
  subscribeChainRequests,
  askToBeAdded: vi.fn(async () => {}),
  clearAccessRequest: vi.fn(async () => {}),
  isOutstanding: () => true,
  ACCESS_REQUEST_LIFE_MS: 7 * 86_400_000,
}));

vi.mock('@/services/eventAccess', () => ({
  restrictChain: async () => {},
  reopenChain: async () => {},
  addChainMembers: async () => {},
  removeChainMember: async () => {},
  recentRegisterTakers: async () => new Set<string>(),
}));

const team: UserProfile[] = [
  makeUser({ id: 'miriam', displayName: 'Miriam Achebe', role: 'core' }),
  makeUser({ id: 'sam', displayName: 'Sam Okafor' }),
  makeUser({ id: 'dana', displayName: 'Dana Brooks', active: false }),
];

vi.mock('@/services/users', () => ({
  subscribeUsers: (onChange: (members: UserProfile[]) => void) => {
    onChange(team);
    return () => {};
  },
}));

const friday: TallyEvent = makeEvent({
  id: 'friday-2026-02-13',
  title: 'Friday Fellowship',
  seriesId: 'friday-fellowship',
});
const sunday: TallyEvent = makeEvent({
  id: 'sunday-2026-02-15',
  title: 'Sunday School',
  seriesId: 'sunday-school',
  startAt: new Date('2026-02-15T09:30:00'),
  endAt: new Date('2026-02-15T11:00:00'),
});
const wednesday: TallyEvent = makeEvent({
  id: 'wednesday-2026-02-18',
  title: 'Wednesday Small Group',
  seriesId: 'wednesday-small-group',
  startAt: new Date('2026-02-18T19:00:00'),
  endAt: new Date('2026-02-18T20:30:00'),
});

function list(chain: string, members: string[]): [string, EventAccess] {
  return [
    chain,
    {
      id: chain,
      chainKey: chain,
      restricted: true,
      members: new Set(members),
      updatedAt: NOW,
      updatedBy: 'admin',
    },
  ];
}

/** The page's half: it owns which gathering the sheet is open for. */
function Harness({ children }: { children: (sheet: SheetState) => ReactNode }) {
  const [accessSheet, setAccessSheet] = useState<TallyEvent | null>(null);
  return <>{children({ accessSheet, onAccessSheetChange: setAccessSheet })}</>;
}

interface SheetState {
  accessSheet: TallyEvent | null;
  onAccessSheetChange: (event: TallyEvent | null) => void;
}

function show({
  event = friday,
  access = new Map<string, EventAccess>(),
  locked = [] as string[],
}: { event?: TallyEvent; access?: Map<string, EventAccess>; locked?: string[] } = {}) {
  const data = {
    access,
    events: [friday, sunday, wednesday],
    canWork: (candidate: TallyEvent) => !locked.includes(candidate.id),
  } as unknown as DataContextValue;
  const auth = {
    user: { uid: 'miriam' },
    profile: team[0],
    can: (role: string) => role !== 'admin',
  } as unknown as AuthContextValue;
  const toast: ToastContextValue = { toasts: [], show: toastShown, dismiss: vi.fn() };

  render(
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <ToastContext.Provider value={toast}>
          <MemoryRouter>
            <Harness>
              {(sheet) => (
                <EventHeader
                  event={event}
                  selectableEvents={[friday, sunday, wednesday]}
                  now={NOW}
                  present={3}
                  eligible={12}
                  {...sheet}
                />
              )}
            </Harness>
          </MemoryRouter>
        </ToastContext.Provider>
      </DataContext.Provider>
    </AuthContext.Provider>,
  );
}

/** What the header asked the toast provider to say. */
const toastShown = vi.hoisted(() => vi.fn());

const subscribeChainRequests = vi.hoisted(() =>
  vi.fn((_chain: string, _onChange: (next: unknown[]) => void) => () => {}),
);

/** Publishes one snapshot of the asks on whatever chain subscribed. */
function asking(rows: Record<string, unknown>[]) {
  subscribeChainRequests.mockImplementation(
    (_chain: string, onChange: (next: unknown[]) => void) => {
      onChange(rows);
      return () => {};
    },
  );
}

const select = () => screen.getByRole('combobox', { name: 'Switch event' }) as HTMLSelectElement;
const dialog = () => document.querySelector('dialog')!;

describe('the chip', () => {
  it('names the sheet it opens, and says "everyone" on an open gathering', () => {
    show();

    expect(screen.getByRole('button', { name: /everyone on the team/ })).toHaveTextContent(
      "Who's on · everyone",
    );
  });

  it('counts the people on a narrowed gathering, leaving the suspended out', () => {
    // Three on the list; Dana is suspended and cannot take attendance.
    show({ access: new Map([list('friday-fellowship', ['miriam', 'sam', 'dana'])]) });

    expect(screen.getByRole('button', { name: /2 people/ })).toHaveTextContent("Who's on · 2");
  });

  it('carries a dot while somebody is asking, and no word and no target', async () => {
    /*
     * Eight pixels after the text is the whole of how the roster says this.
     * A strip above the first row would push every name down under a thumb
     * already descending, which is the mechanism Journey 1 was rebuilt to
     * prevent; the sheet behind the chip is where the ask actually lives.
     */
    asking([
      {
        id: 'friday-fellowship__sam',
        chainKey: 'friday-fellowship',
        uid: 'sam',
        name: 'Sam Whitfield',
        askedAt: new Date('2026-02-13T18:00:00'),
        clearedAt: null,
        clearedBy: null,
      },
    ]);
    show({ access: new Map([list('friday-fellowship', ['miriam'])]) });

    const chip = await screen.findByRole('button', { name: /asking to be added/ });
    expect(chip).toHaveTextContent("Who's on · 1");
    expect(within(chip).getByTestId('ask-waiting')).toBeInTheDocument();
  });

  it('announces an ask that lands while the roster is open, with one way to see it', async () => {
    /*
     * The row this exists for. An earlier version took its baseline from the
     * first *ask* it saw rather than the first snapshot, which swallowed
     * exactly this one: the arriving row looked like history and the nudge
     * never fired for the case it was written for.
     */
    let deliver: ((rows: unknown[]) => void) | null = null;
    subscribeChainRequests.mockImplementation((_chain: string, onChange: (next: unknown[]) => void) => {
      deliver = onChange;
      onChange([]);
      return () => {};
    });
    show({ access: new Map([list('friday-fellowship', ['miriam'])]) });

    await act(async () => {
      deliver?.([
        {
          id: 'friday-fellowship__sam',
          chainKey: 'friday-fellowship',
          uid: 'sam',
          name: 'Sam Whitfield',
          askedAt: new Date('2026-02-13T18:40:00'),
          clearedAt: null,
          clearedBy: null,
        },
      ]);
    });

    expect(toastShown).toHaveBeenCalledWith(
      'Sam Whitfield is asking to be added',
      expect.objectContaining({ action: expect.objectContaining({ label: 'See' }) }),
    );
  });

  it('draws no dot on an open gathering, where nobody would ask', () => {
    asking([]);
    show();

    expect(screen.queryByTestId('ask-waiting')).not.toBeInTheDocument();
  });

  it('opens the sheet for this gathering', async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: /everyone on the team/ }));

    expect(dialog()).toHaveAttribute('open');
    expect(within(dialog()).getByText('Friday Fellowship')).toBeInTheDocument();
  });
});

describe('the select', () => {
  it('keeps the gatherings the reader is not on, under "Not yours", with a lock', () => {
    show({ locked: [sunday.id] });

    const group = screen.getByRole('group', { name: 'Not yours' });
    expect(within(group).getByRole('option', { name: /🔒 .*Sunday School/ })).toBeInTheDocument();
    // The others sit above it, unmarked.
    expect(screen.getByRole('option', { name: /Wednesday Small Group/ })).not.toHaveTextContent(
      '🔒',
    );
    expect(screen.getByRole('option', { name: /Friday Fellowship/ })).not.toHaveTextContent('🔒');
  });

  it('has no group at all when everything is the reader\'s', () => {
    show();

    expect(screen.queryByRole('group', { name: 'Not yours' })).not.toBeInTheDocument();
  });

  it('navigates when an own gathering is chosen', () => {
    show({ locked: [sunday.id] });

    fireEvent.change(select(), { target: { value: wednesday.id } });

    expect(navigate).toHaveBeenCalledWith(`/event/${wednesday.id}`);
  });

  it('opens the sheet for a demoted gathering instead of going there', () => {
    show({
      locked: [sunday.id],
      access: new Map([list('sunday-school', ['sam'])]),
    });

    fireEvent.change(select(), { target: { value: sunday.id } });

    expect(navigate).not.toHaveBeenCalled();
    // The select goes on reading the night being worked.
    expect(select().value).toBe(friday.id);
    // And the sheet is open on the other one — who can add you.
    expect(dialog()).toHaveAttribute('open');
    expect(within(dialog()).getByText('Sunday School')).toBeInTheDocument();
    expect(within(dialog()).getByText('Ask one of these to add you')).toBeInTheDocument();
    expect(within(dialog()).getByText('Sam Okafor')).toBeInTheDocument();
  });
});
