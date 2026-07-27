import { useEffect, useState } from 'react';
import { subscribeAttendance } from '@/services/attendance';
import { subscribeRsvps } from '@/services/rsvps';
import type { AttendanceRecord, Rsvp } from '@/types';

/**
 * Live check-in state for one event (PRD 4.1).
 *
 * This is the stream that makes multi-counselor check-in work: when Counselor A
 * taps a student, Counselor B's roster updates from this listener without a
 * refresh.
 */
export function useAttendance(eventId: string | null): {
  attendance: AttendanceRecord[];
  loading: boolean;
  error: string | null;
} {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) {
      setAttendance([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Clearing here prevents the previous event's check-ins from flashing on
    // screen while the new listener warms up.
    setAttendance([]);

    const unsubscribe = subscribeAttendance(
      eventId,
      (records) => {
        setAttendance(records);
        setLoading(false);
        setError(null);
      },
      (cause) => {
        setError(cause.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [eventId]);

  return { attendance, loading, error };
}

/** Live RSVP list for one event — the check-in roster when `requiresRsvp` is set. */
export function useRsvps(eventId: string | null, enabled = true): {
  rsvps: Rsvp[];
  loading: boolean;
  error: string | null;
} {
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(Boolean(eventId) && enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !enabled) {
      setRsvps([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setRsvps([]);

    const unsubscribe = subscribeRsvps(
      eventId,
      (records) => {
        setRsvps(records);
        setLoading(false);
        setError(null);
      },
      (cause) => {
        setError(cause.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [eventId, enabled]);

  return { rsvps, loading, error };
}
