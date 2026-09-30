/**
 * How many of the lobby kiosk's parked records wait for a decision — the count
 * the Review item in the navigation shows (docs/kiosk-offline-recovery.md §5).
 *
 * Counted as the cards Review draws, one per child and gathering, so the number
 * beside the word is the number of things to decide. Core and up only, as the
 * records are: for anybody else it asks nothing and says nothing, and a refused
 * or failed read is simply no count — the page itself says what went wrong.
 */
import { useEffect, useState } from 'react';
import { parkedCards, subscribeUnsettledParkedRecords } from '@/services/kioskParkedRecords';

export function useKioskParkedCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    return subscribeUnsettledParkedRecords(
      (rows) => setCount(parkedCards(rows).length),
      () => setCount(0),
    );
  }, [enabled]);

  return count;
}
