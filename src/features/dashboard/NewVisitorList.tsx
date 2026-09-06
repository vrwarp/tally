/**
 * First-timers inside the new-visitor window (Journey 5).
 *
 * A visitor's second visit is decided in the week after their first, so this
 * list is deliberately short-lived: it shows who arrived, which gathering they
 * arrived at, and the fastest way to say "great to meet you". Most of these
 * students were quick-added at the door and still have no contact, so
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
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { AddParentContactButton } from '@/features/dashboard/AddParentContactButton';
import { FollowUpActions } from '@/features/dashboard/FollowUpActions';
import {
  buildNewVisitorCsv,
  NO_EXPORT_CONTEXT,
  type FollowUpCsvContext,
} from '@/features/dashboard/followUpCsv';
import { hasNoAdultContact, reachableFor } from '@/features/dashboard/insights';
import { CallListLoadingRows } from '@/features/dashboard/LoadingRows';
import { exportFilename } from '@/lib/csv';
import { formatRelative, formatShortDate } from '@/lib/time';
import { gradeLabel, initials, NO_GRADE } from '@/lib/utils';
import { studentFullName, type NewVisitor } from '@/types';

export interface NewVisitorListProps {
  items: readonly NewVisitor[];
  /** `settings.newVisitorWindowDays`. */
  windowDays: number;
  /**
   * True while the roster or the history is still being read — `items` is not
   * yet an answer. The card keeps its header over pulse rows, in place, so the
   * answer landing swaps rows rather than recomposing the column.
   */
  loading?: boolean;
  /** The gathering being shown, or null when every gathering is in the list. */
  gatheringTitle?: string | null;
  /**
   * Student id -> whether Planning Center holds a way to reach an adult, from
   * `useAdultContact`.
   *
   * The second half of the answer, and the reason this is a prop rather than
   * something each row works out. `profileComplete` is `null` on every student
   * who came off the roster — a roster read does not hydrate households — so a
   * list that consulted only the flag could never mark one of them incomplete,
   * however certain the screen already was. An absent entry stays `null`:
   * "nobody asked" must not render as "nobody can reach them".
   *
   * Read through `reachableFor`, because a first-timer is exactly the student
   * this map files under an id their row does not have yet: quick-added under
   * Tally's id, answered for under Planning Center's.
   */
  reachable?: ReadonlyMap<string, boolean>;
  /**
   * Called when a row has just put a contact into Planning Center, so
   * the map above — which said the opposite a second ago — is asked again.
   */
  onContactAdded?: () => void;
  /** What the CSV needs that the rows do not carry. See `followUpCsv.ts`. */
  exportContext?: FollowUpCsvContext;
}

export function NewVisitorList({
  items,
  windowDays,
  loading = false,
  gatheringTitle = null,
  reachable,
  onContactAdded,
  exportContext = NO_EXPORT_CONTEXT,
}: NewVisitorListProps) {
  return (
    <Card>
      <CardHeader
        title="New faces"
        count={loading ? undefined : items.length}
        description={
          gatheringTitle
            ? `First seen at ${gatheringTitle} in the last ${windowDays} days.`
            : `First time in the last ${windowDays} days.`
        }
        action={
          // The real control, disabled at zero, so a loading header is the
          // settled header greyed rather than a placeholder of a guessed width.
          // See the note in `MiaList`.
          loading || items.length > 0 ? (
            <ExportCsvButton
              build={() => ({
                filename: exportFilename({
                  kind: 'follow-up',
                  scope: gatheringTitle ? `${gatheringTitle} new` : 'new-faces',
                  at: new Date(),
                }),
                contents: buildNewVisitorCsv(items, exportContext),
              })}
              count={items.length}
              noun="students"
            />
          ) : undefined
        }
      />

      {loading ? (
        <CallListLoadingRows rows={2} />
      ) : items.length === 0 ? (
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
              reachable={reachable ? reachableFor(visitor.student, reachable) : undefined}
              onContactAdded={onContactAdded}
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
  onContactAdded,
}: {
  visitor: NewVisitor;
  /** Planning Center's answer for this student, or undefined if unasked. */
  reachable: boolean | undefined;
  onContactAdded?: () => void;
}) {
  const { student, firstEventTitle, firstAttendedAt } = visitor;

  /*
   * The same resolution `computeIncompleteProfiles` uses, and it has to stay the
   * same one: this list and the "incomplete profiles" list below it sit on one
   * screen, and a student can only be missing a contact on both or on
   * neither. Tally's own flag wins where it has one — a visitor who exists
   * nowhere else cannot be looked up — and `null` on either side means unasked.
   */
  const unreachable = hasNoAdultContact(student.profileComplete, reachable);

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
              {gradeLabel(student) ?? NO_GRADE}
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
          <Badge tone="warn" title="No contact on file">
            <span aria-hidden="true">⚠</span>
            Incomplete
          </Badge>
        ) : null}
      </div>

      {/* A student nobody has established anything about yet still goes through
          `FollowUpActions`, which looks the contact up itself and names whichever
          state it lands in. `unreachable` is only ever true on an answer. */}
      {unreachable ? (
        <AddParentContactButton
          student={student}
          onAdded={onContactAdded}
          className="mt-1 mb-1 ml-14"
        />
      ) : (
        <FollowUpActions
          student={student}
          onContactAdded={onContactAdded}
          className="mt-1 pb-1 pl-14"
        />
      )}
    </li>
  );
}
