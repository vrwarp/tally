/**
 * The Planning Center card, while it is still asking and once it knows.
 *
 * The loading state is the interesting one. `SkeletonRows` is `aria-hidden` by
 * design — three pulsing bars are furniture — so a screen-reader user used to
 * hear nothing at all between the card's description and the facts arriving.
 * One live region says what is in flight, and it goes away when the answer does
 * not need it any more.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanningCenterCard } from '@/features/settings/PlanningCenterCard';
import type { PcoStatus } from '@/types';

const fetchPlanningCenterStatus = vi.hoisted(() => vi.fn());
const readPlanningCenterConfig = vi.hoisted(() => vi.fn());
const refreshPlanningCenter = vi.hoisted(() => vi.fn());
const refreshRoster = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock('@/services/planningCenter', () => ({
  fetchPlanningCenterStatus,
  readPlanningCenterConfig,
}));
vi.mock('@/services/functions', () => ({ refreshPlanningCenter }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show }) }));
vi.mock('@/context/authContext', () => ({ useAuth: () => ({ profile: { role: 'core' } }) }));
vi.mock('@/context/dataContext', () => ({
  useData: () => ({ refreshRoster, rosterFetchedAt: null, rosterOffline: false }),
}));
// The editor is a modal that is shut here; the card is what is under test.
vi.mock('@/features/settings/PlanningCenterEditor', () => ({ PlanningCenterEditor: () => null }));

function status(overrides: Partial<PcoStatus> = {}): PcoStatus {
  return {
    configured: true,
    reachable: true,
    problem: null,
    writeBack: 'create',
    cacheTtlSeconds: 30,
    baseUrlOverridden: false,
    peopleVisible: 45,
    unresolved: 0,
    queued: 0,
    heldForReview: 0,
    settings: {
      minGrade: 6,
      maxGrade: 12,
      writeBack: 'create',
      cacheTtlSeconds: 30,
      baseUrl: 'https://api.planningcenteronline.com',
      managedInApp: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchPlanningCenterStatus.mockResolvedValue(status());
  readPlanningCenterConfig.mockResolvedValue(null);
  refreshRoster.mockResolvedValue(undefined);
});

describe('PlanningCenterCard', () => {
  it('says a read is in flight rather than pulsing silently', async () => {
    let settle: (value: PcoStatus) => void = () => {};
    fetchPlanningCenterStatus.mockReturnValue(
      new Promise<PcoStatus>((resolve) => {
        settle = resolve;
      }),
    );

    render(<PlanningCenterCard />);

    expect(screen.getByRole('status')).toHaveTextContent(/Checking the Planning Center connection/i);
    // One region, one voice: the shared skeleton's own announcement is hidden
    // here so a reader is not told "loading" twice in two different words.
    expect(screen.getAllByRole('status')).toHaveLength(1);

    settle(status());

    expect(await screen.findByText(/students visible/)).toBeInTheDocument();
    // Announced once, while there was nothing else to hear — not left behind
    // to be read again over the answer.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('answers the three questions the card exists for', async () => {
    render(<PlanningCenterCard />);

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Roster')).toBeInTheDocument();
    expect(screen.getByText('Write-back')).toBeInTheDocument();
    expect(screen.getByText('Freshness')).toBeInTheDocument();
  });

  it('spends a wide card on columns of fact rather than on line length', async () => {
    render(<PlanningCenterCard />);

    const facts = (await screen.findByText('Roster')).closest('dl');
    expect(facts).not.toBeNull();
    // `auto-fit` takes another column whenever 15rem is free for one, so the
    // list is columns on a wide laptop and a single readable column on a phone.
    expect(facts).toHaveClass('grid', 'lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]');
    expect(facts).not.toHaveClass('flex-col');
  });
});
