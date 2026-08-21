/**
 * The two states of Insights that have nothing to report yet.
 *
 * Both used to answer with something more confident than the truth. A ministry
 * that has just installed Tally got four tiles of zeros — "MIA 0 · 3+ missed in
 * a row", and a "Last gathering 0 · first one in this window" delta about a
 * gathering that does not exist — printed directly above a card saying there
 * are no gatherings on record. And while the reads were in flight the left
 * column held a skeleton while every branch of the right one rendered nothing,
 * so half the screen was blank for the length of the load and then three cards
 * arrived at once.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { makeSettings } from '../../../tests/factories';

const useData = vi.hoisted(() => vi.fn());
const useEventSnapshots = vi.hoisted(() => vi.fn());
const useParentContact = vi.hoisted(() => vi.fn());

vi.mock('@/context/dataContext', () => ({ useData }));
vi.mock('@/hooks/useEventSnapshots', () => ({ useEventSnapshots }));
vi.mock('@/hooks/useParentContact', () => ({ useParentContact }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/services/functions', () => ({
  getPersonDetails: vi.fn().mockResolvedValue({ data: null }),
  setParentContact: vi.fn(),
  addParent: vi.fn(),
}));

/** A ministry with nothing on record: no calendar, no history, a settled roster. */
function emptyMinistry(overrides: Record<string, unknown> = {}) {
  useData.mockReturnValue({
    students: [],
    events: [],
    series: [],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterBackends: [],
    canWork: () => true,
    ...overrides,
  });
  useParentContact.mockReturnValue({
    reachable: new Map(),
    loading: false,
    loaded: true,
    error: null,
    refresh: vi.fn(),
  });
}

function mount() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    useData.mockReset();
    useEventSnapshots.mockReset();
    useParentContact.mockReset();
  });

  it('says nothing has been recorded rather than answering with zeros', () => {
    emptyMinistry();
    useEventSnapshots.mockReturnValue({
      snapshots: [],
      denied: new Set(),
      loading: false,
      error: null,
    });

    mount();

    expect(screen.getAllByText('No gatherings on record yet.').length).toBeGreaterThan(0);
    // The tiles are the claim: four zeros about a ministry read as "you have
    // nobody" rather than "nobody has been counted yet".
    expect(screen.queryByText('Last gathering')).not.toBeInTheDocument();
    expect(screen.queryByText('MIA')).not.toBeInTheDocument();
    // And the delta about the gathering that never happened, which is the line
    // that gave the zeros their authority.
    expect(screen.queryByText(/first one in this window/)).not.toBeInTheDocument();
  });

  it('holds both columns while the history is in flight, and announces once', () => {
    emptyMinistry();
    useEventSnapshots.mockReturnValue({
      snapshots: [],
      denied: new Set(),
      loading: true,
      error: null,
    });

    const { container } = mount();

    // One live region, not two: the skeleton makes its own from `label`, and
    // the card used to add a second sentence of its own beside it.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Loading attendance history');

    // The right column's placeholder — silent, and only where there are
    // columns to hold open.
    const rightColumn = container.querySelector('section.hidden');
    expect(rightColumn).not.toBeNull();
    expect(rightColumn).toHaveClass('lg:block');
    expect(rightColumn!.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });
});
