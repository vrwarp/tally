/**
 * Two things this screen must never get wrong.
 *
 * **Who may use it.** The kiosk's own screen tells whoever is standing next to
 * it to come here, and on most Fridays that is a counselor. The code field is
 * theirs; the two maintenance surfaces are not, and one of them —
 * `getKioskStatus` — is refused by the server for anybody below core, so asking
 * as a counselor would be putting a question whose answer is already known.
 *
 * **The failure that used to be silent.** Without the runtime IAM grant,
 * pairing hangs at the last step: the code stays on the lobby screen after a
 * staff member has approved it, and the only trace is a signing error in the
 * function logs. The kiosk cannot report it — its poll loop treats the refusal
 * as a flaky lobby network, by design — so this screen is where it has to be
 * said.
 *
 * These assert on the words a leader reads, not on the component's shape.
 */
import { cleanup, render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskDevice, Role } from '@/types';
import type { KioskStatus } from '@/services/functions';

const getKioskStatus = vi.fn();
const approveKioskPairing = vi.fn();
const createKioskPairingLink = vi.fn();

vi.mock('@/services/functions', () => ({
  getKioskStatus: (...args: unknown[]) => getKioskStatus(...args),
  approveKioskPairing: (...args: unknown[]) => approveKioskPairing(...args),
  createKioskPairingLink: (...args: unknown[]) => createKioskPairingLink(...args),
  refreshKioskPhoneIndex: vi.fn(),
}));

vi.mock('@/context/toastContext', () => ({
  useToast: () => ({ show: vi.fn() }),
}));

/** The device rows the list draws, as the core team's listener would deliver them. */
let kiosks: KioskDevice[] = [];
const renameKioskDevice = vi.fn(async () => {});
const retireKioskDevice = vi.fn(async () => {});

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/kioskDevices', async () => {
  // The predicates are the real ones: what a row says about a kiosk is the
  // behaviour under test.
  const real = (await vi.importActual('@/services/kioskDevices')) as Record<string, unknown>;
  return {
    ...real,
    subscribeKioskDevices: (onRows: (rows: KioskDevice[]) => void) => {
      onRows(kiosks);
      return () => {};
    },
    renameKioskDevice: (...args: unknown[]) => renameKioskDevice(...(args as [])),
    retireKioskDevice: (...args: unknown[]) => retireKioskDevice(...(args as [])),
  };
});

let role: Role = 'admin';
const RANK: Record<Role, number> = { counselor: 0, core: 1, admin: 2 };

vi.mock('@/context/authContext', () => ({
  useAuth: () => ({ can: (needed: Role) => RANK[role] >= RANK[needed] }),
}));

const { KioskPage } = await import('@/features/kiosk/KioskPage');

function renderAs(who: Role, status: KioskStatus | Error) {
  role = who;
  getKioskStatus.mockReset();
  if (status instanceof Error) getKioskStatus.mockRejectedValue(status);
  else getKioskStatus.mockResolvedValue({ data: status });
  render(
    <MemoryRouter>
      <KioskPage />
    </MemoryRouter>,
  );
}

/** Which deployment answered, as a real one reports it. */
const WHERE = {
  project: 'tally-76406',
  serviceAccount: '481516234-compute@developer.gserviceaccount.com',
};

const OK: KioskStatus = { state: 'ok', ...WHERE, problem: null, remedy: null, command: null };

const DENIED: KioskStatus = {
  state: 'denied',
  ...WHERE,
  problem:
    'This project cannot sign kiosk tokens, so pairing a kiosk will hang at the last ' +
    'step — the code stays on screen after it is approved.',
  remedy:
    'These functions run as 481516234-compute@developer.gserviceaccount.com. Grant that ' +
    'account roles/iam.serviceAccountTokenCreator on itself.',
  command:
    'gcloud iam service-accounts add-iam-policy-binding ' +
    '481516234-compute@developer.gserviceaccount.com \\\n  --project tally-76406 \\\n' +
    '  --role=roles/iam.serviceAccountTokenCreator',
};

