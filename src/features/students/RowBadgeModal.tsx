/**
 * What happens when somebody presses a badge on the roster.
 *
 * The roster's badges used to be labels. Every one of them names something a
 * leader would then have to go and do somewhere else: open the student, read
 * the allergy, find the parent, remember to come back. That is four navigations
 * to answer a question the row already asked, and on a list of eighty-five it
 * is the reason the flags get scanned past rather than worked.
 *
 * So each badge is the way in to its own fact. One panel, one action, and the
 * roster is still underneath when it closes — a leader working the "incomplete
 * profiles" filter can go down the list without ever leaving it.
 *
 * Deliberately *not* a second copy of the student editor. Everything here is
 * the single narrowest action the badge implies; anything else is what the
 * detail page is for, and every panel can get there in one press.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, ErrorBanner, Modal, Spinner } from '@/components/ui';
import { EditBirthday } from '@/features/students/EditBirthday';
import { ParentContactPanel } from '@/features/students/ParentContactModal';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { invalidateParentContact } from '@/hooks/useParentContact';
import { invalidatePersonDetails, usePersonDetails } from '@/hooks/usePersonDetails';
import { birthdayState, formatBirthdayLong, type BirthdayState } from '@/lib/birthday';
import { pcoPersonUrl } from '@/lib/planningCenter';
import { formatShortDate } from '@/lib/time';
import { pushStudentToPlanningCenter } from '@/services/functions';
import { setStudentStatus, updateStudent } from '@/services/students';
import { studentFullName, type Student } from '@/types';

/** Which fact was pressed. One per badge the roster can render. */
export type RowBadgeAction =
  | 'allergy'
  | 'contact'
  | 'visitor'
  | 'birthday'
  | 'inactive'
  | 'queued';

export interface RowBadgeModalProps {
  student: Student;
  action: RowBadgeAction;
  onClose: () => void;
  /** Today, from the page, so every row agrees about what "this week" means. */
  now: Date;
}

const TITLES: Record<RowBadgeAction, string> = {
  allergy: 'Allergies',
  contact: 'Parent contact',
  visitor: 'Still a visitor?',
  birthday: 'Birthday',
  inactive: 'No longer on the roster',
  queued: 'Waiting for Planning Center',
};

