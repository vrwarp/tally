/**
 * The page a refused gathering opens to: what it says, and whom it names.
 *
 * Two lead sentences, because the app knows which is true — it had a roster
 * open a second ago or it did not — and a page reading "you have not been
 * added" to somebody who was just removed is a lie the app can avoid. Then the
 * names: full ones, ranked, never a suspended profile, and an admin by name
 * whether or not the list named anybody.
 */
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { ToastProvider } from '@/context/ToastProvider';
import { render, screen } from '@/test/rtl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { LockedGathering } from '@/features/events/LockedGathering';
import type { EventAccess, TallyEvent, UserProfile } from '@/types';
import { makeEvent, makeUser, NOW } from '../../../tests/factories';

const team: UserProfile[] = [
  makeUser({ id: 'ravi', displayName: 'Ravi Menon', role: 'admin', email: 'a@example.org' }),
  makeUser({ id: 'miriam', displayName: 'Miriam Achebe', role: 'core', email: 'b@example.org' }),
  makeUser({ id: 'sam', displayName: 'Sam Okafor', email: 'c@example.org' }),
  makeUser({ id: 'dana', displayName: 'Dana Ruiz', active: false, email: 'd@example.org' }),
];

let roster: UserProfile[] = team;

/*
 * Asking to be added reaches Firestore, and every screen that draws a locked
 * gathering now offers it. Mocked at the service boundary the way the access
 * writes above are — `src/services/accessRequests.test.ts` is where the writes
 * themselves are pinned, and an unmocked import loads Firebase and throws on
 * the config.
 */
vi.mock('@/services/accessRequests', () => ({
  subscribeChainRequests: vi.fn(() => () => {}),
  askToBeAdded: vi.fn(async () => {}),
  clearAccessRequest: vi.fn(async () => {}),
  isOutstanding: () => true,
  ACCESS_REQUEST_LIFE_MS: 7 * 86_400_000,
}));

vi.mock('@/services/users', () => ({
  subscribeUsers: (onChange: (members: UserProfile[]) => void) => {
    onChange(roster);
    return () => {};
  },
}));

const friday: TallyEvent = makeEvent({
  id: 'friday-2026-02-13',
  title: 'Friday Fellowship',
  seriesId: 'friday-fellowship',
});

function restricted(members: string[]): Map<string, EventAccess> {
  return new Map([
    [
      'friday-fellowship',
      {
        id: 'friday-fellowship',
        chainKey: 'friday-fellowship',
        restricted: true,
        members: new Set(members),
        updatedAt: NOW,
        updatedBy: 'ravi',
      },
    ],
  ]);
}

