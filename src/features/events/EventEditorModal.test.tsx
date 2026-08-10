/**
 * The roster question the editor asks, and the chain facts it must not lose.
 *
 * A recurring gathering predicts from its own past nights and is never asked
 * anything about it. A one-off has no past at all, so the prediction is a thing
 * a leader hands it: the gathering whose regulars are the people on the coach.
 * There used to be a second question — a "Series" picker on the recurring half —
 * and the first block below is what remains of it.
 *
 * Firestore is mocked at the service boundary; what these assert is the shape of
 * the draft the form builds, which is the only thing the writes see.
 */
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { EventEditorModal } from '@/features/events/EventEditorModal';
// Type-only, so it survives the module mock below untouched.
import type { EventDraft } from '@/services/events';
import type { EventSeries, TallyEvent } from '@/types';
import { makeEvent, makeSettings } from '../../../tests/factories';

const createEvent = vi.fn<(...args: unknown[]) => Promise<string>>(async () => 'new-event');
const updateEvent = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

vi.mock('@/services/events', () => ({
  createEvent: (...args: unknown[]) => createEvent(...args),
  updateEvent: (...args: unknown[]) => updateEvent(...args),
  ensureMaterialized: async (event: TallyEvent) => event.id,
}));

const FRIDAY = 'friday-fellowship';

const fridaySeries: EventSeries = {
  id: FRIDAY,
  title: 'Friday Fellowship',
  dayOfWeek: 5,
  startTime: '19:00',
  endTime: '21:00',
  checkInOpensMinutesBefore: 60,
  checkInClosesMinutesAfter: 60,
  active: true,
  order: 1,
};

/** A Friday under the series, and a small group held together by a root alone. */
const calendar: TallyEvent[] = [
  makeEvent({
    id: 'friday-1',
    seriesId: FRIDAY,
    title: 'Friday Fellowship',
    startAt: new Date(2026, 1, 13, 19, 0),
    endAt: new Date(2026, 1, 13, 21, 0),
  }),
  makeEvent({
    id: 'saturday-1',
    seriesId: null,
    recurrenceRootId: 'saturday-root',
    title: 'Saturday Small Group',
    startAt: new Date(2026, 1, 7, 10, 0),
    endAt: new Date(2026, 1, 7, 11, 30),
  }),
];

function show(event: TallyEvent | null = null, defaults?: Partial<EventDraft>) {
  const data: DataContextValue = {
    students: [],
    events: calendar,
    series: [fridaySeries],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: null,
    rosterBackends: [],
    // Nothing restricted, which is the state every screen has to keep working in.
    access: new Map(),
    canWork: () => true,
    refreshRoster: async () => {},
    applyRosterPerson: () => {},
  };

  const auth = {
    status: 'ready',
    stage: null,
    user: { uid: 'core-1' },
    profile: null,
    error: null,
    signInWithGoogle: async () => {},
    signOut: async () => {},
    refreshProfile: async () => {},
    clearError: () => {},
    can: () => true,
  } as unknown as AuthContextValue;

  const toast: ToastContextValue = { show: vi.fn(), dismiss: vi.fn(), toasts: [] };

  const wrap = (children: ReactNode) => (
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
      </DataContext.Provider>
    </AuthContext.Provider>
  );

  return render(
    wrap(<EventEditorModal open onClose={() => {}} event={event} defaults={defaults} />),
  );
}

const typeSelect = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

/*
 * The picker that used to be here, and why its absence is worth a test.
 *
 * It listed `eventSeries` documents, and nothing in the app creates one — the
 * seed script is the only writer — so outside a seeded database it offered a
 * single choice, "Not part of one", and no way to reach any other. Asserting it
 * is gone is really asserting that a leader is not handed an empty control on
 * the form they fill in most often.
 *
 * `series` stays in the context above deliberately: a seeded deployment still
 * has the documents, and dropping the picker must not drop them from the
 * borrowing list on a one-off, which is titled from them.
 */
describe('EventEditorModal: the series picker that is gone', () => {
  it('does not offer a series to a recurring gathering', () => {
    show();

    expect(screen.queryByLabelText('Series')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /not part of one/i })).not.toBeInTheDocument();
  });

  /*
   * The one that would be missed. Prediction groups history by the repeat chain
   * and `chainKey` reads `seriesId` first, so a Friday that already carries one
   * is held in its chain by that field alone — and `buildEventPayload` writes
   * every field on every save. A form that forgot to carry it would cut the
   * night out of its own history, and out of the `eventAccess` document naming
   * it, without anything on screen having changed.
   */
  it('still carries a series an event already has through an edit', async () => {
    const user = userEvent.setup();
    show(calendar[0]!);

    await user.clear(screen.getByLabelText(/^Title/));
    await user.type(screen.getByLabelText(/^Title/), 'Friday Fellowship — Winter');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent.mock.calls.at(-1)![1]).toMatchObject({
      mode: 'recurring',
      seriesId: FRIDAY,
    });
  });

  /*
   * The other way one still arrives: `EventsPage`'s quick actions open this form
   * with a series in `defaults`, which is the path a seeded deployment schedules
   * its Fridays by. Removing the control must not remove that.
   */
  it('saves a series handed to it in defaults', async () => {
    const user = userEvent.setup();
    show(null, { mode: 'recurring', seriesId: FRIDAY, title: 'Friday Fellowship' });

    await user.click(screen.getByRole('button', { name: 'Schedule event' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls.at(-1)![0]).toMatchObject({
      mode: 'recurring',
      seriesId: FRIDAY,
    });
  });
});

