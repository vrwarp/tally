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
    <DataContext.Provider value={data}>
      <MemoryRouter>
        <LockedGathering event={friday} now={NOW} justRemoved={justRemoved} />
      </MemoryRouter>
    </DataContext.Provider>,
  );
}

beforeEach(() => {
  roster = team;
});

describe('the lead sentence', () => {
  it('says the reader has not been added, and nothing about "yet"', () => {
    show(['miriam']);

    expect(
      screen.getByText(
        'You have not been added to this gathering — it has been narrowed to a set of people. You are still signed in to Tally.',
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

  it('names an admin after the names, whether or not the list had one', () => {
    show(['miriam']);

    expect(screen.getByText('Ask one of these to add you')).toBeInTheDocument();
    expect(screen.getByText('or any admin: Ravi Menon')).toBeInTheDocument();
  });

  it('says to find an admin when the list names nobody it can, and still names one', () => {
    show(['dana']);

    expect(screen.queryByText('Ask one of these to add you')).not.toBeInTheDocument();
    expect(screen.getByText('Ask an admin to add you to this gathering.')).toBeInTheDocument();
    expect(screen.getByText('or any admin: Ravi Menon')).toBeInTheDocument();
  });

  it('leads back to check-in by default', () => {
    show(['miriam']);

    expect(screen.getByRole('link', { name: '‹ Check-in' })).toHaveAttribute('href', '/');
  });
});