function show(members: string[], justRemoved = false) {
  const data = { access: restricted(members) } as unknown as DataContextValue;
  render(
    /*
     * The page carries **Ask to be added** now, which needs to know who is
     * reading it and has a toast to say what it did. Providing both here
     * rather than mocking the page's own components: the ask is part of what
     * this screen is for, and a test that stubbed it out would stop noticing
     * if it disappeared.
     */
    <AuthContext.Provider value={authValue}>
      <ToastProvider>
        <DataContext.Provider value={data}>
          <MemoryRouter>
            <LockedGathering event={friday} now={NOW} justRemoved={justRemoved} />
          </MemoryRouter>
        </DataContext.Provider>
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

/** Sam, a counselor, who is on nothing this page ever draws. */
const authValue = {
  profile: makeUser({ id: 'reader', displayName: 'Sam Reader', email: 'reader@example.org' }),
  can: (required: string) => required === 'counselor',
} as unknown as AuthContextValue;

beforeEach(() => {
  roster = team;
});

describe('the errand it was reached with', () => {
  /*
   * A locked past row on the catch-up tail and a locked row for tonight go to
   * the same URL, so nothing in the link says which errand brought somebody
   * here — but a gathering that has already finished can only have been
   * reached for its register. Getting this wrong is a sentence about tonight
   * answering somebody who came to take last Friday's.
   */
  it('names the register when the gathering has already finished', () => {
    const lastFriday = makeEvent({
      id: 'friday-2026-02-06',
      title: 'Friday Fellowship',
      seriesId: 'friday-fellowship',
      startAt: new Date('2026-02-06T19:00:00'),
      endAt: new Date('2026-02-06T21:00:00'),
    });
    const data = { access: restricted(['miriam']) } as unknown as DataContextValue;
    render(
      <AuthContext.Provider value={authValue}>
        <ToastProvider>
          <DataContext.Provider value={data}>
            <MemoryRouter>
              <LockedGathering event={lastFriday} now={NOW} />
            </MemoryRouter>
          </DataContext.Provider>
        </ToastProvider>
      </AuthContext.Provider>,
    );

    expect(screen.getByText(/came to take this gathering’s register/)).toBeInTheDocument();
  });

  it('says nothing about a register for a gathering still running', () => {
    show(['miriam']);

    expect(screen.queryByText(/came to take/)).not.toBeInTheDocument();
  });
});

describe('the lead sentence', () => {
  it('says the reader has not been added, and nothing about "yet"', () => {
    show(['miriam']);

    expect(
      screen.getByText(
        'You have not been added to this gathering — it has been limited to a set of people. You are still signed in to Tally.',
      ),
    ).toBeInTheDocument();
  });

  it('says so when the reader was just taken off it', () => {
    show(['miriam'], true);

    expect(screen.getByText("You've just been taken off this gathering.")).toBeInTheDocument();
    expect(screen.queryByText(/You have not been added/)).not.toBeInTheDocument();
  });
});

describe('who it names', () => {
  it('prints full names, ranked, with the role in words', () => {
    show(['ravi', 'sam', 'miriam']);

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    // Core before admin before the rest; nobody has opened Tally today.
    expect(rows[0]).toContain('Miriam Achebe');
    expect(rows[0]).toContain('Core team');
    expect(rows[1]).toContain('Ravi Menon');
    expect(rows[1]).toContain('Admin');
    expect(rows[2]).toContain('Sam Okafor');
    expect(rows[2]).toContain('Counselor');
  });

  it('puts whoever opened Tally today first', () => {
    roster = team.map((member) =>
      member.id === 'sam' ? { ...member, lastSeenAt: new Date('2026-02-13T18:00:00') } : member,
    );
    show(['miriam', 'sam']);

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows[0]).toContain('Sam Okafor');
    expect(rows[1]).toContain('Miriam Achebe');
  });

  it('never names a suspended member', () => {
    show(['miriam', 'dana']);

    expect(screen.getByText('Miriam Achebe')).toBeInTheDocument();
    expect(screen.queryByText('Dana Ruiz')).not.toBeInTheDocument();
  });

  it('names an admin as one of the rows, whether or not the list had one', () => {
    show(['miriam']);

    expect(screen.getByText('Ask one of these to add you')).toBeInTheDocument();
    // A row, not a sentence after the list. The admin is the one name that is
    // unconditionally a way in, and set as prose under two people drawn as
    // rows it read as the afterthought rather than as the answer.
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows.at(-1)).toContain('Ravi Menon');
    expect(rows.at(-1)).toContain('Admin');
  });

  it('names the admin once, even when the gathering’s own list already had them', () => {
    show(['miriam', 'ravi']);

    const named = screen
      .getAllByRole('listitem')
      .filter((row) => row.textContent?.includes('Ravi Menon'));
    expect(named).toHaveLength(1);
  });

  it('still names an admin when the list names nobody it can', () => {
    show(['dana']);

    // The heading comes back, because there is somebody under it to ask.
    expect(screen.getByText('Ask one of these to add you')).toBeInTheDocument();
    expect(screen.getByText('Ravi Menon')).toBeInTheDocument();
  });

  it('leads back to check-in by default', () => {
    show(['miriam']);

    expect(screen.getByRole('link', { name: '‹ Check-in' })).toHaveAttribute('href', '/');
  });
});
