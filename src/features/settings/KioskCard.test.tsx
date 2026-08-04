/**
 * The other failure that used to be silent.
 *
 * Without the runtime IAM grant, pairing a kiosk hangs at the last step: the
 * code stays on the lobby screen after a staff member has approved it, and the
 * only trace is a signing error in the function logs. The kiosk cannot report
 * it — its poll loop treats the refusal as a flaky lobby network, by design —
 * so this card is where it has to be said.
 *
 * These assert on the words a leader reads, not on the component's shape.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { KioskStatus } from '@/services/functions';

const getKioskStatus = vi.fn();

vi.mock('@/services/functions', () => ({
  getKioskStatus: (...args: unknown[]) => getKioskStatus(...args),
  refreshKioskPhoneIndex: vi.fn(),
}));

vi.mock('@/context/toastContext', () => ({
  useToast: () => ({ show: vi.fn() }),
}));

const { KioskCard } = await import('@/features/settings/KioskCard');

function renderWith(status: KioskStatus | Error) {
  getKioskStatus.mockReset();
  if (status instanceof Error) getKioskStatus.mockRejectedValue(status);
  else getKioskStatus.mockResolvedValue({ data: status });
  render(
    <MemoryRouter>
      <KioskCard />
    </MemoryRouter>,
  );
}

describe('KioskCard signing status', () => {
  it('says a kiosk can be paired when tokens can be signed', async () => {
    renderWith({ state: 'ok', problem: null, remedy: null });
    expect(await screen.findByText('Ready to pair')).toBeInTheDocument();
  });

  it('names the symptom and the remedy when the grant is missing', async () => {
    renderWith({
      state: 'denied',
      problem:
        'This project cannot sign kiosk tokens, so pairing a kiosk will hang at the last ' +
        'step — the code stays on screen after it is approved.',
      remedy:
        'Grant the functions’ runtime service account roles/iam.serviceAccountTokenCreator on itself.',
    });

    expect(await screen.findByText('Cannot sign kiosk tokens')).toBeInTheDocument();
    // The symptom, so the reader recognises what they are seeing in the lobby.
    expect(screen.getByText(/hang at the last step/)).toBeInTheDocument();
    // And the fix, which is the whole reason to surface it here.
    expect(screen.getByText(/roles\/iam\.serviceAccountTokenCreator/)).toBeInTheDocument();
  });

  it('does not claim a fault it could not confirm', async () => {
    renderWith({
      state: 'unknown',
      problem: 'Tally could not tell whether kiosk tokens can be signed: ECONNRESET',
      remedy: null,
    });

    expect(await screen.findByText('Signing unverified')).toBeInTheDocument();
    expect(screen.queryByText(/roles\/iam\.serviceAccountTokenCreator/)).not.toBeInTheDocument();
  });

  it('stays quiet when the question itself could not be put', async () => {
    renderWith(new Error('unavailable'));

    // A card that cannot ask must not imply an answer — least of all a green
    // one, on the single screen someone would check before a Sunday.
    await waitFor(() => expect(getKioskStatus).toHaveBeenCalled());
    expect(screen.queryByText('Ready to pair')).not.toBeInTheDocument();
    expect(screen.queryByText('Cannot sign kiosk tokens')).not.toBeInTheDocument();
    expect(screen.queryByText('Signing unverified')).not.toBeInTheDocument();
    // The rest of the card still works — pairing instructions are not gated on it.
    expect(screen.getByText('Rebuild phone search index')).toBeInTheDocument();
  });
});
