import { describe, expect, it } from 'vitest';
import { waitingDays } from '@/features/dashboard/waitingDays';

const now = new Date('2026-03-10T12:00:00Z');

describe('waitingDays', () => {
  it('counts whole days since the profile was created', () => {
    expect(waitingDays({ createdAt: new Date('2026-03-07T12:00:00Z') }, now)).toBe(3);
    expect(waitingDays({ createdAt: new Date('2026-03-07T18:00:00Z') }, now)).toBe(2);
  });

  it('is zero for a profile created today, or in the future', () => {
    expect(waitingDays({ createdAt: new Date('2026-03-10T09:00:00Z') }, now)).toBe(0);
    expect(waitingDays({ createdAt: new Date('2026-03-12T12:00:00Z') }, now)).toBe(0);
  });

  it('cannot say for a student whose createdAt is the epoch', () => {
    expect(waitingDays({ createdAt: new Date(0) }, now)).toBeNull();
  });
});
