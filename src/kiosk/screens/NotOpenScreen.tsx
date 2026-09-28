/**
 * The one thing the kiosk refuses outright — and, at the foot of this file, the
 * one thing it cannot do without the internet.
 *
 * Everywhere else this app fails towards writing something down: an offline
 * check-in waits on the tablet, a closed window still records, a refusal leaves
 * the row green because the child is standing there whatever the database
 * thinks. This screen is the exception, and it is the exception because the
 * mistake it catches is not recoverable by being generous — attendance written
 * against a gathering that has not happened is wrong on a register somebody
 * will trust next week, and nothing on the front door would ever have shown it.
 *
 * Shaped like SuccessScreen deliberately: same geometry, same tap-anywhere
 * dismissal, same auto-return to blank glass. A parent who gets here has done
 * nothing wrong and is about to hand the tablet to the next family, so the
 * screen must clear itself exactly as a tick would. What differs is the mark
 * and the colour — a neutral clock rather than the green tick, because the one
 * thing a parent must not take away from this is that they are checked in.
 *
 * The date is on it, and that is the half aimed at staff rather than at the
 * family: a lobby screen set one row off shows plausible clock times all
 * evening, and "opens Wednesday, Aug 19" is the sentence that gets a volunteer
 * to the chooser.
 */
import { useEffect, useRef } from 'react';
import { useTranslations } from 'use-intl';
import { useTap } from '../components/tapGuard';

const AUTO_RETURN_MS = 6000;

/**
 * The shape both refusals share: a neutral mark, what happened, what to do,
 * and the glass handing itself back — tap anywhere, or wait.
 */
function DoorNotice({
  mark,
  title,
  lines,
  onDone,
}: {
  mark: string;
  title: string;
  /** The first line is the answer; the second, when there is one, the aside. */
  lines: readonly string[];
  onDone: () => void;
}) {
  const t = useTranslations('Door');
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const tap = useTap();

  /*
   * Longer than the tick's four seconds. A green tick is confirming something
   * the parent already believes and needs only to glance at; this is telling
   * them something they did not expect and will read twice.
   */
  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(), AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center"
      {...tap(() => doneRef.current())}
    >
      <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full bg-ink-700 text-8xl">
        {mark}
      </div>
      <div>
        <div className="text-4xl font-bold text-ink-50">{title}</div>
        {lines[0] && <div className="pt-3 text-2xl text-ink-300">{lines[0]}</div>}
        {lines[1] && <div className="pt-3 text-xl text-ink-500">{lines[1]}</div>}
      </div>
      <div className="text-lg text-ink-500">{t('tapToCarryOn')}</div>
    </div>
  );
}

export function NotOpenScreen({ opensAt, onDone }: { opensAt: string; onDone: () => void }) {
  const t = useTranslations('Door');
  return (
    <DoorNotice
      mark="🕑"
      title={t('notOpenTitle')}
      lines={[t('notOpenWhen', { when: opensAt }), t('notThisGathering')]}
      onDone={onDone}
    />
  );
}

/**
 * *First time here?* on a kiosk that cannot reach Tally.
 *
 * A registration is one call to the server — it cannot wait on the tablet the
 * way a check-in can, because the family's number may live only inside that
 * call and a kiosk may not write a student itself — so the wizard would ask a
 * parent six screens of questions and then fail, or print name tags for a
 * family that was never saved. This says so before the first question instead:
 * a leader adds them on a phone (docs/kiosk-offline-recovery.md §8).
 */
export function SeeALeaderScreen({ onDone }: { onDone: () => void }) {
  const t = useTranslations('Door');
  return <DoorNotice mark="👋" title={t('leaderTitle')} lines={[t('leaderWhy')]} onDone={onDone} />;
}
