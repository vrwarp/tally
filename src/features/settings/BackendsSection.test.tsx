/**
 * The Attendees card, and the one that only exists once there are two backends.
 *
 * Same two things as the Planning Center card beside it: a wait a screen reader
 * can hear, and facts laid out in columns when the card has width for columns
 * rather than as full-measure lines because the page frame is wide.
 */
import { render, screen, waitFor } from '@/test/rtl';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendsSection } from '@/features/settings/BackendsSection';
import type { BackendStatus, BackendStatuses } from '@/types';

const fetchBackendStatuses = vi.hoisted(() => vi.fn());
const readAttendees32Config = vi.hoisted(() => vi.fn());
const saveDefaultPushBackend = vi.hoisted(() => vi.fn());
const refreshPlanningCenter = vi.hoisted(() => vi.fn());
const refreshRoster = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock('@/services/backends', () => ({
  fetchBackendStatuses,
  readAttendees32Config,
  saveDefaultPushBackend,
  readA32EffectiveSettings: (settings: Record<string, unknown>) => ({
    enabled: settings.enabled !== false,
    baseUrl: '',
    divisionId: '',
    meetSlug: '',
    characterSlug: '',
    assemblySlug: '',
    minGrade: 6,
    maxGrade: 12,
    writeBack: settings.writeBack ?? 'off',
    cacheTtlSeconds: 30,
    managedInApp: settings.managedInApp === true,
  }),
}));
vi.mock('@/services/functions', () => ({ refreshPlanningCenter }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show }) }));
vi.mock('@/context/authContext', () => ({
  useAuth: () => ({ profile: { role: 'core' }, user: { uid: 'leader-1' } }),
}));
vi.mock('@/context/dataContext', () => ({ useData: () => ({ refreshRoster }) }));
vi.mock('@/features/settings/Attendees32Editor', () => ({ Attendees32Editor: () => null }));

function backend(overrides: Partial<BackendStatus> = {}): BackendStatus {
  return {
    backendId: 'a32',
    displayName: 'Attendees',
    enabled: true,
    configured: true,
    reachable: true,
    problem: null,
    writeBack: 'create',
    cacheTtlSeconds: 30,
    peopleVisible: 12,
    unresolved: 0,
    capabilities: null,
    settings: { writeBack: 'create' },
    ...overrides,
  };
}

function statuses(overrides: Partial<BackendStatuses> = {}): BackendStatuses {
  return {
    backends: [backend()],
    defaultPushBackend: 'pco',
    queued: 0,
    heldForReview: 0,
    ...overrides,
  };
}

function mount() {
  return render(
    <MemoryRouter>
      <BackendsSection />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchBackendStatuses.mockResolvedValue(statuses());
  readAttendees32Config.mockResolvedValue(null);
  refreshRoster.mockResolvedValue(undefined);
});

describe('BackendsSection', () => {
  it('says a probe is in flight rather than pulsing silently', async () => {
    let settle: (value: BackendStatuses) => void = () => {};
    fetchBackendStatuses.mockReturnValue(
      new Promise<BackendStatuses>((resolve) => {
        settle = resolve;
      }),
    );

    mount();

    expect(screen.getByRole('status')).toHaveTextContent(/Checking the Attendees connection/i);
    expect(screen.getAllByRole('status')).toHaveLength(1);

    settle(statuses());

    expect(await screen.findByText(/students visible/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('spends a wide card on columns of fact rather than on line length', async () => {
    mount();

    const facts = (await screen.findByText('Roster')).closest('dl');
    expect(facts).not.toBeNull();
    expect(facts).toHaveClass('grid', 'lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]');
    expect(facts).not.toHaveClass('flex-col');
  });

  it('asks where new students go only once there is a choice', async () => {
    mount();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('New students')).not.toBeInTheDocument();

    fetchBackendStatuses.mockResolvedValue(
      statuses({
        backends: [backend(), backend({ backendId: 'pco', displayName: 'Planning Center' })],
      }),
    );
    mount();

    expect(await screen.findByText('New students')).toBeInTheDocument();
  });
});
