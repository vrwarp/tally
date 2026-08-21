/**
 * The MIA call list (Journey 5, step 2).
 *
 * The single most important list in Tally: a student who has quietly stopped
 * coming is invisible in every other view. Longest-absent first, because that
 * is the order a leader should work the phone, and every row carries the way to
 * reach the family so nobody has to go hunting for a number.
 *
 * A streak belongs to one gathering. Looking at every gathering at once, each
 * row has to say which one it means — "missed three in a row" is a different
 * sentence about a Friday regular than about somebody who only ever comes on a
 * Sunday, and the row that does not name the gathering is the row that gets a
 * family the wrong phone call.
 */
import { Link } from 'react-router-dom';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { CopyContactsButton, FollowUpActions } from '@/features/dashboard/FollowUpActions';
import { CallListLoadingRows } from '@/features/dashboard/LoadingRows';
import {
  buildMiaCsv,
  NO_EXPORT_CONTEXT,
  type FollowUpCsvContext,
} from '@/features/dashboard/followUpCsv';
import { exportFilename } from '@/lib/csv';
import { formatRelative, formatShortDate } from '@/lib/time';
import { gradeSentence, initials } from '@/lib/utils';
import { studentFullName, type MiaStudent } from '@/types';

export interface MiaListProps {
  items: readonly MiaStudent[];
  /** `settings.miaConsecutiveMisses`, quoted back so the list explains itself. */
  threshold: number;
  /**
   * True while the roster or the history is still being read — `items` is not
   * yet an answer. The card keeps its header and shows pulse rows, *inside the
   * same card*, so the answer landing swaps rows rather than recomposing the
   * column. See `CallListLoadingRows`.
   */
  loading?: boolean;
  /** The gathering being shown, or null when every gathering is in the list. */
  gatheringTitle?: string | null;
  /**
   * Called when a row has just put a parent contact into Planning Center — the
   * screen holds a session-wide answer about who can be reached, and that row
   * has just changed it.
   */
  onContactAdded?: () => void;
  /** What the CSV needs that the rows do not carry. See `followUpCsv.ts`. */
  exportContext?: FollowUpCsvContext;
}

