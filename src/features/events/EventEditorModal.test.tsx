/**
 * The two roster questions the editor asks, and which mode each belongs to.
 *
 * A recurring gathering predicts from its own past nights — the series picker
 * says which chain it is *in*, and leaving it empty costs it nothing. A one-off
 * has no past at all, so the prediction is a thing a leader hands it: the
 * gathering whose regulars are the people on the coach.
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

function show(event: TallyEvent | null = null) {
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

  return render(wrap(<EventEditorModal open onClose={() => {}} event={event} />));
}

const typeSelect = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

describe('EventEditorModal: the series picker on a recurring gathering', () => {
  /*
   * The lie this replaced. Prediction has grouped history by the repeat chain
   * for as long as the app has scheduled its own weekly events, so a blank
   * series has never meant a blank roster — it only ever meant "this gathering
   * is not one of the seeded ones".
   */
  it('does not claim that leaving it empty costs the roster its prediction', () => {
    show();

    expect(screen.getByRole('option', { name: /not part of one/i })).toBeInTheDocument();
    expect(screen.queryByText(/no predicted roster/i)).not.toBeInTheDocument();
  });

  it('offers the series documents, and nothing about borrowing', () => {
    show();

    expect(screen.getByRole('option', { name: 'Friday Fellowship' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Predicted roster')).not.toBeInTheDocument();
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
