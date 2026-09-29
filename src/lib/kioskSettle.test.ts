import { describe, expect, it } from 'vitest';
import type { ParkReason } from '@/lib/kioskLanding';
import { isRecordable } from '@/lib/kioskSettle';

describe('isRecordable', () => {
  it('offers Record for a frozen child and for a pickup parked with its arrival, and for nothing else', () => {
    const reasons: Record<ParkReason, boolean> = {
      frozen: true,
      'arrival-parked': true,
      'gathering-deleted': false,
      'no-arrival': false,
      unreadable: false,
    };
    for (const [reason, recordable] of Object.entries(reasons)) {
      expect(isRecordable(reason as ParkReason), reason).toBe(recordable);
    }
  });
});
