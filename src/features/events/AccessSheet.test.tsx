/**
 * What the sheet says before it writes, and which of the two states looks on.
 *
 * The write itself is one line over a service that `eventAccess.test.ts` and
 * `firestore-tests` cover. What these assert is everything around it, because
 * that is where the harm was: the current setting used to be the greyed-out
 * one, so the state that *would* fire — a restriction across every past and
 * future occurrence — was the bright, bold, borderless one, and the only
 * sighted difference between them was invisible. And the sheet decided without
 * saying what it was deciding about: no names, no count, no statement of who
 * would lose access until after the switch had already committed.
 *
 * The second half is the kept list. While a gathering is open the sheet draws
 * who a narrowing would keep as ticks, and the claims are about what those
 * ticks mean: an untick is local and stays off the write, the reader's own row
 * is a fact rather than a tick, somebody added while the sheet is open is kept
 * whatever the ticks say, and the switch cannot be pressed past a preview that
 * has not finished.
 */
import type { ReactElement } from 'react';
import { render, screen, waitFor, within } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/*
 * Asking to be added reaches Firestore, and every screen that draws a locked
 * gathering now offers it. Mocked at the service boundary the way the access
 * writes above are — `src/services/accessRequests.test.ts` is where the writes
 * themselves are pinned, and an unmocked import loads Firebase and throws on
 * the config.
 */
vi.mock('@/services/accessRequests', () => ({
  subscribeChainRequests,
  askToBeAdded,
  clearAccessRequest,
  isOutstanding: () => true,
  ACCESS_REQUEST_LIFE_MS: 7 * 86_400_000,
}));

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

/** The directory the sheet is handed. Tests that need a variation swap it in. */
let roster: UserProfile[] = team;

vi.mock('@/services/users', () => ({
  subscribeUsers: (onChange: (members: UserProfile[]) => void) => {
    onChange(roster);
    return () => {};
  },
}));

const sunday: TallyEvent = makeEvent({
  id: 'sunday-2026-02-15',
  title: 'Sunday School',
  seriesId: 'sunday-school',
  mode: 'recurring',
});

/** A reader: who they are, and what their role lets them do. */
interface Reader {
  profile: UserProfile;
  can: (role: string) => boolean;
}

const miriam: Reader = { profile: team[0]!, can: () => true };

function show(access: Map<string, EventAccess> = new Map(), reader: Reader = miriam) {
  const toast: ToastContextValue = { toasts: [], show: vi.fn(), dismiss: vi.fn() };

  const tree = (current: Map<string, EventAccess>): ReactElement => {
    const data = { access: current, events: [sunday] } as unknown as DataContextValue;
    const auth = {
      user: { uid: reader.profile.id },
      profile: reader.profile,
      can: reader.can,
    } as unknown as AuthContextValue;

    return (
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={data}>
          <ToastContext.Provider value={toast}>
            <AccessSheet open onClose={() => {}} event={sunday} now={NOW} />
          </ToastContext.Provider>
        </DataContext.Provider>
      </AuthContext.Provider>
    );
  };

  const rendered = render(tree(access));
  return {
    toast,
    ...rendered,
    /** The live access map changing under an open sheet. */
    update: (next: Map<string, EventAccess>) => rendered.rerender(tree(next)),
  };
}

/** An access document for Sunday School, closed or reopened. */
function document(members: string[], restricted = true): Map<string, EventAccess> {
  return new Map<string, EventAccess>([
    [
      'sunday-school',
      {
        id: 'sunday-school',
        chainKey: 'sunday-school',
        restricted,
        members: new Set(members),
        updatedAt: NOW,
        updatedBy: 'miriam',
      },
    ],
  ]);
}

/** The gathering closed to Miriam and Sam. */
const restricted = () => document(['miriam', 'sam']);

const option = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
const tick = (name: string) => screen.getByRole('checkbox', { name: new RegExp(name) });

/** The list the last `restrictChain` call was handed, and the members it saw at open. */
function lastWrite() {
  const call = restrictChain.mock.calls.at(-1) as unknown[] | undefined;
  return {
    chain: call?.[0],
    members: call?.[1] as string[],
    uid: call?.[2],
    seenAtOpen: [...(call?.[3] as Iterable<string>)],
  };
}

beforeEach(() => {
  roster = team;
});

