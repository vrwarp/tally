/**
 * What the sheet says before it writes, and which of the two states looks on.
 *
 * The write itself is one line over a service that `firestore-tests` covers.
 * What these assert is everything around it, because that is where the harm
 * was: the current setting used to be the greyed-out one, so the state that
 * *would* fire — a restriction across every past and future occurrence — was
 * the bright, bold, borderless one, and the only sighted difference between
 * them was invisible. And the sheet decided without saying what it was deciding
 * about: no names, no count, no statement of who would lose access until after
 * the switch had already committed.
 */
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { AccessSheet } from '@/features/events/AccessSheet';
import type { EventAccess, TallyEvent, UserProfile } from '@/types';
import { makeEvent, makeUser, NOW } from '../../../tests/factories';

type Write = (...args: unknown[]) => Promise<void>;

const restrictChain = vi.fn<Write>(async () => {});
const reopenChain = vi.fn<Write>(async () => {});
const addChainMembers = vi.fn<Write>(async () => {});
const removeChainMember = vi.fn<Write>(async () => {});

/**
 * Two of the four have taken the register lately, and so has an import.
 *
 * `planning-center` is in here because a real register carries it, and the
 * sheet has to drop anything that is not a person before it counts anybody.
 */
const recentRegisterTakers = vi.fn(async () => new Set(['sam', 'dana', 'planning-center']));

vi.mock('@/services/eventAccess', () => ({
  restrictChain: (...args: unknown[]) => restrictChain(...args),
  reopenChain: (...args: unknown[]) => reopenChain(...args),
  addChainMembers: (...args: unknown[]) => addChainMembers(...args),
  removeChainMember: (...args: unknown[]) => removeChainMember(...args),
  recentRegisterTakers: () => recentRegisterTakers(),
}));

const team: UserProfile[] = [
  makeUser({ id: 'miriam', displayName: 'Miriam Achebe', role: 'core' }),
  makeUser({ id: 'sam', displayName: 'Sam Okafor' }),
  makeUser({ id: 'dana', displayName: 'Dana Brooks' }),
  makeUser({ id: 'jo', displayName: 'Jo Whitfield' }),
  makeUser({ id: 'priya', displayName: 'Priya Raman' }),
];

vi.mock('@/services/users', () => ({
  subscribeUsers: (onChange: (members: UserProfile[]) => void) => {
    onChange(team);
    return () => {};
  },
}));

const sunday: TallyEvent = makeEvent({
  id: 'sunday-2026-02-15',
  title: 'Sunday School',
  seriesId: 'sunday-school',
  mode: 'recurring',
});

function show(access: Map<string, EventAccess> = new Map()) {
  const data = {
    access,
    events: [sunday],
  } as unknown as DataContextValue;

  const auth = {
    user: { uid: 'miriam' },
    profile: team[0]!,
    can: () => true,
  } as unknown as AuthContextValue;

  const toast: ToastContextValue = { toasts: [], show: vi.fn(), dismiss: vi.fn() };

  const tree: ReactNode = (
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <ToastContext.Provider value={toast}>
          <AccessSheet open onClose={() => {}} event={sunday} now={NOW} />
        </ToastContext.Provider>
      </DataContext.Provider>
    </AuthContext.Provider>
  );

  return { toast, ...render(tree) };
}

/** The gathering closed to Miriam and Sam. */
function restricted(): Map<string, EventAccess> {
  return new Map<string, EventAccess>([
    [
      'sunday-school',
      {
        id: 'sunday-school',
        chainKey: 'sunday-school',
        restricted: true,
        members: new Set(['miriam', 'sam']),
        updatedAt: NOW,
        updatedBy: 'miriam',
      },
    ],
  ]);
}

const option = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('which state looks like the current one', () => {
  it('marks the live setting as pressed and leaves both options pressable', () => {
    show();

    expect(option('Everyone on the team')).toHaveAttribute('aria-pressed', 'true');
    // The whole bug: "current" used to mean `disabled`, which reads as
    // "unavailable" and made the state that fires the write the bright one.
    expect(option('Everyone on the team')).toBeEnabled();
    expect(option('Only people I add')).toHaveAttribute('aria-pressed', 'false');
    expect(option('Only people I add')).toBeEnabled();
  });

  it('says "Now" on the live one, so the state survives a glance across a room', () => {
    show();
    expect(option('Everyone on the team')).toHaveTextContent('Now');
    expect(option('Only people I add')).not.toHaveTextContent('Now');
  });

  it('moves the mark with the state', () => {
    show(restricted());
    expect(option('Only people I add')).toHaveAttribute('aria-pressed', 'true');
    expect(option('Only people I add')).toHaveTextContent('Now');
    expect(option('Everyone on the team')).toBeEnabled();
  });
});

describe('what the sheet says before it writes', () => {
  it('counts the team on the option that is currently true', () => {
    show();
    expect(screen.getByText('5 people can take this register.')).toBeInTheDocument();
  });

  it('names who a restriction would keep, and how many would lose it', async () => {
    show();

    // Read when the sheet opened, not when the switch is pressed — this is on
    // screen with nothing pressed.
    await waitFor(() => expect(recentRegisterTakers).toHaveBeenCalled());
    await screen.findByText(/Would keep Dana, Miriam and Sam — 2 others would lose it\./);
    expect(restrictChain).not.toHaveBeenCalled();
  });

  it('restricts to the people it named, and says how many that was', async () => {
    const user = userEvent.setup();
    const { toast } = show();

    await screen.findByText(/Would keep/);
    await user.click(option('Only people I add'));

    await waitFor(() =>
      expect(restrictChain).toHaveBeenCalledWith(
        'sunday-school',
        // `planning-center` is not a person and is not on the list.
        expect.arrayContaining(['sam', 'dana']),
        'miriam',
      ),
    );
    expect(restrictChain.mock.calls[0]![1]).toHaveLength(2);
    expect(toast.show).toHaveBeenCalledWith('Sunday School is now limited to 3 people.', {
      tone: 'success',
    });
  });
});

describe('searching the team for somebody to add', () => {
  it('says so when nobody matches, instead of rendering nothing at all', async () => {
    const user = userEvent.setup();
    show(restricted());

    await user.type(screen.getByLabelText('Add somebody'), 'zebedee');

    expect(screen.getByText(/Nobody on the team matches/)).toBeInTheDocument();
  });

  it('tells "already on this gathering" apart from "no such person"', async () => {
    const user = userEvent.setup();
    show(restricted());

    // Sam is on the list, so he is filtered out of the matches — which used to
    // look exactly like typing a name that does not exist.
    await user.type(screen.getByLabelText('Add somebody'), 'Sam');

    expect(screen.getByText(/Sam Okafor is already on this gathering\./)).toBeInTheDocument();
    expect(screen.queryByText(/Nobody on the team matches/)).not.toBeInTheDocument();
  });

  it('offers the people who are not on it yet', async () => {
    const user = userEvent.setup();
    show(restricted());

    await user.type(screen.getByLabelText('Add somebody'), 'Jo');

    await user.click(screen.getByRole('button', { name: /Jo Whitfield/ }));
    await waitFor(() =>
      expect(addChainMembers).toHaveBeenCalledWith('sunday-school', ['jo'], 'miriam'),
    );
  });
});
