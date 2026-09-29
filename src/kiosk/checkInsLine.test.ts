/**
 * The sentence the staff menu and the Check-ins screen share: said only while
 * something waits, and never with a time it does not have.
 */
import { renderHook } from '@/test/rtl';
import { describe, expect, it } from 'vitest';
import { useCheckInsLine, type CheckInsSummary } from '@/kiosk/checkInsLine';

const NINE_FORTY_ONE = new Date(2026, 8, 27, 9, 41).getTime();

function lineFor(summary: Partial<CheckInsSummary>): string | null {
  const { result } = renderHook(() =>
    useCheckInsLine({ count: 0, held: 0, problem: null, oldestAtMs: null, ...summary }),
  );
  return result.current;
}

describe('useCheckInsLine', () => {
  it('says nothing once nothing waits, whatever the last attempt ran into', () => {
    // The count is the journal's and the problem is the uploader's, read
    // separately; with nothing on the tablet there is nothing to send anybody
    // to the office about.
    expect(lineFor({ count: 0, problem: 'server' })).toBeNull();
    expect(lineFor({ count: 0, problem: 'network', oldestAtMs: NINE_FORTY_ONE })).toBeNull();
  });

  it('gives the oldest tap to the minute', () => {
    expect(lineFor({ count: 2, problem: 'network', oldestAtMs: NINE_FORTY_ONE })).toMatch(
      /^No internet since 9:41\sAM\.$/,
    );
  });

  it('names no time it does not have', () => {
    // `new Date(null)` is the epoch — a time nobody tapped at.
    expect(lineFor({ count: 2, problem: 'network', oldestAtMs: null })).toBeNull();
  });
});
