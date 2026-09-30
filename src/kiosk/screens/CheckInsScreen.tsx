/**
 * What is still on this tablet, for the person deciding what to do about it.
 *
 * Behind the staff row that counts it, and behind the corner mark when a record
 * could not even be written to the disk. Its reader is a volunteer who has been
 * told the kiosk "isn't working", or somebody from the office on the phone to
 * one — and the most important thing on it is the sentence at the top, not the
 * list: these send themselves, so nobody has to do anything. The line under it
 * says why they are waiting, and asks for something only when a record is not
 * saved yet (docs/kiosk-offline-recovery.md).
 *
 * The list is oldest first, the order they will go in, and each row says what
 * its last attempt ran into in words a person can repeat to the office. **Try
 * now** starts a pass at once rather than waiting out the thirty-second clock;
 * it cannot make anything worse, so it asks nothing.
 *
 * It stays up for minutes, not the staff gate's forty-five seconds: somebody
 * reading it out over the phone or photographing it touches nothing while they
 * do. See `STAFF_READING_MS`.
 */
import { useLocale, useTranslations } from 'use-intl';
import { haptic } from '@/lib/utils';
import type { KioskRecord } from '../journal';
import { useTap } from '../components/tapGuard';
import { StaffMark } from '../components/StaffMark';

/** One row's words for what its last attempt ran into. */
function statusKey(
  record: KioskRecord,
  held: boolean,
): 'recordHeld' | 'recordNotSent' | 'recordNoInternet' | 'recordServer' | 'recordArrival' {
  if (held) return 'recordHeld';
  if (record.attempts === 0) return 'recordNotSent';
  if (record.lastProblem === 'arrival') return 'recordArrival';
  if (record.lastProblem === 'server') return 'recordServer';
  return 'recordNoInternet';
}

export function CheckInsScreen({
  records,
  nameOf,
  isHeld,
  sending,
  line,
  onTryNow,
  onDone,
  returnsTo,
}: {
  /** The journal, oldest tap first. */
  records: readonly KioskRecord[];
  /** A name for a record that carries none — a pickup, from the roster. */
  nameOf: (studentId: string) => string | null;
  /** Whether a record exists only in this page. */
  isHeld: (id: string) => boolean;
  /** A pass under way: how many it set out with, and how many are left. */
  sending: { total: number; left: number } | null;
  /** What the staff row says about the whole list, when it says anything. */
  line: string | null;
  onTryNow: () => void;
  onDone: () => void;
  /** Where **Done** goes, said on it: the staff menu, or the front door. */
  returnsTo: 'staff' | 'check-in';
}) {
  const t = useTranslations('Staff');
  const locale = useLocale();
  const tap = useTap();
  const today = new Date().toDateString();

  const when = (record: KioskRecord): string => {
    const at = new Date(record.tappedAtMs);
    const time = at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const stamp =
      at.toDateString() === today
        ? time
        : `${at.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
    return record.approximate ? t('recordAbout', { time: stamp }) : stamp;
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6 pt-[max(1.5rem,var(--spacing-safe-top))] text-center">
      <StaffMark label="staffCheckIns" />

      {records.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className="text-3xl font-semibold text-ink-100 tall:text-4xl">{t('checkInsAllIn')}</div>
          <p className="max-w-xl text-lg text-ink-400 tall:text-xl">{t('checkInsNothingWaiting')}</p>
        </div>
      ) : (
        <>
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            <p className="text-xl text-ink-100 tall:text-2xl">{t('checkInsAbout')}</p>
            {sending ? (
              <p className="text-lg text-ink-300 tall:text-xl">
                {t('checkInsSending', { total: sending.total, left: sending.left })}
              </p>
            ) : line ? (
              <p className="text-lg text-warn-400 tall:text-xl">{line}</p>
            ) : null}
          </div>

          <ul className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-2 overflow-y-auto overscroll-contain scroll-touch text-left">
            {records.map((record) => {
              const held = isHeld(record.id);
              const name = record.student
                ? `${record.student.firstName} ${record.student.lastName}`
                : (nameOf(record.studentId) ?? t('someone'));
              return (
                <li key={record.id} className="flex flex-col rounded-xl bg-ink-800 px-5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-xl font-semibold text-ink-100 tall:text-2xl">
                      {name}
                    </span>
                    <span className="shrink-0 text-lg whitespace-nowrap text-ink-300 tall:text-xl">
                      {t(record.kind === 'check-in' ? 'recordIn' : 'recordOut')} · {when(record)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-base tall:text-lg">
                    <span className="min-w-0 truncate text-ink-400">{record.gathering}</span>
                    <span className={`shrink-0 ${held ? 'text-warn-400' : 'text-ink-400'}`}>
                      {t(statusKey(record, held))}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mx-auto flex w-full max-w-2xl gap-3">
        {records.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            {...tap(() => {
              haptic();
              onTryNow();
            })}
            className="flex h-16 flex-1 items-center justify-center rounded-xl bg-brand-600 text-xl font-semibold text-white active:bg-brand-500 tall:text-2xl"
          >
            {t('checkInsTryNow')}
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          {...tap(() => {
            haptic();
            onDone();
          })}
          className="flex h-16 flex-1 items-center justify-center rounded-xl bg-ink-800 px-4 text-xl font-semibold text-ink-100 active:bg-ink-700 tall:text-2xl"
        >
          <span className="min-w-0 truncate">
            {returnsTo === 'staff' ? t('back') : t('doneBackToCheckIn')}
          </span>
        </button>
      </div>
    </div>
  );
}
