/**
 * The ask, and the three things about it that are the design rather than the
 * feature.
 *
 * It says what it did and what to do with your feet, never a status — anything
 * shaped like a workflow would be a promise nobody made. Pressing twice is one
 * ask, because the document is the pair. And a clear is not silence: the row
 * comes back naming who answered and when, because without that the asker
 * cannot tell "nobody looked" from "somebody said no", and presses again next
 * week instead of walking across the lobby.
 */
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { ToastProvider } from '@/context/ToastProvider';
import { AskToBeAdded } from '@/features/events/AskToBeAdded';
import { makeUser } from '../../../tests/factories';
import type { AccessRequest, UserProfile } from '@/types';

const askToBeAdded = vi.hoisted(() => vi.fn(async () => {}));
const subscribeChainRequests = vi.hoisted(() =>
  vi.fn((_chain: string, _onChange: (next: AccessRequest[]) => void) => () => {}),
);

vi.mock('@/services/accessRequests', () => ({
  askToBeAdded,
  subscribeChainRequests,
  clearAccessRequest: vi.fn(async () => {}),
  isOutstanding: () => true,
  ACCESS_REQUEST_LIFE_MS: 7 * 86_400_000,
}));

let roster: UserProfile[] = [];
vi.mock('@/services/users', () => ({
  subscribeUsers: (onChange: (members: UserProfile[]) => void) => {
    onChange(roster);
    return () => {};
  },
}));

const SAM = makeUser({ id: 'sam', displayName: 'Sam Whitfield', email: 'sam@example.org' });
const MIRIAM = makeUser({
  id: 'miriam',
  displayName: 'Miriam Achebe',
  role: 'core',
  email: 'miriam@example.org',
});
const DANA = makeUser({
  id: 'dana',
  displayName: 'Dana Ruiz',
  role: 'admin',
  email: 'dana@example.org',
});

const auth = {
  profile: SAM,
  can: (required: string) => required === 'counselor',
} as unknown as AuthContextValue;

/** Publishes one snapshot of the collection to whatever subscribed. */
function publish(rows: AccessRequest[]) {
  subscribeChainRequests.mockImplementation(
    (_chain: string, onChange: (next: AccessRequest[]) => void) => {
      onChange(rows);
      return () => {};
    },
  );
}

function show(approvers: UserProfile[] = [MIRIAM, DANA]) {
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <AskToBeAdded chain="sunday-school" approvers={approvers} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  roster = [SAM, MIRIAM, DANA];
  publish([]);
  askToBeAdded.mockClear();
});

describe('pressing it', () => {
  it('names whose list it landed on, and says to go and find them', async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: 'Ask to be added' }));

    expect(askToBeAdded).toHaveBeenCalledWith('sunday-school', 'sam', 'Sam Whitfield');
    expect(
      await screen.findByText(
        /Your name is on the Add list for Miriam Achebe and Dana Ruiz.*go and find them/,
      ),
    ).toBeInTheDocument();
  });

  it('still says something useful when the screen could name nobody', async () => {
    const user = userEvent.setup();
    show([]);

    await user.click(screen.getByRole('button', { name: 'Ask to be added' }));

    expect(await screen.findByText(/go and find a leader/)).toBeInTheDocument();
  });

  it('says the ask failed rather than pretending it landed', async () => {
    askToBeAdded.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: 'Ask to be added' }));

    expect(await screen.findByText(/Could not put your name on the list/)).toBeInTheDocument();
  });
});

describe('once it is on the list', () => {
  it('offers no second press, because a second press is the same document', async () => {
    publish([
      {
        id: 'sunday-school__sam',
        chainKey: 'sunday-school',
        uid: 'sam',
        name: 'Sam Whitfield',
        askedAt: new Date('2026-09-06T18:00:00'),
        clearedBy: null,
        clearedAt: null,
      },
    ]);
    show();

    await waitFor(() =>
      expect(screen.getByText('Your name is on the Add list.')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Ask to be added' })).not.toBeInTheDocument();
  });

  it('says who answered it and when, so silence and a no are not the same', async () => {
    publish([
      {
        id: 'sunday-school__sam',
        chainKey: 'sunday-school',
        uid: 'sam',
        name: 'Sam Whitfield',
        askedAt: new Date('2026-09-06T18:00:00'),
        clearedBy: 'miriam',
        clearedAt: new Date('2026-09-06T19:01:00'),
      },
    ]);
    show();

    expect(
      await screen.findByText(/Miriam Achebe cleared this at .* — ask them in person/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask to be added' })).not.toBeInTheDocument();
  });

  it('still says it was answered when the directory cannot name who did it', async () => {
    publish([
      {
        id: 'sunday-school__sam',
        chainKey: 'sunday-school',
        uid: 'sam',
        name: 'Sam Whitfield',
        askedAt: new Date('2026-09-06T18:00:00'),
        clearedBy: 'somebody-who-left',
        clearedAt: new Date('2026-09-06T19:01:00'),
      },
    ]);
    show();

    expect(await screen.findByText(/Somebody cleared this at/)).toBeInTheDocument();
  });
});
