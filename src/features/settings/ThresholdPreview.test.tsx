/**
 * What the preview says before it can say anything.
 *
 * The waiting state used to be a sentence where a 110px panel was going to be,
 * and on a phone what sits under this is the Save button and three more cards
 * — so all of them moved the moment Planning Center answered. It wears the
 * panel's own frame now, which is the reservation: the same box, the same
 * heading, the same line at its foot, and an em dash where the count will be.
 * The sentence is still said, once, to a reader who cannot see the dash.
 */
import { render, screen } from '@/test/rtl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThresholdPreview } from '@/features/settings/ThresholdPreview';
import { makeSettings } from '../../../tests/factories';

const useData = vi.hoisted(() => vi.fn());
const useEventSnapshots = vi.hoisted(() => vi.fn());

vi.mock('@/context/dataContext', () => ({ useData }));
vi.mock('@/hooks/useEventSnapshots', () => ({ useEventSnapshots }));

const settings = makeSettings();
const draft = {
  predictiveMinAttended: settings.predictiveMinAttended,
  predictiveOfLastN: settings.predictiveOfLastN,
  miaConsecutiveMisses: settings.miaConsecutiveMisses,
};

function mount(valid = true) {
  return render(<ThresholdPreview draft={draft} saved={draft} valid={valid} />);
}

describe('ThresholdPreview', () => {
  beforeEach(() => {
    useData.mockReset();
    useEventSnapshots.mockReset();
    useData.mockReturnValue({
      students: [],
      events: [],
      series: [],
      settings,
      canWork: () => true,
    });
  });

  it('waits in the panel it is going to be, not in a sentence', () => {
    useEventSnapshots.mockReturnValue({ snapshots: [], denied: new Set(), loading: true, error: null });

    mount();

    // The frame's two fixed parts, which are what the room is reserved for.
    expect(screen.getByText('With your ministry as it stands today')).toBeInTheDocument();
    expect(screen.getByText('Flagged as stopped coming')).toBeInTheDocument();
    // Said once, where the dash cannot be seen.
    expect(screen.getByRole('status')).toHaveTextContent('Working out what these thresholds mean');
  });

  it('says so plainly when the values are the problem rather than the read', () => {
    useEventSnapshots.mockReturnValue({ snapshots: [], denied: new Set(), loading: true, error: null });

    mount(false);

    expect(screen.getByText(/Fix the values above/)).toBeInTheDocument();
    expect(screen.queryByText('With your ministry as it stands today')).not.toBeInTheDocument();
  });

  it('says a ministry with no history has none, rather than waiting forever', () => {
    useEventSnapshots.mockReturnValue({ snapshots: [], denied: new Set(), loading: false, error: null });

    mount();

    expect(screen.getByText(/Once a few gatherings have happened/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
