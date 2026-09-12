/**
 * What the panel under a name is allowed to say, and what it must admit it
 * does not know.
 *
 * Five things it would be easy to get wrong, and each one costs something real:
 *
 * 1. **An absent stamp is not an unknown person.** Every profile written before
 *    `invitedBy` existed has none, and a page that drew a blank there — or
 *    worse, guessed — would be answering a safeguarding question with a shrug
 *    dressed as a fact. It names the boundary instead.
 * 2. **Rights are per chain, not per rank.** A counselor on Nursery may put
 *    somebody on Nursery; that is the whole of the 9:22 journey. A counselor
 *    who is not on it may not, and the control is simply absent rather than
 *    present and refused.
 * 3. **Nobody may take themselves off a gathering.** `writerStays()` refuses
 *    it, so a Remove on your own row could only ever fail.
 * 4. **Retire arms while a kiosk is recording.** Retiring a working lobby
 *    screen mid-morning takes something away from a parent standing in front of
 *    it, and an installed tablet leaves duplicate rows for a thumb to miss.
 *    A kiosk standing idle is one press, because it takes nothing away.
 * 5. **Tally keeps no per-gathering membership history.** The panel draws
 *    access dates beside a list of gatherings, which reads as a history unless
 *    it says outright that it is not one.
 */
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/context/ToastProvider';
import { PersonPanel } from '@/features/team/PersonPanel';
import { makeUser } from '../../../tests/factories';

import type { AccessRequest, Role, UserProfile, KioskDevice} from '@/types';

const useAuth = vi.hoisted(() => vi.fn());
const addChainMembers = vi.hoisted(() => vi.fn());
const removeChainMember = vi.hoisted(() => vi.fn());
const subscribeKioskDevices = vi.hoisted(() => vi.fn());
const retireKioskDevice = vi.hoisted(() => vi.fn());
const subscribeChainRequests = vi.hoisted(() => vi.fn());

vi.mock('@/context/authContext', () => ({ useAuth }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/eventAccess', () => ({ addChainMembers, removeChainMember }));
vi.mock('@/services/kioskDevices', async () => {
  // The liveness predicate is the real one: whether Retire arms *is* the
  // behaviour under test, and a stubbed answer would be the test agreeing with
  // itself.
  const real = (await vi.importActual('@/services/kioskDevices')) as Record<string, unknown>;
  return { ...real, subscribeKioskDevices, retireKioskDevice };
});
vi.mock('@/services/accessRequests', async () => {
  const real = (await vi.importActual('@/services/accessRequests')) as Record<string, unknown>;
  return { ...real, subscribeChainRequests };
});

const calendar = vi.hoisted(
  () => ({ events: [], series: [], access: new Map() }) as {
    events: unknown[];
    series: { id: string; title: string }[];
    access: Map<string, { id: string; restricted: boolean; members: Set<string> }>;
  },
);
vi.mock('@/context/dataContext', () => ({ useData: () => calendar }));

const NOW = new Date('2026-09-06T09:21:00Z');

const MIRIAM = makeUser({
  id: 'uid-miriam',
  email: 'miriam@example.org',
  displayName: 'Miriam Achebe',
  role: 'core',
});

const SAM = makeUser({
  id: 'uid-sam',
  email: 'sam@example.org',
  displayName: 'Sam Whitfield',
  createdAt: new Date('2026-02-03T10:00:00Z'),
});

function device(overrides: Partial<KioskDevice> = {}): KioskDevice {
  return {
    id: 'lobby-tablet',
    approvedBy: SAM.id,
    approvedByName: 'Sam Whitfield',
    pairedAt: new Date('2026-09-01T09:00:00Z'),
    lastSeenAt: new Date('2026-09-06T09:20:30Z'),
    boundTo: 'Sunday School',
    boundChain: 'sunday-school',
    retiredAt: null,
    retiredBy: null,
    ...overrides,
  };
}

/** Two narrowed gatherings, with whoever is named on each. */
function narrow(lists: Record<string, string[]>) {
  calendar.series = Object.keys(lists).map((id) => ({
    id,
    title: id === 'nursery' ? 'Nursery' : 'Sunday School',
  }));
  calendar.access = new Map(
    Object.entries(lists).map(([id, members]) => [
      id,
      { id, restricted: true, members: new Set(members) },
    ]),
  );
}

beforeEach(() => {
  calendar.events = [];
  calendar.series = [];
  calendar.access = new Map();

  addChainMembers.mockResolvedValue(undefined);
  removeChainMember.mockResolvedValue(undefined);
  retireKioskDevice.mockResolvedValue(undefined);
  subscribeKioskDevices.mockImplementation((next: (devices: KioskDevice[]) => void) => {
    next([]);
    return () => {};
  });
  subscribeChainRequests.mockImplementation(
    (_chain: string, next: (requests: AccessRequest[]) => void) => {
      next([]);
      return () => {};
    },
  );

  useAuth.mockReturnValue({ profile: MIRIAM, can: (needed: Role) => needed !== 'admin' });
});

function show(member: UserProfile, team: UserProfile[] = [MIRIAM, SAM]) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <PersonPanel
        member={member}
        byUid={new Map(team.map((person) => [person.id, person]))}
        now={NOW}
      />
    </ToastProvider>,
  );
  return user;
}

