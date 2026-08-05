/**
 * The form a family fills in on their own phone.
 *
 * Three things are worth pinning, and none of them is "the inputs accept text":
 *
 *   - **The code gate.** This page is the only unauthenticated write surface in
 *     Tally, and it is meant to be reached by scanning a QR on a kiosk. Opened
 *     without a code, or with a dead one, it must say so and offer no form.
 *   - **The allergies field appears only where it can be honoured.** Tally
 *     stores no medical notes; the field means "send this to the church's own
 *     database", and where there is no such record to write to, asking for it
 *     would be collecting something with nowhere to go.
 *   - **The ending.** A parent who registers here is not checked in, and the
 *     kiosk searches a local copy of the roster — so the last screen has to say
 *     "tap I've registered" *before* it says "type your digits", or the family
 *     goes and watches a screen tell them there is no match.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RegisterFamilyResult } from '@/types';

const validateCode = vi.fn();
const registerFamily = vi.fn();
vi.mock('@/welcome/services', () => ({ validateCode, registerFamily }));

// Imported after the mock so the module graph never reaches Firebase.
const { WelcomeApp } = await import('@/welcome/WelcomeApp');

/**
 * How the page is actually reached: a URL with the kiosk's code in `?c=`.
 *
 * Relative, because `replaceState` refuses to cross origins and jsdom's is not
 * the deployment's — the path and query are all this component reads anyway.
 */
function openWith(code: string | null): void {
  window.history.replaceState({}, '', code === null ? '/welcome' : `/welcome?c=${code}`);
}

const CREATED: RegisterFamilyResult = {
  status: 'created',
  children: [
    { studentId: 'new-1', firstName: 'Robin', lastName: 'Fields', grade: 4, searchName: 'robin fields' },
  ],
  last4: '3344',
  checkedIn: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  validateCode.mockResolvedValue({ valid: true, allergiesSupported: false });
  registerFamily.mockResolvedValue(CREATED);
  openWith('ABC234');
});

afterEach(() => {
  window.history.replaceState({}, '', '/welcome');
});

describe('the code gate', () => {
  it('sends somebody who arrived without one back to the kiosk', async () => {
    openWith(null);
    render(<WelcomeApp />);

    expect(await screen.findByText(/Scan the code at the kiosk/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^First name/i)).toBeNull();
    expect(validateCode).not.toHaveBeenCalled();
  });

  it('explains a dead code rather than letting somebody fill the form in first', async () => {
    validateCode.mockResolvedValue({ valid: false, reason: 'expired', allergiesSupported: false });
    render(<WelcomeApp />);

    expect(await screen.findByText(/That code has expired/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^First name/i)).toBeNull();
  });

  it('opens the form for a live one', async () => {
    render(<WelcomeApp />);
    expect(await screen.findByLabelText(/^First name/i)).toBeTruthy();
    expect(validateCode).toHaveBeenCalledWith('ABC234');
  });
});

describe('the allergies field', () => {
  it('is absent where there is no upstream record to put it on', async () => {
    render(<WelcomeApp />);
    await screen.findByLabelText(/^First name/i);

    expect(screen.queryByLabelText(/Allergies/i)).toBeNull();
  });

  it('appears where the backend can carry it, and says where it goes', async () => {
    validateCode.mockResolvedValue({ valid: true, allergiesSupported: true });
    render(<WelcomeApp />);

    expect(await screen.findByLabelText(/Allergies/i)).toBeTruthy();
    expect(screen.getByText(/never shown on the lobby screen/i)).toBeTruthy();
  });
});