afterEach(() => {
  role = 'admin';
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('who the kiosk screen is for', () => {
  it('gives a counselor the code field', async () => {
    renderAs('counselor', OK);
    // The whole reason this screen is not behind `RequireRole`: the person
    // holding the lobby iPad on a Friday evening is usually a counselor.
    expect(screen.getByLabelText('Pairing code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve this kiosk' })).toBeInTheDocument();
  });

  it('does not put a counselor a question the server will refuse', async () => {
    renderAs('counselor', OK);
    // `getKioskStatus` is guarded by `requireCoreTeam`. Asking anyway would
    // spend a round trip to be told no, and log a permission error per visit.
    await waitFor(() => expect(getKioskStatus).not.toHaveBeenCalled());
    expect(screen.queryByText('Ready to pair')).not.toBeInTheDocument();
    expect(screen.queryByText('Rebuild phone search index')).not.toBeInTheDocument();
  });

  it('gives the core team the maintenance surfaces too', async () => {
    renderAs('core', OK);
    expect(await screen.findByText('Ready to pair')).toBeInTheDocument();
    expect(screen.getByText('Rebuild phone search index')).toBeInTheDocument();
  });
});

describe('the way out to the staging page', () => {
  it('points at /setup, for anybody who can see this screen', () => {
    // The kiosk's own printer screen already sends people to `/setup`; this
    // page is where somebody plans the trip, and it used to be the one place
    // that never mentioned it. Counselor rank on purpose: the person holding
    // the tablet on a Friday evening is usually not core team.
    renderAs('counselor', OK);
    const link = screen.getByRole('link', { name: '/setup' });
    expect(link).toHaveAttribute('href', '/setup');
    // A new tab, because the reader is mid-pairing — and `/setup` is its own
    // entry, so following it in place would drop the app.
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('a staging link, for a tablet nobody will be standing at', () => {
  const LINK = { status: 'created', code: 'K7MQ2X', secret: 'a'.repeat(32), expiresInSeconds: 3600 };

  it('is offered to the core team and not to a counselor', async () => {
    renderAs('core', OK);
    expect(await screen.findByRole('button', { name: 'Make a link' })).toBeInTheDocument();

    cleanup();
    renderAs('counselor', OK);
    expect(screen.queryByRole('button', { name: 'Make a link' })).not.toBeInTheDocument();
  });

  it('names the tablet the link is for, and keeps the name for the next one', async () => {
    createKioskPairingLink.mockResolvedValue({ data: LINK });
    renderAs('core', OK);

    const staging = screen.getAllByLabelText('Name it (optional)').at(-1)!;
    await userEvent.type(staging, 'Welcome desk');
    await userEvent.click(screen.getByRole('button', { name: 'Make a link' }));
    await waitFor(() => expect(createKioskPairingLink).toHaveBeenCalledWith({ name: 'Welcome desk' }));
    expect(staging).toHaveValue('Welcome desk');
  });

  it('shows the whole URL the tablet needs, with the warning that it is a credential', async () => {
    createKioskPairingLink.mockResolvedValue({ data: LINK });
    renderAs('core', OK);

    await userEvent.click(await screen.findByRole('button', { name: 'Make a link' }));

    expect(
      await screen.findByText(`${window.location.origin}/kiosk?pair=K7MQ2X.${'a'.repeat(32)}`),
    ).toBeInTheDocument();
    expect(screen.getByText(/treat it like a password/i)).toBeInTheDocument();
  });

  it('says so when the server is holding too many pairings, without blaming the reader', async () => {
    createKioskPairingLink.mockResolvedValue({ data: { status: 'busy' } });
    renderAs('core', OK);

    await userEvent.click(await screen.findByRole('button', { name: 'Make a link' }));

    expect(await screen.findByText(/Too many pairings are open/i)).toBeInTheDocument();
    expect(screen.queryByText(/pair=/)).not.toBeInTheDocument();
  });

  it('says so when the call fails, and shows no half a link', async () => {
    createKioskPairingLink.mockRejectedValue(new Error('offline'));
    renderAs('core', OK);

    await userEvent.click(await screen.findByRole('button', { name: 'Make a link' }));

    expect(await screen.findByText(/didn’t work/i)).toBeInTheDocument();
    expect(screen.queryByText(/pair=/)).not.toBeInTheDocument();
  });
});

function kiosk(overrides: Partial<KioskDevice> = {}): KioskDevice {
  return {
    id: 'kiosk-3f9a1c2e7b4d',
    name: null,
    approvedBy: 'uid-sam',
    approvedByName: 'Sam Whitfield',
    pairedAt: new Date('2026-09-01T16:00:00Z'),
    lastSeenAt: new Date(),
    boundTo: 'Sunday Kids',
    boundChain: 'sunday-kids',
    retiredAt: null,
    retiredBy: null,
    ...overrides,
  };
}

describe('the list of kiosks', () => {
  afterEach(() => {
    kiosks = [];
  });

  it('lists every kiosk for the core team — by name, who paired it, and what it is doing', async () => {
    kiosks = [kiosk({ name: 'Lobby' }), kiosk({ id: 'kiosk-8b13aa2c90ff', boundTo: null, boundChain: null })];
    renderAs('core', OK);

    expect(await screen.findByText('Lobby')).toBeInTheDocument();
    expect(screen.getByText('kiosk-8b13aa2c90ff')).toBeInTheDocument();
    expect(screen.getAllByText('Paired by Sam Whitfield')).toHaveLength(2);
    expect(screen.getByText('Recording Sunday Kids right now')).toBeInTheDocument();
  });

  it('is not the counselor’s: the rows say who paired a tablet and what it holds', () => {
    kiosks = [kiosk({ name: 'Lobby' })];
    renderAs('counselor', OK);
    expect(screen.queryByText('Kiosks')).toBeNull();
    expect(screen.queryByText('Lobby')).toBeNull();
  });

  it('says what a tablet still holds, and when it all got in', async () => {
    const nineFortyOne = new Date(Date.now() - 3 * 60 * 60_000);
    kiosks = [
      kiosk({ name: 'Lobby', lastSeenAt: nineFortyOne, waitingCount: 12, waitingSinceAt: nineFortyOne }),
      kiosk({ id: 'kiosk-8b13aa2c90ff', name: 'Nursery door', waitingCount: 0, allInAt: new Date() }),
    ];
    renderAs('core', OK);

    expect(await screen.findByText(/^12 check-ins waiting since/)).toBeInTheDocument();
    expect(screen.getByText(/^All in Tally since/)).toBeInTheDocument();
  });

  it('keeps retired kiosks behind a toggle', async () => {
    kiosks = [kiosk({ name: 'Lobby' }), kiosk({ id: 'kiosk-drawer-00000003', retiredAt: new Date('2026-08-01') })];
    renderAs('core', OK);

    expect(screen.queryByText('kiosk-drawer-00000003')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Show 1 retired kiosk' }));
    expect(screen.getByText('kiosk-drawer-00000003')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hide retired kiosks' }));
    expect(screen.queryByText('kiosk-drawer-00000003')).toBeNull();
  });

  it('says so when there are none, and when the list could not be read', async () => {
    renderAs('core', OK);
    expect(await screen.findByText('No kiosks yet.')).toBeInTheDocument();
  });

  it('names a kiosk nobody named, and renames one somebody did', async () => {
    kiosks = [kiosk()];
    renderAs('core', OK);

    await userEvent.click(await screen.findByRole('button', { name: 'Name it' }));
    const field = screen.getByLabelText('Name');
    await userEvent.type(field, 'Lobby');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(renameKioskDevice).toHaveBeenCalledWith('kiosk-3f9a1c2e7b4d', 'Lobby'));
  });

  it('puts a named kiosk’s name in the field to rename it, and gives up on Cancel', async () => {
    kiosks = [kiosk({ name: 'Lobby' })];
    renderAs('core', OK);

    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Lobby');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(renameKioskDevice).not.toHaveBeenCalled();
  });
});

describe('approving a code', () => {
  it('sends the name it was given, tidied — and none when nobody gave one', async () => {
    approveKioskPairing.mockResolvedValue({ data: { status: 'approved' } });
    renderAs('counselor', OK);

    await userEvent.type(screen.getByLabelText('Pairing code'), 'HJ4K2P');
    await userEvent.type(screen.getByLabelText('Name it (optional)'), '  Nursery   door ');
    await userEvent.click(screen.getByRole('button', { name: 'Approve this kiosk' }));
    await waitFor(() =>
      expect(approveKioskPairing).toHaveBeenCalledWith({ code: 'HJ4K2P', name: 'Nursery door' }),
    );
    // Cleared with the code: the next kiosk is somebody else's name.
    expect(screen.getByLabelText('Name it (optional)')).toHaveValue('');

    await userEvent.type(screen.getByLabelText('Pairing code'), 'HJ4K2Q');
    await userEvent.click(screen.getByRole('button', { name: 'Approve this kiosk' }));
    await waitFor(() => expect(approveKioskPairing).toHaveBeenLastCalledWith({ code: 'HJ4K2Q' }));
  });

  it('will not submit until six characters are in', async () => {
    renderAs('admin', OK);
    const approve = screen.getByRole('button', { name: 'Approve this kiosk' });
    expect(approve).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Pairing code'), 'hj4k2p');
    expect(approve).toBeEnabled();
  });

  it('upper-cases what is typed, because the kiosk shows upper case', async () => {
    renderAs('admin', OK);
    const field = screen.getByLabelText('Pairing code');
    await userEvent.type(field, 'hj4k2p');
    expect(field).toHaveValue('HJ4K2P');
  });

  it('says whose name the check-ins will carry once a code lands', async () => {
    approveKioskPairing.mockResolvedValue({ data: { status: 'approved' } });
    renderAs('admin', OK);

    await userEvent.type(screen.getByLabelText('Pairing code'), 'HJ4K2P');
    await userEvent.click(screen.getByRole('button', { name: 'Approve this kiosk' }));

    expect(await screen.findByText(/under your name/)).toBeInTheDocument();
    // Cleared, because the next thing this person does is pair the second kiosk.
    expect(screen.getByLabelText('Pairing code')).toHaveValue('');
  });

  it('sends a reader back to the kiosk screen when no kiosk is showing the code', async () => {
    approveKioskPairing.mockResolvedValue({ data: { status: 'not-found' } });
    renderAs('admin', OK);

    await userEvent.type(screen.getByLabelText('Pairing code'), 'HJ4K2Q');
    await userEvent.click(screen.getByRole('button', { name: 'Approve this kiosk' }));

    // Naming the characters that never appear is the whole value of the line:
    // it is read by somebody who has just mistaken a 0 for an O.
    expect(await screen.findByText(/the letters I, L, O/)).toBeInTheDocument();
  });
});

describe('the signing status', () => {
  it('says a kiosk can be paired when tokens can be signed', async () => {
    renderAs('admin', OK);
    expect(await screen.findByText('Ready to pair')).toBeInTheDocument();
  });

  it('names the symptom and the remedy when the grant is missing', async () => {
    renderAs('admin', DENIED);

    expect(await screen.findByText('Cannot sign kiosk tokens')).toBeInTheDocument();
    // The symptom, so the reader recognises what they are seeing in the lobby.
    expect(screen.getByText(/hang at the last step/)).toBeInTheDocument();
    // And the fix, which is the whole reason to surface it here — said in prose
    // and again in the command underneath it.
    expect(screen.getAllByText(/roles\/iam\.serviceAccountTokenCreator/).length).toBeGreaterThan(0);
    // Named, not described: "the runtime service account" is not something a
    // leader can act on, and it is the question this screen gets asked.
    expect(
      screen.getAllByText(/481516234-compute@developer\.gserviceaccount\.com/).length,
    ).toBeGreaterThan(0);
  });

  it('offers the command to whoever will actually run it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAs('admin', DENIED);

    await userEvent.click(await screen.findByRole('button', { name: 'Copy command' }));
    // The exact text, newlines and all — a command retyped from a screenshot
    // is a command with a typo in it.
    expect(writeText).toHaveBeenCalledWith(DENIED.command);
    expect(await screen.findByText('Command copied.')).toBeInTheDocument();
  });

  it('says so when the clipboard is unavailable, rather than doing nothing', async () => {
    renderAs('admin', DENIED);

    await userEvent.click(await screen.findByRole('button', { name: 'Copy command' }));
    // http origins and some in-app browsers. The command is on screen either
    // way, so the reader is told to select it — below the buttons, which is
    // where it now sits: what passes under a phone's tab bar should be the
    // thing you read and copy, not the button you have to press twice.
    expect(await screen.findByText(/select the command below/)).toBeInTheDocument();
  });

  it('does not claim a fault it could not confirm', async () => {
    renderAs('admin', {
      state: 'unknown',
      ...WHERE,
      problem: 'Tally could not tell whether kiosk tokens can be signed: ECONNRESET',
      remedy: null,
      command: null,
    });

    expect(await screen.findByText('Signing unverified')).toBeInTheDocument();
    expect(screen.queryByText(/roles\/iam\.serviceAccountTokenCreator/)).not.toBeInTheDocument();
  });

  it('stays quiet when the question itself could not be put', async () => {
    renderAs('admin', new Error('unavailable'));

    // A screen that cannot ask must not imply an answer — least of all a green
    // one, on the single page someone would check before a Sunday.
    await waitFor(() => expect(getKioskStatus).toHaveBeenCalled());
    expect(screen.queryByText('Ready to pair')).not.toBeInTheDocument();
    expect(screen.queryByText('Cannot sign kiosk tokens')).not.toBeInTheDocument();
    expect(screen.queryByText('Signing unverified')).not.toBeInTheDocument();
    // The rest of the screen still works — pairing is not gated on it.
    expect(screen.getByLabelText('Pairing code')).toBeInTheDocument();
    expect(screen.getByText('Rebuild phone search index')).toBeInTheDocument();
  });
});
