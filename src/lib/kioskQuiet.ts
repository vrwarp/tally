/**
 * What Tally can say about a gathering's lobby kiosk without seeing it — the
 * rule the event page and the counselors' register share, so they cannot tell
 * two stories about one tablet (docs/kiosk-offline-recovery.md §7).
 *
 * **Out of touch.** A kiosk leaves its gathering on its device row when it
 * loses the internet, because the report that would clear it never lands; so a
 * row set to a chain and gone quiet is, almost always, a kiosk still recording
 * in a lobby whose internet went. But a chain recurs, and the same row — still
 * set to Sunday Kids — would otherwise speak on every later Sunday about a
 * tablet that went quiet weeks ago and may be in a cupboard. So its silence
 * speaks only for the occurrence it began on: last heard from on that
 * gathering's day, from the morning its check-in window opens to the evening
 * it ends. A kiosk is often set to a gathering before the window opens, and one
 * that lost the internet at 8:50 is still the one taking the 9:00 check-ins.
 *
 * **Arrived late.** A record the kiosk kept through an outage reaches Tally
 * with its tap's own time and a later `recordedAt`. Late means longer than the
 * kiosk itself waits before telling its staff it is out of touch: a record
 * that sat on the tablet through a blip is not worth a line.
 */
import { endOfDay, startOfDay } from 'date-fns';
import { deviceIdOfUid } from '@/lib/kioskDevice';
import type { AttendanceRecord } from '@/types';

/**
 * How recently a bound kiosk must have reported to count as live.
 *
 * The kiosk writes `lastSeenAt` on every register poll, which is every five
 * minutes while it is bound (`PRESENT_REFRESH_MS` in `KioskApp`) — so twelve
 * minutes is two missed reports and some slack. It was three, on a comment
 * that said the poll ran every thirty seconds: a healthy kiosk read *not
 * recording* two minutes in every five, and was retired on one unconfirmed
 * tap while it did (docs/kiosk-offline-recovery.md). Widened rather than
 * reported more often, because a report is a write per kiosk per poll and the
 * window only has to be true.
 */
export const KIOSK_LIVE_WITHIN_MS = 12 * 60_000;

/**
 * A record that reached Tally this long after its tap sat on the tablet
 * through an outage. The kiosk's own `OFFLINE_NOTICE_AFTER_MS`, and the
 * landing's `HELD_LATE_MS`, so the event page's "arrived late" and the Kiosk
 * page's "all in Tally since" agree. A copy rather than an import: this module
 * is the main app's, and `kioskLanding` is the kiosk's first paint.
 */
export const LATE_AFTER_MS = 10 * 60_000;

/** The parts of a gathering its day is measured from. */
export interface GatheringDay {
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  endAt?: Date | null;
}

/**
 * Whether a kiosk last heard from at `lastSeenAt` went quiet on this
 * gathering's day and is quiet still.
 */
export function quietOn(lastSeenAt: Date | null, gathering: GatheringDay, nowMs: number): boolean {
  if (lastSeenAt === null) return false;
  const seenMs = lastSeenAt.getTime();
  if (nowMs - seenMs < KIOSK_LIVE_WITHIN_MS) return false;
  const endsMs = Math.max(gathering.checkInClosesAt.getTime(), gathering.endAt?.getTime() ?? 0);
  return (
    seenMs >= startOfDay(gathering.checkInOpensAt).getTime() && seenMs <= endOfDay(endsMs).getTime()
  );
}

/** What one kiosk's outage left on a gathering's register. */
export interface LateFromKiosk {
  deviceId: string;
  /** Arrivals and pickups the kiosk recorded that reached Tally late. */
  count: number;
  /** When the last of them arrived — the moment the register was whole again. */
  allInAt: Date;
}

/**
 * The records each kiosk kept through an outage, by kiosk: arrivals it
 * witnessed whose `recordedAt` came late, and pickups likewise. A record a
 * person made, or one the kiosk landed in the moment, says nothing here.
 */
export function lateFromKiosks(attendance: readonly AttendanceRecord[]): LateFromKiosk[] {
  const byDevice = new Map<string, LateFromKiosk>();
  const note = (by: string | null | undefined, happenedAt: Date | null, recordedAt?: Date) => {
    const deviceId = by ? deviceIdOfUid(by) : null;
    if (deviceId === null || happenedAt === null || recordedAt === undefined) return;
    if (recordedAt.getTime() - happenedAt.getTime() <= LATE_AFTER_MS) return;
    const held = byDevice.get(deviceId);
    if (held === undefined) {
      byDevice.set(deviceId, { deviceId, count: 1, allInAt: recordedAt });
      return;
    }
    held.count += 1;
    // Stryker disable next-line EqualityOperator: equal instants are one moment, whichever Date carries it.
    if (recordedAt > held.allInAt) held.allInAt = recordedAt;
  };
  for (const record of attendance) {
    note(record.checkedInBy, record.checkedInAt, record.recordedAt);
    note(record.checkedOutBy, record.checkedOutAt, record.checkedOutRecordedAt);
  }
  return [...byDevice.values()].sort((a, b) => b.count - a.count || a.deviceId.localeCompare(b.deviceId));
}