describe('EventEditorModal: a one-off borrowing a gathering', () => {
  it('offers every chain on the calendar, series document or not', async () => {
    const user = userEvent.setup();
    show();

    await user.selectOptions(typeSelect('Type'), 'oneoff');

    const picker = typeSelect('Predicted roster');
    const offered = [...picker.options].map((option) => option.textContent);
    expect(offered).toEqual([
      'No prediction — the whole roster',
      'Friday Fellowship',
      'Saturday Small Group',
    ]);
  });

  it('saves the chain the leader chose', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText(/^Title/), 'Winter Retreat');
    await user.selectOptions(typeSelect('Type'), 'oneoff');
    await user.selectOptions(typeSelect('Predicted roster'), FRIDAY);
    await user.click(screen.getByRole('button', { name: 'Schedule event' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls[0]![0]).toMatchObject({
      mode: 'oneoff',
      predictFromChain: FRIDAY,
      seriesId: null,
    });
  });

  /*
   * A gathering that repeats reads its own past, so a borrowed chain would be a
   * second answer to a settled question — and one nothing on screen is showing
   * any more.
   */
  it('drops the borrowed chain when the event goes back to recurring', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText(/^Title/), 'Winter Retreat');
    await user.selectOptions(typeSelect('Type'), 'oneoff');
    await user.selectOptions(typeSelect('Predicted roster'), FRIDAY);
    await user.selectOptions(typeSelect('Type'), 'recurring');
    await user.click(screen.getByRole('button', { name: 'Schedule event' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls.at(-1)![0]).toMatchObject({
      mode: 'recurring',
      predictFromChain: null,
    });
  });

  it('saves the colours a leader picked for the lobby screen', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText(/^Title/), 'Sunday Nursery');
    await user.click(screen.getByRole('button', { name: /^Kiosk colours/ }));
    await user.click(
      within(screen.getByRole('group', { name: 'What you touch' })).getByRole('button', {
        name: 'Ember',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Schedule event' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls.at(-1)![0]).toMatchObject({
      kioskTheme: { ground: 'dark', accent: 'ember', confirm: 'forest', backdrop: 'indigo' },
    });
  });

  it('sends null for a gathering nobody themed, rather than a default object', async () => {
    // Null is what "the kiosk that shipped" is written as, everywhere down the
    // path — the resolver, the chooser row and the binding all lean on it.
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText(/^Title/), 'Friday Fellowship');
    await user.click(screen.getByRole('button', { name: 'Schedule event' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls.at(-1)![0]).toMatchObject({ kioskTheme: null });
  });

  it('keeps a chosen gathering that has scrolled out of the loaded window', () => {
    show(makeEvent({ id: 'retreat', mode: 'oneoff', predictFromChain: 'long-gone' }));

    const picker = typeSelect('Predicted roster');
    expect(picker.value).toBe('long-gone');
    expect(screen.getByRole('option', { name: /already chosen/i })).toBeInTheDocument();
  });
});

/*
 * What an edit must not quietly change about *which gathering this is*.
 *
 * `chainKey` reads `seriesId ?? recurrenceRootId ?? id`, and almost everything
 * that treats a run of Fridays as one gathering is keyed on it: the projection
 * of the dates ahead, the predictive roster's history, `skippedNights`, and
 * `eventAccess`. `buildEventPayload` writes every field on every save, so a
 * field the form forgets to carry is a field the save nulls — and nulling this
 * one cut the instance out of its own chain.
 */
describe('EventEditorModal: the chain an edit belongs to', () => {
  const saturday = calendar[1]!;

  it('carries the recurrence root through an ordinary edit', async () => {
    const user = userEvent.setup();
    show(saturday);

    await user.clear(screen.getByLabelText(/^Next start/));
    await user.type(screen.getByLabelText(/^Next start/), '2026-02-07T10:30');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent.mock.calls.at(-1)![1]).toMatchObject({
      mode: 'recurring',
      recurrenceRootId: 'saturday-root',
    });
  });

  it('still drops it when the gathering becomes a one-off, which is a real move', async () => {
    // The mirror image, and the one case where losing the chain is the point: a
    // trip happens once, so it is keyed on itself. The security rules check the
    // chain either side of the write, so this is not a way out of a restricted
    // gathering — see `allow update` in firestore.rules.
    const user = userEvent.setup();
    show(saturday);

    await user.selectOptions(typeSelect('Type'), 'oneoff');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent.mock.calls.at(-1)![1]).toMatchObject({
      mode: 'oneoff',
      recurrenceRootId: null,
    });
  });
});