describe('PersonPanel — how access began and ended', () => {
  it('names the inviter when there is one', () => {
    show({ ...SAM, invitedBy: MIRIAM.id });

    expect(screen.getByText('Miriam Achebe')).toBeInTheDocument();
  });

  it('says "Not recorded" for a profile older than the stamp, with the boundary', () => {
    // Not a blank and not a guess: a record that fills its own gaps is worse
    // than one whose holes are visible.
    show(SAM);

    expect(screen.getByText(/Not recorded \(before /)).toBeInTheDocument();
  });

  it('names the deployment for an address nobody could have invited', () => {
    show({ ...SAM, invitedBy: 'deployment' });

    expect(screen.getByText('The deployment')).toBeInTheDocument();
  });

  it('draws the ending and the restoration side by side', () => {
    // The restoration sits beside the ending rather than clearing it: a
    // suspension that vanishes when it is lifted leaves a record saying the
    // person was never suspended.
    show({
      ...SAM,
      active: true,
      accessEndedAt: new Date('2026-06-14T12:00:00Z'),
      accessEndedBy: MIRIAM.id,
      accessRestoredAt: new Date('2026-08-30T12:00:00Z'),
    });

    expect(screen.getByText('Access ended')).toBeInTheDocument();
    expect(screen.getByText(/by Miriam Achebe/)).toBeInTheDocument();
    expect(screen.getByText('Access restored')).toBeInTheDocument();
  });

  it('says outright that there is no membership history', () => {
    show(SAM);

    expect(screen.getByText(/keeps no record of which gatherings/)).toBeInTheDocument();
  });
});

describe('PersonPanel — the gatherings, drawn per chain', () => {
  it('lists every narrowed gathering, on it or not', () => {
    narrow({ 'sunday-school': [MIRIAM.id, SAM.id], nursery: [MIRIAM.id] });
    show(SAM);

    expect(screen.getByText('Sunday School')).toBeInTheDocument();
    expect(screen.getByText('Nursery')).toBeInTheDocument();
    expect(screen.getByText('On it')).toBeInTheDocument();
    expect(screen.getByText('Not on it')).toBeInTheDocument();
  });

  it('says so rather than drawing an empty list when nothing is narrowed', () => {
    show(SAM);

    expect(screen.getByText(/Nothing is limited/)).toBeInTheDocument();
  });

  it('is the 9:22 rescue: one press puts them on the gathering', async () => {
    narrow({ nursery: [MIRIAM.id] });
    const user = show(SAM);

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(addChainMembers).toHaveBeenCalledWith('nursery', [SAM.id], MIRIAM.id),
    );
    expect(await screen.findByText('Sam Whitfield is on Nursery.')).toBeInTheDocument();
  });

  it('offers nothing on a gathering the reader is not on themselves', () => {
    // Handing out the access you hold is one thing; handing out access you do
    // not have is another, and the rules refuse it.
    narrow({ nursery: ['somebody-else'] });
    show(SAM);

    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  it('lets core on the chain take somebody off it', async () => {
    narrow({ nursery: [MIRIAM.id, SAM.id] });
    const user = show(SAM);

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(removeChainMember).toHaveBeenCalledWith('nursery', SAM.id, MIRIAM.id),
    );
  });

  it('never offers Remove on the reader’s own row', () => {
    // `writerStays()` refuses it, so the control could only ever fail — and
    // nobody should be able to lock the door behind themselves.
    narrow({ nursery: [MIRIAM.id] });
    show(MIRIAM);

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('offers a counselor Add on their own gathering, and no Remove', () => {
    useAuth.mockReturnValue({ profile: SAM, can: (needed: Role) => needed === 'counselor' });
    narrow({ nursery: [SAM.id] });
    show(MIRIAM, [MIRIAM, SAM]);

    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('draws no controls at all beside an admin, who passes anyway', () => {
    useAuth.mockReturnValue({ profile: MIRIAM, can: () => true });
    narrow({ nursery: [MIRIAM.id] });
    show({ ...SAM, role: 'admin' });

    expect(screen.getByText('Always')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });
});

describe('PersonPanel — the kiosks they paired', () => {
  it('lists only the devices this person approved', () => {
    subscribeKioskDevices.mockImplementation((next: (devices: KioskDevice[]) => void) => {
      next([device(), device({ id: 'other-tablet', approvedBy: MIRIAM.id })]);
      return () => {};
    });
    show(SAM);

    expect(screen.getByText('lobby-tablet')).toBeInTheDocument();
    expect(screen.queryByText('other-tablet')).not.toBeInTheDocument();
  });

  it('arms Retire while the kiosk is recording, and says what stops', async () => {
    subscribeKioskDevices.mockImplementation((next: (devices: KioskDevice[]) => void) => {
      next([device()]);
      return () => {};
    });
    const user = show(SAM);

    expect(screen.getByText('Recording Sunday School right now')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retire' }));

    expect(retireKioskDevice).not.toHaveBeenCalled();
    expect(screen.getByText(/recording Sunday School right now\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, retire' }));
    await waitFor(() => expect(retireKioskDevice).toHaveBeenCalledWith('lobby-tablet', MIRIAM.id));
  });

  it('retires an idle kiosk on one press, because it takes nothing away', async () => {
    subscribeKioskDevices.mockImplementation((next: (devices: KioskDevice[]) => void) => {
      next([device({ boundTo: null, boundChain: null })]);
      return () => {};
    });
    const user = show(SAM);

    await user.click(screen.getByRole('button', { name: 'Retire' }));

    await waitFor(() => expect(retireKioskDevice).toHaveBeenCalledWith('lobby-tablet', MIRIAM.id));
  });

  it('keeps a retired row, and offers nothing on it', () => {
    // The row is the provenance of every morning that kiosk recorded, so it is
    // never deleted and never un-retired.
    subscribeKioskDevices.mockImplementation((next: (devices: KioskDevice[]) => void) => {
      next([device({ retiredAt: new Date('2026-09-02T12:00:00Z'), retiredBy: MIRIAM.id })]);
      return () => {};
    });
    show(SAM);

    expect(screen.getByText(/Retired /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument();
  });

  it('says the read failed rather than claiming there are none', () => {
    subscribeKioskDevices.mockImplementation(
      (_next: unknown, onError: (error: Error) => void) => {
        onError(new Error('Missing or insufficient permissions.'));
        return () => {};
      },
    );
    show(SAM);

    expect(screen.getByText('Couldn’t check the kiosks.')).toBeInTheDocument();
    expect(screen.queryByText('None.')).not.toBeInTheDocument();
  });
});

describe('PersonPanel — the week’s unanswered asks', () => {
  const ask: AccessRequest = {
    id: 'nursery__uid-jo',
    chainKey: 'nursery',
    uid: 'uid-jo',
    name: 'Jo Smith',
    askedAt: new Date('2026-09-04T18:00:00Z'),
    clearedBy: null,
    clearedAt: null,
  };

  it('names who asked, for a gathering this person could act on', () => {
    narrow({ nursery: [MIRIAM.id, SAM.id] });
    subscribeChainRequests.mockImplementation(
      (_chain: string, next: (requests: AccessRequest[]) => void) => {
        next([ask]);
        return () => {};
      },
    );
    show(SAM);

    expect(screen.getByText(/Jo Smith · Nursery/)).toBeInTheDocument();
  });

  it('leaves out one somebody has already answered', () => {
    narrow({ nursery: [MIRIAM.id, SAM.id] });
    subscribeChainRequests.mockImplementation(
      (_chain: string, next: (requests: AccessRequest[]) => void) => {
        next([{ ...ask, clearedBy: MIRIAM.id, clearedAt: new Date('2026-09-04T19:00:00Z') }]);
        return () => {};
      },
    );
    show(SAM);

    expect(screen.queryByText(/Jo Smith/)).not.toBeInTheDocument();
    expect(screen.queryByText('Asked to be added this week')).not.toBeInTheDocument();
  });

  it('asks only about the gatherings this person is on', () => {
    narrow({ nursery: [MIRIAM.id], 'sunday-school': [MIRIAM.id, SAM.id] });
    show(SAM);

    expect(subscribeChainRequests).toHaveBeenCalledTimes(1);
    expect(subscribeChainRequests.mock.calls[0]?.[0]).toBe('sunday-school');
  });
});

describe('PersonPanel — the shared-mailbox note', () => {
  it('warns where the address is one, and stays quiet where it is not', () => {
    show({ ...SAM, email: 'nursery@example.org' });
    expect(screen.getByText(/looks like a shared mailbox/)).toBeInTheDocument();
  });

  it('says nothing about an ordinary address', () => {
    show(SAM);
    expect(screen.queryByText(/looks like a shared mailbox/)).not.toBeInTheDocument();
  });
});
