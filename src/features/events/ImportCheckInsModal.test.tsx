/**
 * The Check-Ins import modal, at the seams that matter to the person using it:
 * the list has to carry enough history to pick the right event, the import has
 * to be visibly in flight (it can run for a minute), and both the summary and
 * a failure have to land somewhere readable rather than in a toast that
 * evaporates. The import itself — what gets written, what gets skipped — is
 * the Cloud Function's job and is tested in functions/src/pco.
 */
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastProvider } from '@/context/ToastProvider';
import { ImportCheckInsModal } from '@/features/events/ImportCheckInsModal';
import { makeSettings } from '../../../tests/factories';
import type { CheckInsEventSummary, CheckInsImportSummary } from '@/types';

const listCheckInsEvents = vi.hoisted(() => vi.fn());
const importCheckInsEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({
  USE_EMULATORS: false,
  firebaseApp: {},
  db: {},
  auth: {},
  popupRedirectResolver: vi.fn(),
}));
vi.mock('@/services/functions', () => ({ listCheckInsEvents, importCheckInsEvent }));

const FOOTPRINTS: CheckInsEventSummary = {
  id: '698430',
  name: 'Footprints',
  frequency: 'Weekly',
  gatheringCount: 131,
  checkInCount: 1704,
  firstGatheringAt: '2024-01-27T03:30:00Z',
  alreadyImported: false,
};

const SUMMARY: CheckInsImportSummary = {
  pcoEventId: '698430',
  eventName: 'Footprints',
  rootEventId: 'pco-checkins-698430',
  gatherings: { found: 131, created: 94, existing: 0, skippedEmpty: 37 },
  students: { found: 110, added: 108, existing: 2 },
  checkIns: {
    found: 1704,
    written: 1700,
    kept: 0,
    skippedVolunteers: 0,
    skippedOneTimeGuests: 0,
    duplicatesCollapsed: 4,
  },
  warnings: [],
};

const refreshRoster = vi.fn(async () => {});

function renderModal() {
  const data = {
    students: [],
    events: [],
    series: [],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: null,
    rosterBackends: [],
    refreshRoster,
  } as unknown as DataContextValue;

  return render(
    <ToastProvider>
      <MemoryRouter>
        <DataContext.Provider value={data}>
          <ImportCheckInsModal open onClose={vi.fn()} />
        </DataContext.Provider>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('ImportCheckInsModal', () => {
  it('lists each event with the history a leader recognises it by', async () => {
    listCheckInsEvents.mockResolvedValue({ data: { events: [FOOTPRINTS] } });
    renderModal();

    expect(await screen.findByText('Footprints')).toBeInTheDocument();
    // Not decoration: "131 gatherings since Jan 2024" is how somebody tells
    // the real Footprints from a test event with a similar name.
    expect(screen.getByText(/131 gatherings/)).toBeInTheDocument();
    expect(screen.getByText(/1,704 check-ins/)).toBeInTheDocument();
    expect(screen.getByText(/since Jan 2024/)).toBeInTheDocument();
  });

  it('imports on demand and reports what arrived', async () => {
    listCheckInsEvents.mockResolvedValue({ data: { events: [FOOTPRINTS] } });
    importCheckInsEvent.mockResolvedValue({ data: SUMMARY });
    renderModal();

    await userEvent.click(await screen.findByRole('button', { name: 'Import' }));

    await waitFor(() =>
      expect(importCheckInsEvent).toHaveBeenCalledWith({ pcoEventId: '698430', backendId: 'pco' }),
    );
    expect(await screen.findByText('Footprints is in Tally')).toBeInTheDocument();
    // The skipped weeks are said out loud: "94 of 131" with no explanation
    // reads as an import that lost a quarter of the history.
    expect(screen.getByText(/37 empty weeks skipped/)).toBeInTheDocument();
    expect(screen.getByText(/110 students on the roster \(108 added\)/)).toBeInTheDocument();
    expect(screen.getByText(/1,700 check-ins imported/)).toBeInTheDocument();
    // New roster members must reach the next roster read.
    expect(refreshRoster).toHaveBeenCalledWith(true);
  });

  it('marks an already-imported event and still offers a re-import', async () => {
    listCheckInsEvents.mockResolvedValue({
      data: { events: [{ ...FOOTPRINTS, alreadyImported: true }] },
    });
    renderModal();

    expect(await screen.findByText('Imported')).toBeInTheDocument();
    // Re-importing is the supported way to top a chain up — the button must
    // not disappear the moment the first import lands.
    expect(screen.getByRole('button', { name: 'Re-import' })).toBeEnabled();
  });

  it('keeps a failure on screen rather than in a toast', async () => {
    listCheckInsEvents.mockResolvedValue({ data: { events: [FOOTPRINTS] } });
    // The server's own sentence travels when there is one — `pcoErrorReport`
    // only falls back to a generic line for errors with nothing readable.
    importCheckInsEvent.mockRejectedValue(
      new Error('Planning Center is rate-limiting us. Try again in a moment.'),
    );
    renderModal();

    await userEvent.click(await screen.findByRole('button', { name: 'Import' }));

    expect(
      await screen.findByText('Planning Center is rate-limiting us. Try again in a moment.'),
    ).toBeInTheDocument();
    // And the list is still there to try again from.
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });
});
