/**
 * The one sentence the kiosk says about the records still on it — on the staff
 * menu's row and at the head of the Check-ins screen, so the two cannot drift.
 */
import { useLocale, useTranslations } from 'use-intl';

/**
 * What this tablet holds that Tally does not have yet — see `journal.ts`.
 *
 * `held` is the part of `count` that could not even be written to the disk and
 * lives only in this page: the one state in which a reload can still lose a
 * record, and so the one this screen says most loudly.
 */
export interface CheckInsSummary {
  count: number;
  held: number;
  /** What stopped the last attempt to send them, if anything did. */
  problem: 'network' | 'server' | null;
  oldestAtMs: number | null;
}

/**
 * The sentence about what is waiting, worded from what the last attempt hit —
 * or null when there is nothing a person needs to hear: nothing waits, or the
 * first attempt has not come back yet.
 *
 * *Waiting for the internet* is a matter of time and asks nothing. *Tally isn't
 * taking them* asks for the office, because a server error should reach a
 * person rather than wait politely. And *not saved* asks the one thing that
 * matters while it lasts: don't reload.
 */
export function useCheckInsLine(summary: CheckInsSummary): string | null {
  const t = useTranslations('Staff');
  const locale = useLocale();
  if (summary.held > 0) return t('checkInsHeld', { count: summary.held });
  if (summary.count === 0) return null;
  if (summary.problem === 'server') return t('checkInsServer');
  if (summary.problem === 'network' && summary.oldestAtMs !== null) {
    return t('checkInsNetwork', {
      time: new Date(summary.oldestAtMs).toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
  }
  return null;
}
