/**
 * The kiosk's one road, for tests that mock the services chunk.
 *
 * `landEverything` is a Tally that is up and takes every record it is sent;
 * `sentRecords` reads back what a mocked `landRecords` was given — the kiosk
 * tests' way of asking "what did this press record?", now that the kiosk
 * records through the journal and the uploader rather than writing the
 * register itself.
 */
import { vi } from 'vitest';
import type {
  KioskRecordKind,
  KioskRecordWire,
  LandKioskRecordsRequest,
  LandKioskRecordsResponse,
} from '@/lib/kioskLanding';

export async function landEverything(
  request: LandKioskRecordsRequest,
): Promise<LandKioskRecordsResponse> {
  return { outcomes: request.records.map((record) => ({ id: record.id, outcome: 'landed' })) };
}

type Land = (request: LandKioskRecordsRequest) => Promise<LandKioskRecordsResponse>;

/** Every record `land` was sent, in the order sent — of one kind, if asked. */
export function sentRecords(land: Land, kind?: KioskRecordKind): KioskRecordWire[] {
  return vi
    .mocked(land)
    .mock.calls.flatMap(([request]) => request.records)
    .filter((record) => kind === undefined || record.kind === kind);
}

/** The children `land` was sent a record of this kind for, sorted. */
export function sentStudentIds(land: Land, kind: KioskRecordKind): string[] {
  return sentRecords(land, kind)
    .map((record) => record.studentId)
    .sort();
}

/**
 * A Tally that is up, with a register behind it: whatever lands is on the next
 * read. The kiosk's room lets go of its own taps once a read has spoken for
 * them (see `room.ts`), so a test that polls after a check-in needs a register
 * that has heard of it — `landEverything` alone reads as a leader removing
 * every child the moment they arrive.
 */
export function fakeRegister() {
  const present = new Set<string>();
  const checkedOut = new Set<string>();
  const arrivals = new Map<string, string>();
  return {
    present,
    checkedOut,
    arrivals,
    async land(request: LandKioskRecordsRequest): Promise<LandKioskRecordsResponse> {
      for (const record of request.records) {
        present.add(record.studentId);
        if (record.kind === 'check-out') checkedOut.add(record.studentId);
        else if (record.arrivalId) arrivals.set(record.studentId, record.arrivalId);
      }
      return landEverything(request);
    },
    async read() {
      return {
        present: new Set(present),
        checkedOut: new Set(checkedOut),
        arrivals: new Map(arrivals),
      };
    },
    reset(): void {
      present.clear();
      checkedOut.clear();
      arrivals.clear();
    },
  };
}