describe('which state looks like the current one', () => {
  it('marks the live setting as pressed and leaves both options pressable', async () => {
    show();
    // Once the preview has worked out what the press would do — see below.
    await screen.findByText(/Would keep/);

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

describe('opening a narrowed gathering back up', () => {
  it('asks first, and names what the list costs to rebuild', async () => {
    const user = userEvent.setup();
    show(restricted());

    await user.click(option('Everyone on the team'));

    // Nothing written on the first press. The two directions are not
    // symmetrical: narrowing previews a kept list and can be undone by adding
    // somebody back, and this throws the list away on every gathering in the
    // repeat.
    expect(reopenChain).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Opens Sunday School to everybody on the team\. The 2 people on it now/,
    );

    await user.click(screen.getByRole('button', { name: 'Yes, open it to everyone' }));
    expect(reopenChain).toHaveBeenCalled();
  });

  it('leaves the fence standing when the arm step is answered no', async () => {
    const user = userEvent.setup();
    show(restricted());

    await user.click(option('Everyone on the team'));
    await user.click(screen.getByRole('button', { name: 'Leave it' }));

    expect(reopenChain).not.toHaveBeenCalled();
    expect(option('Only people I add')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('what the sheet says before it writes', () => {
  it('counts the team on the option that is currently true', () => {
    show();
    expect(screen.getByText('5 people can take attendance here.')).toBeInTheDocument();
  });

  it('cannot be pressed while it is still working out what the press would do', () => {
    // The sentence is load-bearing, so pressing past it is not free.
    recentRegisterTakers.mockImplementationOnce(() => new Promise(() => {}));
    show();

    expect(screen.getAllByText('Working out who has been taking attendance here…').length)
      .toBeGreaterThan(0);
    expect(option('Only people I add')).toBeDisabled();
    expect(option('Everyone on the team')).toBeEnabled();
  });

  it('counts who a restriction would keep, and how many would lose it', async () => {
    show();

    // Read when the sheet opened, not when the switch is pressed — this is on
    // screen with nothing pressed.
    await waitFor(() => expect(recentRegisterTakers).toHaveBeenCalled());
    // Dana and Sam took the register; Miriam is written regardless. Jo and
    // Priya are the two who would lose it.
    await screen.findByText(
      /Would keep 3 people who have taken the register recently — 2 would lose it\./,
    );
    expect(restrictChain).not.toHaveBeenCalled();
  });

  it('says when the registers could not be read, rather than posing as "nobody"', async () => {
    recentRegisterTakers.mockRejectedValueOnce(new Error('refused'));
    const user = userEvent.setup();
    show();

    await screen.findByText("Couldn't read recent registers — would keep just you");
    expect(option('Only people I add')).toBeEnabled();

    await user.click(option('Only people I add'));
    await waitFor(() => expect(restrictChain).toHaveBeenCalled());
    expect(lastWrite().members).toEqual([]);
    expect(lastWrite().uid).toBe('miriam');
  });

  it('restricts to the people it named, and says how many that was', async () => {
    const user = userEvent.setup();
    const { toast } = show();

    await screen.findByText(/Would keep/);
    await user.click(option('Only people I add'));

    await waitFor(() => expect(restrictChain).toHaveBeenCalled());
    // `planning-center` is not a person and is not on the list; nobody was on
    // the document when the sheet opened.
    expect(lastWrite().chain).toBe('sunday-school');
    expect(lastWrite().members).toHaveLength(2);
    expect(lastWrite().members).toEqual(expect.arrayContaining(['sam', 'dana']));
    expect(lastWrite().uid).toBe('miriam');
    expect(lastWrite().seenAtOpen).toEqual([]);
    expect(toast.show).toHaveBeenCalledWith('Sunday School is now limited to 3 people.', {
      tone: 'success',
    });
  });
});

describe('the kept list, while the gathering is open', () => {
  it('draws the register-takers as ticks, all on, and the reader as a fact', async () => {
    show();
    await screen.findByText(/Would keep/);

    expect(screen.getByText('Kept when you limit it')).toBeInTheDocument();
    expect(tick('Dana Brooks')).toBeChecked();
    expect(tick('Sam Okafor')).toBeChecked();
    // Her row has no box: `restrictChain` adds the writer whatever the ticks
    // say, so a box would be a control that does nothing.
    expect(screen.queryByRole('checkbox', { name: /Miriam/ })).not.toBeInTheDocument();
    expect(screen.getByText('Miriam Achebe')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('names the option the sentence points at, rather than spelling it twice', async () => {
    show();
    await screen.findByText(/Would keep/);

    expect(
      screen.getByText(/nobody's access changes until you press/).textContent,
    ).toContain('Only people I add');
  });

  it('leaves an unticked name off the list, and counts it as lost', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText(/Would keep/);

    await user.click(tick('Sam Okafor'));

    expect(tick('Sam Okafor')).not.toBeChecked();
    expect(
      screen.getByText(
        /Would keep 2 people who have taken the register recently — 3 would lose it\./,
      ),
    ).toBeInTheDocument();
    // Nothing written yet: unticking is local until the press.
    expect(restrictChain).not.toHaveBeenCalled();

    await user.click(option('Only people I add'));
    await waitFor(() => expect(restrictChain).toHaveBeenCalled());
    expect(lastWrite().members).toEqual(['dana']);
  });

  it('writes the reader whatever the ticks say', async () => {
    const user = userEvent.setup();
    const { toast } = show();
    await screen.findByText(/Would keep/);

    await user.click(tick('Sam Okafor'));
    await user.click(tick('Dana Brooks'));
    await user.click(option('Only people I add'));

    await waitFor(() => expect(restrictChain).toHaveBeenCalled());
    expect(lastWrite().members).toEqual([]);
    expect(lastWrite().uid).toBe('miriam');
    expect(toast.show).toHaveBeenCalledWith('Sunday School is now limited to 1 person.', {
      tone: 'success',
    });
  });

  it('shows the kept list of a reopened gathering beside the register-takers', async () => {
    const user = userEvent.setup();
    // Narrowed once to Miriam and Jo, then reopened: the document is still there.
    show(document(['miriam', 'jo'], false));

    await screen.findByText(
      /Would keep 2 people from last time and 2 people who have taken the register since — 1 would lose it\./,
    );
    expect(tick('Jo Whitfield')).toBeChecked();
    expect(tick('Dana Brooks')).toBeChecked();
    expect(tick('Sam Okafor')).toBeChecked();

    await user.click(option('Only people I add'));
    await waitFor(() => expect(restrictChain).toHaveBeenCalled());
    expect(lastWrite().members).toHaveLength(3);
    expect(lastWrite().members).toEqual(expect.arrayContaining(['jo', 'dana', 'sam']));
    // What the sheet saw at open, so the write can tell an untick from a
    // name it was never shown.
    expect(lastWrite().seenAtOpen.sort()).toEqual(['jo', 'miriam']);
  });

  it('keeps somebody added while the sheet was open, and says so', async () => {
    const user = userEvent.setup();
    const { update } = show(document(['miriam', 'jo'], false));
    await screen.findByText(/Would keep/);

    // Priya, at the door, added by somebody else sixty seconds later.
    update(document(['miriam', 'jo', 'priya'], false));

    const row = tick('Priya Raman');
    expect(row).toBeChecked();
    // A fixed tick: the write keeps her whatever this box said, so the box
    // does not pretend otherwise.
    expect(row).toBeDisabled();
    expect(screen.getByText('added just now')).toBeInTheDocument();
    expect(screen.getByText(/Would keep 3 people from last time/)).toBeInTheDocument();

    await user.click(option('Only people I add'));
    await waitFor(() => expect(restrictChain).toHaveBeenCalled());
    expect(lastWrite().seenAtOpen.sort()).toEqual(['jo', 'miriam']);
  });
});

describe('suspended members', () => {
  beforeEach(() => {
    roster = team.map((member) => (member.id === 'sam' ? { ...member, active: false } : member));
  });

  it('are marked on the list, not hidden from it', () => {
    show(restricted());

    const row = screen.getByText('Sam Okafor').closest('li')!;
    expect(within(row).getByText('Suspended')).toBeInTheDocument();
  });

  it('are left out of every count', () => {
    show(restricted());

    // Two on the list, one of whom cannot take attendance.
    expect(
      screen.getByText('1 person — everybody else sees it locked.'),
    ).toBeInTheDocument();
    expect(screen.getByText('4 people can take attendance here.')).toBeInTheDocument();
  });
});

const subscribeChainRequests = vi.hoisted(() =>
  vi.fn((_chain: string, _onChange: (next: unknown[]) => void) => () => {}),
);
const askToBeAdded = vi.hoisted(() => vi.fn(async () => {}));
const clearAccessRequest = vi.hoisted(() => vi.fn(async () => {}));

/** Publishes one snapshot of the asks on whatever chain subscribed. */
function asking(rows: Record<string, unknown>[]) {
  subscribeChainRequests.mockImplementation(
    (_chain: string, onChange: (next: unknown[]) => void) => {
      onChange(rows);
      return () => {};
    },
  );
}

describe('a reader the gathering refuses', () => {
  const jo: Reader = { profile: team[3]!, can: (role) => role === 'counselor' };

  it('opens on who can add them, in full, with an admin whatever the list says', () => {
    roster = team.map((member) =>
      member.id === 'dana' ? { ...member, role: 'admin' as const } : member,
    );
    show(restricted(), jo);

    expect(screen.getByText('Ask one of these to add you')).toBeInTheDocument();
    // Full names and translated roles, core before counselor.
    const names = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(names[0]).toContain('Miriam Achebe');
    expect(names[0]).toContain('Core team');
    expect(names[1]).toContain('Sam Okafor');
    expect(names[1]).toContain('Counselor');
    expect(screen.getByText('or any admin: Dana Brooks')).toBeInTheDocument();
    // No verbs: nothing to search, nothing to remove.
    expect(screen.queryByLabelText('Add somebody')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Only people I add/ })).not.toBeInTheDocument();
  });

  it('never names a suspended member as the way in', () => {
    roster = team.map((member) => (member.id === 'sam' ? { ...member, active: false } : member));
    show(restricted(), jo);

    expect(screen.getByText('Miriam Achebe')).toBeInTheDocument();
    expect(screen.queryByText('Sam Okafor')).not.toBeInTheDocument();
  });

  it('says to find an admin when the list names nobody it can', () => {
    show(document(['ghost']), jo);

    expect(screen.getByText('Ask an admin to add you to this gathering.')).toBeInTheDocument();
  });

  it('offers the ask, under the names rather than instead of them', async () => {
    const user = userEvent.setup();
    asking([]);
    show(restricted(), jo);

    await user.click(screen.getByRole('button', { name: 'Ask to be added' }));

    expect(askToBeAdded).toHaveBeenCalledWith('sunday-school', jo.profile.id, expect.any(String));
    // The names are still the answer; the ask is only the shortcut to them.
    expect(screen.getByText('Ask one of these to add you')).toBeInTheDocument();
  });
});

describe('an ask, on the roster of somebody who can answer it', () => {
  /*
   * The sheet is the durable home for an ask, and it leads with it because it
   * is the only thing here that is somebody's to do — everything below is a
   * list to read. The roster itself carries nothing but a dot on the chip that
   * opens this, because a strip above the first roster row would push every
   * name down under a thumb already descending.
   */
  const waiting = [
    {
      id: 'friday-fellowship__jo',
      chainKey: 'sunday-school',
      uid: 'jo',
      name: 'Jo Adeyemi',
      askedAt: new Date('2026-02-13T18:00:00'),
      clearedAt: null,
      clearedBy: null,
    },
  ];

  it('names who is asking, and adds them in one press', async () => {
    const user = userEvent.setup();
    asking(waiting);
    show(restricted());

    expect(await screen.findByText('Asking to be added')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(addChainMembers).toHaveBeenCalledWith('sunday-school', ['jo'], 'miriam');
    // Answered, and the mark is what lets the asker tell that from silence.
    expect(clearAccessRequest).toHaveBeenCalledWith('sunday-school', 'jo', 'miriam');
  });

  it('clears without adding, which is also an answer — on the second press', async () => {
    const user = userEvent.setup();
    asking(waiting);
    show(restricted());

    // The first press only arms it. A clear is a write the asker reads as
    // "somebody looked and said no", so it is not something a thumb does by
    // landing thirteen pixels to the right of Add.
    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(clearAccessRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Clear Jo Adeyemi’s ask/);

    await user.click(screen.getByRole('button', { name: 'Yes, clear it' }));

    expect(addChainMembers).not.toHaveBeenCalled();
    expect(clearAccessRequest).toHaveBeenCalledWith('sunday-school', 'jo', 'miriam');
  });

  it('leaves the ask alone when the arm step is answered no', async () => {
    const user = userEvent.setup();
    asking(waiting);
    show(restricted());

    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Leave it' }));

    expect(clearAccessRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('says nothing at all when nobody is asking', async () => {
    asking([]);
    show(restricted());

    expect(screen.queryByText('Asking to be added')).not.toBeInTheDocument();
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

  it('offers the people who are not on it yet, with their role in words', async () => {
    const user = userEvent.setup();
    show(restricted());

    await user.type(screen.getByLabelText('Add somebody'), 'Jo');

    const match = screen.getByRole('button', { name: /Jo Whitfield/ });
    expect(match).toHaveTextContent('Counselor');
    await user.click(match);
    await waitFor(() =>
      expect(addChainMembers).toHaveBeenCalledWith('sunday-school', ['jo'], 'miriam'),
    );
  });

  it('prints the role as a word on the list too, and marks the reader', () => {
    show(restricted());

    const row = screen.getByText('Miriam Achebe').closest('li')!;
    expect(within(row).getByText('You')).toBeInTheDocument();
    expect(within(row).getByText('Core team')).toBeInTheDocument();
    expect(within(row).queryByText('core')).not.toBeInTheDocument();
  });
});