export function RowBadgeModal({ student, action, onClose, now }: RowBadgeModalProps) {
  const name = studentFullName(student);

  return (
    <Modal open onClose={onClose} title={TITLES[action]} description={name} size="sm">
      {action === 'allergy' ? <AllergyPanel student={student} /> : null}
      {action === 'contact' ? <ParentContactPanel student={student} onDone={onClose} /> : null}
      {action === 'visitor' ? <VisitorPanel student={student} onDone={onClose} /> : null}
      {action === 'birthday' ? (
        <BirthdayPanel student={student} now={now} onDone={onClose} />
      ) : null}
      {action === 'inactive' ? <InactivePanel student={student} onDone={onClose} /> : null}
      {action === 'queued' ? <QueuedPanel student={student} onDone={onClose} /> : null}

      <p className="mt-4 border-t border-ink-800 pt-3 text-sm">
        <Link to={`/students/${student.id}`} className="text-brand-300 underline underline-offset-4">
          Open {student.firstName}'s profile
        </Link>
      </p>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Allergy                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The note itself, which the roster deliberately does not carry.
 *
 * `hasAllergies` is a boolean on every row precisely so that eighty-five
 * children's medical notes are not sent to a phone at a door. The badge says
 * *that* there is one; this is the screen where somebody with a reason asks
 * what it is, and it is one read for one student.
 *
 * The check-in screen asks too now — see `useAllergyNotes` — but only about the
 * handful of rows already wearing the flag, and through a call that returns the
 * allergy line and nothing else. This panel stays the wide read, because a
 * profile is where somebody is *reading* rather than counting.
 */
function AllergyPanel({ student }: { student: Student }) {
  const { details, loading, loaded, error, unavailable, retry } = usePersonDetails(student);

  if (unavailable) {
    return (
      <p className="text-sm text-ink-300">
        {student.firstName} was added here and has not reached Planning Center yet, so there is no
        medical note to read — whatever somebody typed at the door is on their profile.
      </p>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (loading || !loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-400">
        <Spinner /> Reading Planning Center…
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-warn-500/10 px-3 py-2 ring-1 ring-warn-500/25">
      <p className="text-xs font-semibold uppercase tracking-wide text-warn-400">On file</p>
      <p className="mt-0.5 whitespace-pre-line text-sm text-ink-100">
        {details?.allergies ??
          'Planning Center has the flag set but no note against it. Somebody upstream knows why.'}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Parent contact                                                              */
/* -------------------------------------------------------------------------- */

/*
 * The "no contact" chip opens `ParentContactPanel`, which is the same read and
 * the same form every other screen that names an unreachable student now shows.
 * It lives next to `AddParentContact` because the dashboard's call lists reach
 * for it too, and a roster badge is no longer the only way in.
 */

/* -------------------------------------------------------------------------- */
/* Visitor                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Taking the visitor badge off somebody who plainly is not one any more.
 *
 * Nothing else in Tally ever clears this. A student quick-added at a door in
 * September is still wearing "Visitor" in March, which makes the badge mean
 * "was new at some point" rather than "is new" — and the dashboard's new-visitor
 * list is built on the same flag.
 */
function VisitorPanel({ student, onDone }: { student: Student; onDone: () => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const promote = async () => {
    if (!user) return;
    setBusy(true);
    setProblem(null);
    try {
      await updateStudent(student.id, { isVisitor: false }, user.uid, student);
      show(`${student.firstName} is on the roster as a regular.`);
      onDone();
    } catch {
      setProblem('That could not be saved. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-300">
        {student.firstName} has been coming since{' '}
        {student.firstAttendedAt ? formatShortDate(student.firstAttendedAt) : 'before Tally counted'}
        . Clearing this takes them off the new-visitor list on the dashboard; nothing else about
        them changes.
      </p>
      {problem ? <ErrorBanner message={problem} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Leave it
        </Button>
        <Button onClick={() => void promote()} disabled={busy || !user}>
          {busy ? 'Saving…' : 'Not a visitor any more'}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Birthday                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The date, and — under `full` write-back — the box to correct it in.
 *
 * The badge that says "No birthday" is where somebody notices, usually with the
 * student in front of them having just said when it is. This used to end in a
 * link to another product: Planning Center owns the field, so the honest thing
 * was to say so and point at the record. That is still true about ownership and
 * was a dead end in the one moment the answer was available — so when the church
 * has turned write-back on, the same panel takes it.
 *
 * The box is open on arrival rather than behind an "Add a birthday" button. The
 * button was a press between a leader and the one thing this panel is for, on a
 * screen they opened *because* they had the answer — and it made a panel that
 * fits in a modal look like a page with somewhere else to go.
 *
 * `profileWritable` is the gate, read from the person details like everywhere
 * else: the browser cannot see the setting, and offering a box the write path
 * then refuses is worse than a link.
 */
function BirthdayPanel({
  student,
  now,
  onDone,
}: {
  student: Student;
  now: Date;
  onDone: () => void;
}) {
  const state = birthdayState(student.birthday, now);
  const upstream = student.pcoPersonId ? pcoPersonUrl(student.pcoPersonId) : null;
  const { details, loading, loaded } = usePersonDetails(student);
  const writable = Boolean(student.pcoPersonId) && details?.profileWritable === true;

  const said: Record<Exclude<BirthdayState, 'missing'>, string> = {
    today: 'Today.',
    soon: 'Coming up this week.',
    recent: 'Just gone — this past week.',
    quiet: 'Not near today.',
  };

  return (
    <div className="flex flex-col gap-3">
      {state === 'missing' ? (
        <p className="text-sm text-ink-300">
          Planning Center holds no birthdate for {student.firstName}, so Tally cannot tell you when
          to say something.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-bold text-ink-50">{formatBirthdayLong(student.birthday)}</p>
          <p className="text-sm text-ink-400">{said[state]}</p>
          {writable ? null : (
            <p className="text-sm text-ink-500">
              The day only. Tally is not sent the year, so it does not know how old{' '}
              {student.firstName} is.
            </p>
          )}
        </div>
      )}

      {writable ? (
        <EditBirthday student={student} onDone={onDone} />
      ) : loading && !loaded ? (
        <p className="text-sm text-ink-500">Reading what Planning Center allows…</p>
      ) : upstream ? (
        <a
          href={upstream}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-brand-300 underline underline-offset-4"
        >
          {state === 'missing' ? 'Add one in Planning Center' : 'Change it in Planning Center'}
        </a>
      ) : (
        <p className="text-sm text-ink-400">
          {student.firstName} does not exist in Planning Center yet, so there is nowhere to put one
          until their push lands.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inactive                                                                    */
/* -------------------------------------------------------------------------- */

function InactivePanel({ student, onDone }: { student: Student; onDone: () => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reactivate = async () => {
    if (!user) return;
    setBusy(true);
    setProblem(null);
    try {
      await setStudentStatus(student.id, 'active', user.uid, student);
      show(`${student.firstName} is back on the active roster.`);
      onDone();
    } catch {
      setProblem('That could not be saved. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-300">
        Inactive students are history rather than roster: they are hidden from the default view and
        from check-in, and every attendance record they are in is kept.
        {student.fromPlanningCenter
          ? ' Planning Center may say inactive too, in which case the next roster read will set it back.'
          : ''}
      </p>
      {problem ? <ErrorBanner message={problem} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Leave it
        </Button>
        <Button onClick={() => void reactivate()} disabled={busy || !user}>
          {busy ? 'Saving…' : 'Make active again'}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Queued                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A visitor whose push has not landed, and the retry for it.
 *
 * The queue only ever fills when Planning Center was unreachable or write-back
 * was off at the moment somebody was added — both things a person notices — so
 * a button is the right shape rather than a schedule.
 */
function QueuedPanel({ student, onDone }: { student: Student; onDone: () => void }) {
  const { show } = useToast();
  const { refreshRoster } = useData();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const push = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await pushStudentToPlanningCenter({ studentId: student.id });
      if (result.data.status === 'skipped') {
        // The server says why — write-back off, no configuration, already
        // linked — and its sentence is better than any guess made here.
        setProblem(result.data.message);
        return;
      }

      invalidatePersonDetails(student.id);
      invalidateParentContact();
      show(`${student.firstName} is in Planning Center.`);
      void refreshRoster(true);
      onDone();
    } catch {
      setProblem('Planning Center could not be reached. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-300">
        {student.firstName} exists in Tally only. Attendance is being recorded either way — this is
        about the person record upstream, not about the counting.
      </p>
      <p className="text-sm text-ink-400">
        <Badge tone="neutral">Queued</Badge> clears itself as soon as the push lands.
      </p>
      {problem ? <ErrorBanner message={problem} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Later
        </Button>
        <Button onClick={() => void push()} disabled={busy}>
          {busy ? 'Pushing…' : 'Push now'}
        </Button>
      </div>
    </div>
  );
}
