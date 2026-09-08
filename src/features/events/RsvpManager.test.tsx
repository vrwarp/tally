/**
 * The two writes on an RSVP row that a student pays for.
 *
 * Both are silent by design elsewhere in this file — the live list is the
 * confirmation — and both of these are the exceptions:
 *
 * - Removing takes the row that would have reported it off the screen, so the
 *   only way back is the toast, and the toast has to restore the status the
 *   student actually had rather than a fresh `yes`.
 * - "No" is the destructive third of the segmented control: on an RSVP-only
 *   event it takes the student off the check-in roster entirely. It used to be
 *   the smallest target on the row, so its size is asserted here on purpose.
 *
 * Firestore is mocked at the service boundary; what these drive is the row.
 */
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type Toast, type ToastContextValue } from '@/context/toastContext';
import { RsvpManager } from '@/features/events/RsvpManager';
import type { Rsvp, RsvpStatus, TallyEvent } from '@/types';
import { makeEvent, makeRsvp, makeStudent } from '../../../tests/factories';

type Write = (...args: unknown[]) => Promise<void>;

const addRsvps = vi.fn<Write>(async () => {});
const removeRsvp = vi.fn<Write>(async () => {});
const setRsvpStatus = vi.fn<Write>(async () => {});

vi.mock('@/services/rsvps', () => ({
  addRsvps: (...args: unknown[]) => addRsvps(...args),
  removeRsvp: (...args: unknown[]) => removeRsvp(...args),
  setRsvpStatus: (...args: unknown[]) => setRsvpStatus(...args),
}));

/** The live list the component would otherwise open a listener for. */
let rsvps: Rsvp[] = [];

vi.mock('@/hooks/useAttendance', () => ({
  useRsvps: () => ({ rsvps, loading: false, error: null }),
}));

const ada = makeStudent({ id: 'student-ada', firstName: 'Ada', lastName: 'Lovelace' });

function show(status: RsvpStatus = 'maybe', event: TallyEvent = makeEvent({ mode: 'oneoff' })) {
  rsvps = [makeRsvp({ studentId: ada.id, eventId: event.id, status })];

  // Only the three fields this card reads; the context itself is broader and
  // still growing, and a full literal here would be a test that breaks on
  // fields it never looks at.
  const data = { students: [ada] } as unknown as DataContextValue;
  const auth = { user: { uid: 'core-1' }, can: () => true } as unknown as AuthContextValue;

  const toasts: { message: string; action?: Toast['action'] }[] = [];
  const toast: ToastContextValue = {
    toasts: [],
    dismiss: vi.fn(),
    show: vi.fn((message, options) => {
      toasts.push({ message, ...(options?.action ? { action: options.action } : {}) });
      return 'toast-1';
    }),
  };

  const tree: ReactNode = (
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <ToastContext.Provider value={toast}>
          <RsvpManager event={event} />
        </ToastContext.Provider>
      </DataContext.Provider>
    </AuthContext.Provider>
  );

  return { toasts, event, ...render(tree) };
}

describe('removing a student from the RSVP list', () => {
  it('offers an undo, because the row that would have said so is gone', async () => {
    const user = userEvent.setup();
    const { toasts, event } = show('maybe');

    await user.click(screen.getByRole('button', { name: /Remove Ada Lovelace/ }));

    await waitFor(() => expect(removeRsvp).toHaveBeenCalledWith(event.id, 'student-ada'));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.action?.label).toBe('Undo');
  });

  it('puts the student back on the status they were on, not on "going"', async () => {
    const user = userEvent.setup();
    const { toasts, event } = show('maybe');

    await user.click(screen.getByRole('button', { name: /Remove Ada Lovelace/ }));
    await waitFor(() => expect(toasts).toHaveLength(1));

    toasts[0]!.action?.onPress();

    await waitFor(() =>
      expect(addRsvps).toHaveBeenCalledWith(event.id, ['student-ada'], 'core-1', 'maybe'),
    );
  });
});

describe('the going / maybe / no control', () => {
  it('gives all three segments the same width and the full target height', () => {
    show('yes');

    const segments = ['Going', 'Maybe', 'No'].map((label) =>
      screen.getByRole('button', { name: `${label} — Ada Lovelace` }),
    );

    for (const segment of segments) {
      // 48px, and the width comes from an equal-column grid rather than from
      // the label — "No" is a short word attached to a destructive write.
      expect(segment.className).toContain('min-h-12');
      expect(segment.className).toContain('w-full');
    }

    const group = screen.getByRole('group', { name: 'RSVP for Ada Lovelace' });
    expect(group.className).toContain('grid-cols-3');
    expect(group.className).toContain('gap-2');
  });

  it('reflects the current answer where it can be seen, not only in aria', () => {
    show('maybe');

    expect(screen.getByRole('button', { name: 'Maybe — Ada Lovelace' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Going — Ada Lovelace' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('says on the row what "no" costs, where the list is the roster', () => {
    const roster = show('no', makeEvent({ mode: 'oneoff', requiresRsvp: true }));
    expect(screen.getByText('Not on the check-in roster.')).toBeInTheDocument();
    roster.unmount();

    // Not where RSVPs are for planning only: "no" costs nothing there, and a
    // warning that is always on is not a warning.
    show('no', makeEvent({ mode: 'oneoff' }));
    expect(screen.queryByText('Not on the check-in roster.')).not.toBeInTheDocument();
  });
});