export function MiaList({
  items,
  threshold,
  loading = false,
  gatheringTitle = null,
  onContactAdded,
  exportContext = NO_EXPORT_CONTEXT,
}: MiaListProps) {
  const students = items.map((item) => item.student);

  return (
    <Card>
      <CardHeader
        title="Missing in action"
        count={loading ? undefined : items.length}
        description={
          gatheringTitle
            ? `Came to ${gatheringTitle} regularly, then missed ${threshold} or more in a row.`
            : `Was a regular at one gathering, then missed ${threshold} or more of it in a row.`
        }
        action={
          /*
            The real controls while the names are still coming, not a
            placeholder shaped like them.

            Both disable themselves at zero rows, so a loading header renders
            the same two buttons a settled one does — same labels, same widths,
            greyed — and the answer landing turns them on without moving the
            header. A block of the right height but the wrong width slid the
            pair 86px sideways the moment the list filled, which is the whole
            failure this reserves against.
          */
          loading || items.length > 0 ? (
            // Two, and deliberately not a menu: the clipboard copy goes to the
            // group chat, the file goes to whoever is tracking who called whom.
            // Different destinations, both one press away — and parallel, so
            // they read as a designed pair rather than an accumulated one.
            <>
              <CopyContactsButton
                students={students}
                title={`Follow-up — ${items.length} students we have not seen:`}
              />
              <ExportCsvButton
                build={() => ({
                  filename: exportFilename({
                    kind: 'follow-up',
                    scope: gatheringTitle ? `${gatheringTitle} mia` : 'mia',
                    at: new Date(),
                  }),
                  contents: buildMiaCsv(items, exportContext),
                })}
                count={items.length}
                noun="students"
              />
            </>
          ) : undefined
        }
      />

      {loading ? (
        // Three lines: under "All" every row also names the gathering somebody
        // has gone missing from, which is this list's tallest and commonest row.
        <CallListLoadingRows rows={4} lines={gatheringTitle === null ? 3 : 2} />
      ) : items.length === 0 ? (
        <EmptyState
          title={`Nobody has missed ${threshold} in a row — nice.`}
          description={
            gatheringTitle
              ? `Every ${gatheringTitle} regular has been to one of the recent ones.`
              : 'Every regular has turned up at one of the recent gatherings.'
          }
        />
      ) : (
        <ul className="divide-y divide-ink-800">
          {items.map((item) => (
            // Keyed by both: the merged list holds one row per student, but a
            // single-gathering list is a slice of rows that also exist for
            // other gatherings, and a student id alone is not unique across them.
            <MiaRow
              key={`${item.gatheringKey}:${item.student.id}`}
              item={item}
              showGathering={gatheringTitle === null}
              onContactAdded={onContactAdded}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MiaRow({
  item,
  showGathering,
  onContactAdded,
}: {
  item: MiaStudent;
  showGathering: boolean;
  onContactAdded?: () => void;
}) {
  const { student, consecutiveMisses, lastAttendedAt, lastAttendedEventTitle } = item;
  const name = studentFullName(student);
  const grade = gradeSentence(student);

  /*
   * The gathering is named once per row, not twice.
   *
   * The row is four lines tall and used to print it in both of them — and the
   * first printing was the one that ran out of room, so the reader lost the
   * words the next line then repeated in full ("…1 month ago at Sund…" over
   * "Missing from Sunday School"). Line one is identity and history now; line
   * two is the reason this person is on the list.
   *
   * The exception is the row nothing else can place: somebody who has been to
   * nothing at all gets "Not seen at any gathering" below, which names no
   * gathering, so where they were last seen is worth saying here.
   */
  const placedBelow = showGathering ? item.gatheringTitle !== null : true;
  const lastSeen = lastAttendedAt
    ? `Last seen ${formatShortDate(lastAttendedAt)}, ${formatRelative(lastAttendedAt)}${
        !placedBelow && lastAttendedEventTitle ? ` at ${lastAttendedEventTitle}` : ''
      }`
    : 'Never checked in';

  return (
    /*
      Four lines on a phone, one line on a wide screen.

      The row carried the name, two meta lines and a contact line stacked down
      the left half of the column, so a leader whose whole job is working this
      list read four names before scrolling. Folded up, all ten and their
      Call/Text land on one screen. Stacked below the fold: Call and Text under
      the name is right at 358px, where they have to be thumb targets.

      The fold happens at `2xl` rather than `lg`, because that is where it
      actually fits. This column is 264px wide at 1024 and 520 at 1280 — the
      folded row wants around 530 before the student's name gets a pixel, so
      every laptop between the two was rendering a row whose name had been
      squeezed to nothing while the phone number beside it stayed whole. It is
      the name that has to survive: a call list of blank rows is not a call
      list. Past 1536 the column reaches 744 and everything fits at once.
    */
    <li className="px-3 py-2 2xl:flex 2xl:items-center 2xl:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-800 text-sm font-bold text-ink-300"
        >
          {initials(student.firstName, student.lastName)}
        </span>

        <Link
          to={`/students/${student.id}`}
          className="flex min-h-11 min-w-0 flex-1 flex-col justify-center hover:text-brand-300"
        >
          <span className="truncate text-base font-semibold text-ink-50">{name}</span>
          <span className="truncate text-xs text-ink-500">
            {/* The grade is the least load-bearing of the three facts on this
                line and it leads it, so at 390px it is what pushes the last-seen
                date — the reason the row exists — into an ellipsis. An adult
                Planning Center holds no grade for says nothing here at all
                rather than "No grade", for the same reason. */}
            {grade ? <span className="hidden lg:inline">{grade} · </span> : null}
            {lastSeen}
          </span>
          {showGathering ? (
            <span className="truncate text-xs text-ink-500">
              {item.gatheringTitle
                ? `Missing from ${item.gatheringTitle}`
                : // No gathering can claim them: the window holds no sighting of
                  // them at any of them, which is the strongest version of this
                  // list's case rather than a weaker one.
                  'Not seen at any gathering'}
              {item.alsoMissingCount > 0
                ? ` · and ${item.alsoMissingCount} other ${
                    item.alsoMissingCount === 1 ? 'gathering' : 'gatherings'
                  }`
                : ''}
            </span>
          ) : null}
        </Link>

        <span className="shrink-0 rounded-xl bg-danger-500/10 px-2.5 py-1 text-center ring-1 ring-danger-500/25">
          <span className="sr-only">
            {item.gatheringTitle
              ? `Missed ${consecutiveMisses} ${item.gatheringTitle} gatherings in a row.`
              : `Not seen at any of the last ${consecutiveMisses} gatherings.`}
          </span>
          <span
            aria-hidden="true"
            className="block text-lg font-bold leading-tight tabular-nums text-danger-400"
          >
            {consecutiveMisses}
          </span>
          <span aria-hidden="true" className="block text-[10px] uppercase tracking-wide text-ink-400">
            {/* Nobody expected them anywhere, so "missed" is the wrong word for
                the number: it counts the nights that have gone by without them. */}
            {item.gatheringTitle ? 'missed' : 'unseen'}
          </span>
        </span>
      </div>

      <FollowUpActions
        student={student}
        onContactAdded={onContactAdded}
        className="mt-1 pb-1 pl-14 2xl:mt-0 2xl:shrink-0 2xl:pb-0 2xl:pl-0"
      />
    </li>
  );
}
