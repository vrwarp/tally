import { useEffect, useState } from 'react';

/**
 * A clock that ticks, so temporal awareness (PRD 4.3) actually happens.
 *
 * Without this, a counselor who opens Tally at 6:45pm and leaves it on the
 * lock screen would still be looking at "no active event" when the doors open
 * at 7:00. The default minute cadence is plenty for event-window boundaries and
 * costs one re-render per minute.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);

    // Phones aggressively throttle timers in background tabs; re-sync the
    // moment the counselor comes back to the app.
    const resync = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, [intervalMs]);

  return now;
}
