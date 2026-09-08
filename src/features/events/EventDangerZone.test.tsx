/**
 * The foot of the event page, where the irreversible things live.
 *
 * What these assert is the shape of the friction, because that is the whole
 * feature: a gathering with attendance can now be deleted, and the only thing
 * standing between a stray thumb and a term's history is that the button does
 * not work until somebody has typed the phrase beside it. So the tests care
 * about which delete is offered where, that the button is inert until the box
 * agrees, and that what is finally sent names the right scope — deleting one
 * Friday and deleting every Friday differ by a single word in one payload.
 *
 * The service layer is mocked at its boundary: the callable behind it is
 * covered by `functions/src/eventDeletion.test.ts`, against a real projection.
 */
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { EventDangerZone } from '@/features/events/EventDangerZone';
import { makeEvent } from '../../../tests/factories';
import type { TallyEvent } from '@/types';

const deleteEvents = vi.fn();
const previewEventDeletion = vi.fn();

vi.mock('@/services/events', () => ({
  deleteEvents: (...args: unknown[]) => deleteEvents(...args),
  previewEventDeletion: (...args: unknown[]) => previewEventDeletion(...args),
}));

const onDeleted = vi.fn();

function friday(overrides: Partial<TallyEvent> = {}): TallyEvent {
  return makeEvent({
    id: 'friday-2026-07-24',
    title: 'Friday Fellowship',
    mode: 'recurring',
    seriesId: null,
    recurrenceRootId: 'root-friday',
    startAt: new Date(2026, 6, 24, 19, 0),
    endAt: new Date(2026, 6, 24, 21, 0),
    ...overrides,
  });
}

function show(event: TallyEvent, checkedIn: number) {
  const toast: ToastContextValue = { toasts: [], show: vi.fn(), dismiss: vi.fn() };

  const tree: ReactNode = (
    <ToastContext.Provider value={toast}>
      <EventDangerZone event={event} checkedIn={checkedIn} onDeleted={onDeleted} />
    </ToastContext.Provider>
  );

  return { toast, ...render(tree) };
}

function deleteButton() {
  return screen.getByRole('button', { name: 'Delete' });
}

afterEach(() => {
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('a gathering somebody attended', () => {
  it('offers the delete that used to be refused outright', () => {
    show(friday(), 11);

    expect(
      screen.getByRole('button', { name: /delete this gathering and its check-ins/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/11 students were checked in here/i)).toBeInTheDocument();
  });

  it('will not delete until the phrase is typed', async () => {
    const user = userEvent.setup();
    show(friday(), 11);

    await user.click(screen.getByRole('button', { name: /delete this gathering/i }));

    // The count is stated in the dialog itself, not only on the page behind it.
    expect(screen.getByText('11 check-ins')).toBeInTheDocument();
    expect(deleteButton()).toBeDisabled();

    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELET');
    expect(deleteButton()).toBeDisabled();

    await user.type(screen.getByLabelText(/type delete to confirm/i), 'E');
    expect(deleteButton()).toBeEnabled();

    deleteEvents.mockResolvedValue({ events: 1, checkIns: 11, rsvps: 0, unlinked: 0, title: null });
    await user.click(deleteButton());

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteEvents).toHaveBeenCalledWith({ scope: 'event', eventId: 'friday-2026-07-24' });
  });

  it('takes the phrase in whatever case the keyboard offered', async () => {
    const user = userEvent.setup();
    show(friday(), 4);

    await user.click(screen.getByRole('button', { name: /delete this gathering/i }));
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'delete');

    expect(deleteButton()).toBeEnabled();
  });

  it('says nothing was removed when the delete fails', async () => {
    const user = userEvent.setup();
    show(friday(), 4);

    await user.click(screen.getByRole('button', { name: /delete this gathering/i }));
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'delete');

    deleteEvents.mockRejectedValue(new Error('offline'));
    await user.click(deleteButton());

    await waitFor(() => expect(screen.getByText(/nothing has been removed/i)).toBeInTheDocument());
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('a gathering nobody attended', () => {
  it('stays a two-tap, because there is nothing to lose', async () => {
    const user = userEvent.setup();
    deleteEvents.mockResolvedValue({ events: 1, checkIns: 0, rsvps: 0, unlinked: 0, title: null });
    show(friday(), 0);

    await user.click(screen.getByRole('button', { name: 'Delete event' }));
    // No box to type in: the confirmation is the second button.
    expect(screen.queryByLabelText(/to confirm/i)).not.toBeInTheDocument();

    await user.click(deleteButton());

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteEvents).toHaveBeenCalledWith({ scope: 'event', eventId: 'friday-2026-07-24' });
  });
});

describe('a gathering the schedule only describes', () => {
  it('has nothing of its own to delete, and still offers to end the repeat', () => {
    show(friday({ materialized: false }), 0);

    expect(screen.getByText(/comes from the repeat schedule/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete event' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete every gathering in this repeat/i }),
    ).toBeInTheDocument();
  });
});

describe('the whole repeat', () => {
  it('counts what would go before asking, and deletes the chain', async () => {
    const user = userEvent.setup();
    previewEventDeletion.mockResolvedValue({
      events: 34,
      checkIns: 512,
      rsvps: 0,
      unlinked: 2,
      title: 'Friday Fellowship',
    });
    show(friday(), 11);

    await user.click(screen.getByRole('button', { name: /delete every gathering in this repeat/i }));

    // Counted by the server, through the same code that would delete: the app
    // holds a few months of calendar, not two years of Fridays.
    await waitFor(() => expect(screen.getByText('34 gatherings already recorded')).toBeInTheDocument());
    expect(previewEventDeletion).toHaveBeenCalledWith({ scope: 'chain', chain: 'root-friday' });
    expect(screen.getByText('512 check-ins')).toBeInTheDocument();
    expect(screen.getByText(/2 one-offs that borrow these regulars/i)).toBeInTheDocument();

    // The longer phrase: the gathering's own name, so it cannot be typed
    // without naming which one is about to stop existing.
    expect(deleteButton()).toBeDisabled();
    await user.type(screen.getByLabelText(/type friday fellowship to confirm/i), 'DELETE');
    expect(deleteButton()).toBeDisabled();

    await user.clear(screen.getByLabelText(/type friday fellowship to confirm/i));
    await user.type(screen.getByLabelText(/type friday fellowship to confirm/i), 'friday fellowship');
    expect(deleteButton()).toBeEnabled();

    deleteEvents.mockResolvedValue({
      events: 34,
      checkIns: 512,
      rsvps: 0,
      unlinked: 2,
      title: 'Friday Fellowship',
    });
    await user.click(deleteButton());

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteEvents).toHaveBeenCalledWith({ scope: 'chain', chain: 'root-friday' });
  });

  it('reads the chain off the series when the gathering has one', async () => {
    const user = userEvent.setup();
    previewEventDeletion.mockResolvedValue({
      events: 2,
      checkIns: 3,
      rsvps: 0,
      unlinked: 0,
      title: 'Friday Fellowship',
    });
    show(friday({ seriesId: 'friday-fellowship' }), 0);

    await user.click(screen.getByRole('button', { name: /delete every gathering in this repeat/i }));

    await waitFor(() =>
      expect(previewEventDeletion).toHaveBeenCalledWith({
        scope: 'chain',
        chain: 'friday-fellowship',
      }),
    );
  });

  it('is not offered for a one-off', () => {
    show(friday({ mode: 'oneoff', recurrence: null, recurrenceRootId: null }), 6);

    expect(
      screen.queryByRole('button', { name: /delete every gathering in this repeat/i }),
    ).not.toBeInTheDocument();
  });
});