describe('filling it in', () => {
  it('carries the surname onto the next child', async () => {
    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByLabelText(/^First name/i);

    await user.type(screen.getByLabelText(/^First name/i), 'Robin');
    await user.type(screen.getByLabelText(/^Last name/i), 'Fields');
    await user.click(screen.getByRole('button', { name: /Add another child/i }));

    const lastNames = screen.getAllByLabelText(/^Last name/i) as HTMLInputElement[];
    expect(lastNames).toHaveLength(2);
    // Right far more often than not, and one edit away when it is not.
    expect(lastNames[1]!.value).toBe('Fields');
  });

  it('refuses a half-typed phone number before it costs a round trip', async () => {
    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByLabelText(/^First name/i);

    await user.type(screen.getByLabelText(/^First name/i), 'Robin');
    await user.type(screen.getByLabelText(/^Last name/i), 'Fields');
    await user.type(screen.getByLabelText(/^Your first name/i), 'Dana');
    await user.type(screen.getByLabelText(/^Your last name/i), 'Fields');
    await user.type(screen.getByLabelText(/^Your phone number/i), '55501');
    await user.click(screen.getByRole('button', { name: /^Register$/i }));

    expect(await screen.findByText(/Enter a 10-digit number/i)).toBeTruthy();
    expect(registerFamily).not.toHaveBeenCalled();
  });

  it('sends the code and the digits, and teaches the two steps back at the kiosk', async () => {
    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByLabelText(/^First name/i);

    await user.type(screen.getByLabelText(/^First name/i), 'Robin');
    await user.type(screen.getByLabelText(/^Last name/i), 'Fields');
    await user.type(screen.getByLabelText(/^Your first name/i), 'Dana');
    await user.type(screen.getByLabelText(/^Your last name/i), 'Fields');
    await user.type(screen.getByLabelText(/^Your phone number/i), '5550103344');
    await user.click(screen.getByRole('button', { name: /^Register$/i }));

    await waitFor(() => expect(registerFamily).toHaveBeenCalledTimes(1));
    const sent = registerFamily.mock.calls[0]![0];
    expect(sent.code).toBe('ABC234');
    expect(sent.guardian.phone).toBe('5550103344');
    expect(sent.children).toEqual([{ firstName: 'Robin', lastName: 'Fields', grade: null }]);
    // The field was never shown, so nothing is claimed about it.
    expect(sent.allergies).toBeUndefined();

    // The order is the whole point: the kiosk holds a local copy of the roster
    // and has to be told to go and look before the digits will find anybody.
    expect(await screen.findByText(/I’ve registered/)).toBeTruthy();
    expect(screen.getByText('3344')).toBeTruthy();
  });

  /*
   * A family whose child is already on the roster is registered, not refused.
   *
   * The server records the suspicion for the Review screen and answers
   * normally, so this form has one success path and one failure path — the
   * failure being the server actually saying no, which it now only does to a
   * request it cannot parse or a code it will not accept.
   */
  it('registers a family whose name already matches somebody', async () => {
    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByLabelText(/^First name/i);

    await user.type(screen.getByLabelText(/^First name/i), 'Robin');
    await user.type(screen.getByLabelText(/^Last name/i), 'Fields');
    await user.type(screen.getByLabelText(/^Your first name/i), 'Dana');
    await user.type(screen.getByLabelText(/^Your last name/i), 'Fields');
    await user.type(screen.getByLabelText(/^Your phone number/i), '5550103344');
    await user.click(screen.getByRole('button', { name: /^Register$/i }));

    expect(await screen.findByText(/3344/)).toBeTruthy();
  });

  it('says what went wrong when the server refuses outright', async () => {
    registerFamily.mockRejectedValue({ message: 'invalid-argument: That code has expired.' });
    const user = userEvent.setup();
    render(<WelcomeApp />);
    await screen.findByLabelText(/^First name/i);

    await user.type(screen.getByLabelText(/^First name/i), 'Robin');
    await user.type(screen.getByLabelText(/^Last name/i), 'Fields');
    await user.type(screen.getByLabelText(/^Your first name/i), 'Dana');
    await user.type(screen.getByLabelText(/^Your last name/i), 'Fields');
    await user.type(screen.getByLabelText(/^Your phone number/i), '5550103344');
    await user.click(screen.getByRole('button', { name: /^Register$/i }));

    expect(await screen.findByText(/That code has expired/i)).toBeTruthy();
  });
});
