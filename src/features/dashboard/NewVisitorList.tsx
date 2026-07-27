/**
 * First-timers inside the new-visitor window (Journey 5).
 *
 * A visitor's second visit is decided in the week after their first, so this
 * list is deliberately short-lived: it shows who arrived, which gathering they
 * arrived at, and the fastest way to say "great to meet you". Most of these
 * students were quick-added at the door and still have no parent contact, so
 * the row's action is either "reach them" or "finish their profile" — never
 * both, and never nothing.
 *
 * "Never nothing" is the part that took two goes. A row used to reach that
 * promise only for students Tally created: they carry `profileComplete: false`,
 * and the row keyed off that alone. Everybody who came from the roster carries
 * `null` instead — a roster read does not hydrate households — so the same row,
 * for a student the screen already knew nobody could reach, fell through to a
 * sentence saying so and offered nothing to press. Both halves of the answer
 * are threaded in now, and both kinds of unreachable student get somewhere to
 * go.
 */
import { Link } from 'react-router-dom';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { FollowUpActions } from '@/features/dashboard/FollowUpActions';
import { hasNoParentContact } from '@/features/dashboard/insights';
import { pcoPersonUrl } from '@/lib/planningCenter';
import { formatRelative, formatShortDate } from '@/lib/time';
import { initials, ordinalGrade } from '@/lib/utils';
import { studentFullName, type NewVisitor, type Student } from '@/types';

export interface NewVisitorListProps {
  items: readonly NewVisitor[];
  /** `settings.newVisitorWindowDays`. */
  windowDays: number;
  /** The gathering being shown, or null when every gathering is in the list. */
  gatheringTitle?: string | null;
  /**
   * Student id -> whether Planning Center holds a way to reach a parent, from
   * `useParentContact`.
   *
   * The second half of the answer, and the reason this is a prop rather than
   * something each row works out. `profileComplete` is `null` on every student
   * who came off the roster — a roster read does not hydrate households — so a
   * list that consulted only the flag could never mark one of them incomplete,
   * however certain the screen already was. An absent entry stays `null`:
   * "nobody asked" must not render as "nobody can reach them".
   */
  reachable?: ReadonlyMap<string, boolean>;
}

export function NewVisitorList({
  items,
  windowDays,
  gatheringTitle = null,
  reachable,
}: NewVisitorListProps) {
  return (
    <Card>
      <CardHeader
        title="New faces"
        count={items.length}
        description={
          gatheringTitle
            ? `First seen at ${gatheringTitle} in the last ${windowDays} days.`
            : `First time in the last ${windowDays} days.`
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title={
            gatheringTitle ? `No first-timers at ${gatheringTitle}.` : 'No first-timers this week.'
          }
          description="Anyone checked in for the first time shows up here while the visit is still fresh."
        />
      ) : (
        <ul className="divide-y divide-ink-800">
          {items.map((visitor) => (
            <NewVisitorRow
              key={visitor.student.id}
              visitor={visitor}
              reachable={reachable?.get(visitor.student.id)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function NewVisitorRow({
  visitor,
  reachable,
}: {
  visitor: NewVisitor;
  /** Planning Center's answer for this student, or undefined if unasked. */
  reachable: boolean | undefined;
}) {
  const { student, firstEventTitle, firstAttendedAt } = visitor;

  /*
   * The same resolution `computeIncompleteProfiles` uses, and it has to stay the
   * same one: this list and the "incomplete profiles" list below it sit on one
   * screen, and a student can only be missing a parent contact on both or on
   * neither. Tally's own flag wins where it has one — a visitor who exists
   * nowhere else cannot be looked up — and `null` on either side means unasked.
   */
  const unreachable = hasNoParentContact(student.profileComplete, reachable);

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-sm font-bold text-brand-300"
        >
          {initials(student.firstName, student.lastName)}
        </span>

        <Link
          to={`/students/${student.id}`}
          className="flex min-h-11 min-w-0 flex-1 flex-col justify-center hover:text-brand-300"
        >
          <span className="flex items-baseline gap-2">
            <span className="truncate text-base font-semibold text-ink-50">
              {studentFullName(student)}
            </span>
            <span className="shrink-0 text-xs text-ink-500">
              {ordinalGrade(student.grade)}
            </span>
          </span>
          <span className="truncate text-xs text-ink-500">
            {firstEventTitle} · {formatShortDate(firstAttendedAt)}, {formatRelative(firstAttendedAt)}
          </span>
        </Link>

        {/* Somebody met on a retreat is a different follow-up from somebody who
            walked into a Friday: there is no next instance of a bus trip for
            them to come back to, so the invitation has to name a gathering. */}
        {visitor.viaOneOff ? (
          <Badge tone="neutral" title="Met at a one-off event, not at a regular gathering">
            One-off
          </Badge>
        ) : null}

        {unreachable ? (
          <Badge tone="warn" title="No parent contact on file">
            <span aria-hidden="true">⚠</span>
            Incomplete
          </Badge>
        ) : null}
      </div>

      {/* A student nobody has established anything about yet still goes through
          `FollowUpActions`, which looks the contact up itself and names whichever
          state it lands in. `unreachable` is only ever true on an answer. */}
      {unreachable ? (
        <AddContactLink student={student} />
      ) : (
        <FollowUpActions student={student} className="mt-1 pb-1 pl-14" />
      )}
    </li>
  );
}

/**
 * Where somebody goes to make this student reachable.
 *
 * Two destinations, because a student the roster knows can be sent straight to
 * the record that needs fixing, and one Tally created cannot: they have no
 * Planning Center page to open yet. Theirs leads to their student page, which
 * knows whether they have reached Planning Center and says what to do about it
 * — the same page the write form lives on where write-back allows one.
 *
 * The Planning Center case is the whole point of this component. It used to
 * render as a sentence explaining that nobody could follow up, on a list where
 * the row directly above it had a button; the two rows meant the same thing and
 * only one of them was actionable.
 */
function AddContactLink({ student }: { student: Student }) {
  const name = studentFullName(student);
  const className =
    'mt-1 ml-14 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-warn-500/10 px-3 text-sm font-semibold text-warn-400 ring-1 ring-warn-500/25 hover:bg-warn-500/15';

  if (student.pcoPersonId) {
    return (
      <a
        href={pcoPersonUrl(student.pcoPersonId)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Add a parent contact for ${name} in Planning Center`}
        className={className}
      >
        <span aria-hidden="true">＋</span>
        Add in Planning Center
      </a>
    );
  }

  return (
    <Link to={`/students/${student.id}`} aria-label={`Add parent contact for ${name}`} className={className}>
      <span aria-hidden="true">＋</span>
      Add parent contact
    </Link>
  );
}
