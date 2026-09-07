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
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/types';
import type { KioskStatus } from '@/services/functions';

const getKioskStatus = vi.fn();
const approveKioskPairing = vi.fn();

vi.mock('@/services/functions', () => ({
  getKioskStatus: (...args: unknown[]) => getKioskStatus(...args),
  approveKioskPairing: (...args: unknown[]) => approveKioskPairing(...args),
  refreshKioskPhoneIndex: vi.fn(),
}));

vi.mock('@/context/toastContext', () => ({
  useToast: () => ({ show: vi.fn() }),
}));

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

describe('approving a code', () => {
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
