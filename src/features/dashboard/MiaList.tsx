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
import { Button, Card, CardHeader, EmptyState } from '@/components/ui';
import { CopyContactsButton, FollowUpActions } from '@/features/dashboard/FollowUpActions';
import { CallListLoadingRows } from '@/features/dashboard/LoadingRows';
import {
  buildMiaCsv,
  NO_EXPORT_CONTEXT,
  type FollowUpCsvContext,
} from '@/features/dashboard/followUpCsv';
import { exportFilename } from '@/lib/csv';
import { formatRelative, formatShortDate } from '@/lib/time';
import { gradeSentence, initials, sortByName } from '@/lib/utils';
import { sessionReleaseKey, type SessionRelease } from '@/features/dashboard/sessionRelease';
import { TRANSITION_REASON_LABEL, studentFullName, type MiaStudent } from '@/types';

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
  /**
   * Offered on rows a release can resolve — every row that names a gathering,
   * and an unseen row that a moved-on release produced (its resolution is the
   * same act with the other reason). Absent, the list is read-only, exactly as
   * it was before the transition record existed.
   */
  onResolve?: (item: MiaStudent) => void;
  /** Rows released this session, rendered greyed in place. */
  sessionReleases?: ReadonlyMap<string, SessionRelease>;
  onUndoSessionRelease?: (release: SessionRelease) => void;
  /** The session-release key an undo is in flight for. */
  undoBusyKey?: string | null;
}

export function MiaList({
  items,
  threshold,
  loading = false,
  gatheringTitle = null,
  onContactAdded,
  exportContext = NO_EXPORT_CONTEXT,
  onResolve,
  sessionReleases,
  onUndoSessionRelease,
  undoBusyKey = null,
}: MiaListProps) {
  const students = items.map((item) => item.student);

  /*
   * The list plus this session's released rows, in one order. A released row
   * holds the place its streak earned — greying in place is the whole point —
   * so the merge re-applies the list's own comparator rather than appending.
   * A row the derivation still produces (the release failed to land, or undo
   * won) renders as a live row, not twice.
   */
  const live = new Set(items.map((item) => sessionReleaseKey(item.gatheringKey, item.student.id)));
  const releasedRows = [...(sessionReleases?.entries() ?? [])].filter(([key]) => !live.has(key));
  const entries: Array<
    { kind: 'live'; item: MiaStudent } | { kind: 'released'; key: string; release: SessionRelease }
  > = [
    ...items.map((item) => ({ kind: 'live' as const, item })),
    ...releasedRows.map(([key, release]) => ({ kind: 'released' as const, key, release })),
  ].sort((a, b) => {
    const rowA = a.kind === 'live' ? a.item : a.release.item;
    const rowB = b.kind === 'live' ? b.item : b.release.item;
    return (
      rowB.consecutiveMisses - rowA.consecutiveMisses || sortByName(rowA.student, rowB.student)
    );
  });

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
                // The toast beside this one has always got it right ("Copied 1
                // name"); this string is the one that leaves the app, and "1
                // students" landed in the team group chat.
                title={`Follow-up — ${items.length} ${
                  items.length === 1 ? 'student' : 'students'
                } we have not seen:`}
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
      ) : entries.length === 0 ? (
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
          {entries.map((entry) =>
            entry.kind === 'live' ? (
              // Keyed by both: the merged list holds one row per student, but a
              // single-gathering list is a slice of rows that also exist for
              // other gatherings, and a student id alone is not unique across them.
              <MiaRow
                key={sessionReleaseKey(entry.item.gatheringKey, entry.item.student.id)}
                item={entry.item}
                showGathering={gatheringTitle === null}
                onContactAdded={onContactAdded}
                onResolve={onResolve}
              />
            ) : (
              <ReleasedRow
                key={entry.key}
                release={entry.release}
                showGathering={gatheringTitle === null}
                onUndo={onUndoSessionRelease}
                busy={undoBusyKey === entry.key}
              />
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

/**
 * A row released seconds ago: greyed in place, one tap from coming back.
 *
 * Everything interactive about the live row is gone — the release is the
 * resolution, and Call/Text on a resolved row would invite exactly the phone
 * call the press was ending. What stays is the identity, what was decided, and
 * Undo. On reload this row is the ledger strip's, not the list's.
 */
function ReleasedRow({
  release,
  showGathering,
  onUndo,
  busy,
}: {
  release: SessionRelease;
  showGathering: boolean;
  onUndo?: (release: SessionRelease) => void;
  busy: boolean;
}) {
  const { item, reason } = release;
  const name = studentFullName(item.student);

  return (
    /*
      The live row's own structure, not a second one that resembles it.

      This row used to be a flat strip — avatar, a `flex-1` block of text, then
      the mark and Undo pushed to the right edge — which looked close enough on
      a wide screen and was a different object everywhere else. Three separate
      failures came out of that one choice, and rebuilding it on `MiaRow`'s
      columns answers all three:

      * Its height. A live row is two lines below `xl`: identity, then the
        action strip. This row had no strip, so releasing a student cut the row
        from 114px to 61px and dragged every row under it up 53px — including
        the next "Resolve…", under a cursor already moving toward it. The one
        gesture this card exists to slow down was the one that moved the next
        target. Giving Undo the strip the live row has, and letting the reason
        wrap the way the live row's third line does, makes the two the same
        height by construction rather than by a matched pair of `min-h`
        guesses. `xl:min-h-18` is on both, so above the fold they are equal to
        the pixel.

      * Its columns. The mark was supposed to stand in the column the streak
        badge left. Flushed right by a `flex-1` sibling it landed 240px away
        from that column, straddling the two action columns — so the released
        row was the one row in the list whose objects sat in none of the list's
        columns, and the badge column had a hole in it anyway. Inside the
        identity group, at the same depth the badge sits at, it lands in it.

      * Its sentence. On a phone the mark sat inline on the name's own line and
        squeezed the row's only sentence — what was decided about this child —
        down to "No longer expe…". A label should not be what truncates the
        thing it labels.

      `opacity-60` stays on the avatar and the name and stays off the divider:
      a fade on the `<li>` faded the row's own bottom border, so one divider in
      the list was a different colour from the other nine.
    */
    <li className="px-3 py-2 xl:flex xl:min-h-18 xl:items-center xl:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-800 text-sm font-bold text-ink-300 opacity-60"
        >
          {initials(item.student.firstName, item.student.lastName)}
        </span>
        <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
          {/*
            Stepped down the ramp rather than washed out.

            At `ink-50` under a 60% fade the name measured L=158.7 against an
            Undo label at L=161.3 — the row's loudest text was its control
            rather than the child it is about, and the two were close enough to
            leave the row with no first thing to read. A live row's name
            outranks its Resolve by a mile; this one has to as well. `ink-300`
            unfaded clears the button outright and still sits well below the
            `ink-50` a live row uses, so the row reads settled without reading
            failed.
          */}
          <span className="truncate text-base font-semibold text-ink-300">{name}</span>
          {/*
            The list's own meta ink, at full strength, and no ellipsis.

            Everything else about this row says "settled" by subtraction, and
            subtraction is also what "failed to load" looks like — so the one
            sentence that says what was actually decided is the wrong place to
            economise. Faded it had been the least readable thing on the screen
            (`ink-500` × 60% lands at 2.15:1); raised to `ink-300` and faded it
            became the second *brightest*, within 1.3× of the student's own
            name, so the row had no first thing to read. `ink-500` unfaded is
            exactly the ink every other row's meta line uses: legible as the
            rest of the list, and a clear step below the name above it.
          */}
          <span className="text-xs text-ink-500">
            No longer expected
            {showGathering && item.gatheringTitle ? ` at ${item.gatheringTitle}` : ' here'} —{' '}
            {TRANSITION_REASON_LABEL[reason]}
          </span>
        </div>
        {/*
          The mark, in the column the streak badge left — and deliberately not
          dressed as a control.

          As a filled, ringed, `rounded-xl` pill in `ink-400` it wore the exact
          costume of the Undo 12px from it, so the row read as two buttons one
          of which does nothing, and its label was measurably the brightest
          text on the row — brighter than the student's name. A status is a
          label: small caps, no fill, no ring, and quieter than the name it
          describes.
        */}
        <span
          aria-hidden="true"
          className="shrink-0 text-center text-[10px] uppercase tracking-wide text-ink-500"
        >
          resolved
        </span>
      </div>

      {/* The live row's action strip, holding the one control this row has.
          Same placement rules, so Undo lands where Resolve stood. */}
      <div className="mt-1 flex items-center justify-end gap-x-2 sm:pl-14 xl:mt-0 xl:shrink-0 xl:justify-start xl:pl-0">
        {/* The contact control's slot, held empty. Nothing goes in it — the
            release is the resolution, and a Call on a resolved row would invite
            exactly the phone call the press was ending — but the width has to
            be spent all the same, or this row's streak column is somewhere the
            other rows' is not. */}
        <span aria-hidden="true" className="hidden xl:block xl:w-40" />
        {onUndo ? (
          <Button
            variant="ghost"
            size="md"
            // The same material as "Resolve…" — see the note there. A reversal
            // that reads brighter and less button-shaped than the act it
            // reverses is the hierarchy upside down.
            className="shrink-0 text-ink-400 ring-1 ring-ink-700 hover:text-ink-100 min-w-28"
            onClick={() => onUndo(release)}
            loading={busy}
          >
            Undo
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function MiaRow({
  item,
  showGathering,
  onContactAdded,
  onResolve,
}: {
  item: MiaStudent;
  showGathering: boolean;
  onContactAdded?: () => void;
  onResolve?: (item: MiaStudent) => void;
}) {
  const { student, consecutiveMisses, lastAttendedAt, lastAttendedEventTitle } = item;
  const name = studentFullName(student);
  const grade = gradeSentence(student);
  // Every row that names a gathering can be released from it; an unseen row
  // can only be re-answered when a release produced it (same act, other
  // reason). A plain unseen row's remedy stays what it always was — a phone
  // call, or deactivation from the student's page.
  const resolvable = onResolve && (item.gatheringKey !== null || item.release !== undefined);

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

      The fold happens at `xl` rather than `lg`, because that is where it
      actually fits. This column is 264px wide at 1024 — narrower than a phone —
      and the folded row spends 546px on the avatar, the streak, the gutters and
      the contact block before the student's name gets a pixel. It is the name
      that has to survive: a call list of blank rows is not a call list.

      1280 is the commonest laptop width and the one this had to reach, and it
      is exactly the width where 546 does not fit twice: the body is 992px, the
      short lists beside it cannot go below the 358 they get on a phone, and
      546 + a name + 358 does not fit in 992. What made it fit was capping the
      *contact block* rather than the name — see the class on `FollowUpActions`
      below. Between `xl` and `2xl` Call and Text take one line and the phone
      number wraps under them, the row is 84px instead of 125 — before the
      answer as well as after it, because the block reserves that second line
      the way it already reserved the first — and the name keeps 128px at 1280
      and 214 at 1366. Past 1536 the frame stops widening at 80rem, the column
      settles at 808, the cap comes off and the whole row is one 72px line.
    */
    <li className="px-3 py-2 xl:flex xl:min-h-18 xl:items-center xl:gap-4">
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
          {/*
            Wraps, like the line under it.

            The block had two adjacent lines with two different overflow rules:
            this one clipped mid-word while the one directly beneath it wrapped
            and orphaned a word — an ellipsis stacked on a wrapped line, which
            reads as two columns rather than one paragraph, and proves in the
            same breath that another line was available. The last-seen date is
            the reason the row is on this list, so it is the wrong line to be
            the one that clips. With the action column narrowed it now fits at
            1440 anyway; this is what happens on the names that still do not.
          */}
          <span className="text-xs text-ink-500">
            {/* The grade is the least load-bearing of the three facts on this
                line and it leads it, so at 390px it is what pushes the last-seen
                date — the reason the row exists — into an ellipsis. An adult
                Planning Center holds no grade for says nothing here at all
                rather than "No grade", for the same reason. */}
            {grade ? <span className="hidden lg:inline">{grade} · </span> : null}
            {lastSeen}
          </span>
          {/*
            The third line: which gathering this row is about, and the one fact
            that outranks it.

            The gathering clause is for the merged view only — under a single
            gathering's tab the card header has already said which one, and
            repeating it here spends the line that the warning below needs.
          */}
          {showGathering || item.notSeenAnywhereSince ? (
            /*
              Wraps where every other line truncates.

              On the merged tab this line carries both the gathering and the
              clause that decides whether the row is bookkeeping or a child
              nobody has seen — and truncation ate exactly the second half:
              "Missing from Sunday Kids · and …" spent 27px of amber saying the
              word "and", and a released student's "— not seen since" was cut
              off, leaving a sentence that reads as completed filing. Two lines
              cost 16px on the rows that carry it; the collapse above just
              bought 85.
            */
            <span className="text-xs text-ink-500">
              {showGathering
                ? item.gatheringTitle
                  ? `Missing from ${item.gatheringTitle}`
                  : item.release
                    ? // The provenance a released row carries: who decided this
                      // student had moved on, has been contradicted by nobody —
                      // and no gathering has seen them since.
                      //
                      // Bound, because un-truncating this line governed the
                      // overflow and left nothing governing the break: it fell
                      // inside the date ("Sunday Kids Sep / 8", a bare numeral
                      // starting a line 20px from a red streak count) and it
                      // orphaned "since" onto a fourth line, making this the one
                      // row in the list 18px taller than the rest. The date and
                      // the clause qualifying it are one fact, so they move to
                      // the next line together or not at all.
                      [
                        `Moved on${item.release.fromTitle ? ` from ${item.release.fromTitle}` : ''} `,
                        <span key="since" className="whitespace-nowrap">
                          {formatShortDate(item.release.at)} — not seen since
                        </span>,
                      ]
                    : // No gathering can claim them: the window holds no sighting
                      // of them at any of them, which is the strongest version of
                      // this list's case rather than a weaker one.
                      'Not seen at any gathering'
                : null}
              {showGathering && item.alsoMissingCount > 0
                ? ` · and ${item.alsoMissingCount} other ${
                    item.alsoMissingCount === 1 ? 'gathering' : 'gatherings'
                  }`
                : ''}
              {/*
                The pre-marked exception, and it takes this line rather than the
                meta line above.

                Most rows here mean "drifted from this gathering, probably at
                another one"; this one means "and nowhere has seen them since",
                which is the single fact deciding whether a release is
                bookkeeping or the closing of the last question anybody was
                asking about a child. Appended to the meta line it was the last
                clause of the row's most crowded sentence — grade, then the
                last-seen date, then this — and at the `xl` fold, where the
                contact block takes 18rem of the row, it truncated away entirely
                on the screen a leader actually works this list on.
              */}
              {item.notSeenAnywhereSince ? (
                /*
                  The accent breaks as a unit or not at all.

                  Wrapping reproduced by another route the exact failure the
                  truncation caused: line one ended on an amber "· and" and the
                  words carrying the meaning fell to line two, so the flag read
                  as two stray marks rather than one. `whitespace-nowrap` moves
                  the whole clause down together — it is 130px, which fits the
                  narrowest column this line ever has.
                */
                <span className="whitespace-nowrap text-warn-400">
                  {showGathering ? (
                    ' · and nowhere since'
                  ) : (
                    <>Not seen anywhere since {formatShortDate(item.notSeenAnywhereSince)}</>
                  )}
                </span>
              ) : null}
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

      {/*
        The row's actions, and the width they are allowed to cost.

        Folded at `xl` this is no longer a strip under the row — it is the
        row's second column, so every dimension it reserves is taken from the
        student's name beside it. The reservation used to be 18rem wide and
        68px tall, measured against two pills and a wrapped phone number. One
        button replaced all three, and the leftover was 118px of empty,
        unpaintable width in every row: at 1440 the name column was 180px, so
        "Last seen Aug 30, 43 days ago" lost its relative age and the amber
        mark was cut mid-date — on the very rows that mark exists to flag.

        So the block is sized against what it actually holds now. That is the
        button, at 152px — and 10rem covers it with room for the two
        `pointer-fine` steps. It used to be 13rem, sized against the sentence
        the block waits behind rather than the control it settles on, which
        left 56px of unpaintable width inside the row's action pair: the run of
        gaps across the row read 12, 12, 14, 64, so the two controls did not
        read as a pair at all, and the 56px was taken from the name column
        beside them. The waiting sentence was shortened to fit the button
        instead; a transient state is the right thing to clip.

        Still a floor as well as a ceiling, for the original reason: sized only
        as a cap, every row widened by ~30px as its own lookup landed, dragging
        the streak badge and the end of the name leftward one row at a time.

        `pl-14` is the other half. It indents the strip to align under the
        name, which is right — but only where there is room, and at 360px it
        is 56 of the 278px the two controls need. Below `sm` the strip starts
        at the row's edge instead, which is what keeps "Resolve…" on the same
        line as "Contact parent" on an iPhone SE, a 13 mini and most Android
        handsets rather than wrapping and giving back 40px of the 85 this
        change just bought.
      */}
      {/* `justify-between` below the fold, `start` above it. Left-packed, the
          strip stopped 67px short of the row's own right edge — under a streak
          badge that reaches it — so every row had an empty corner, and the
          row's whole slack sat outside the pair rather than between two
          adjacent targets, one of which files a child as no longer expected.
          Spread, the row reads as two aligned columns. Above the fold the
          strip is the row's second column and packs normally. */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 sm:pl-14 xl:mt-0 xl:flex-nowrap xl:shrink-0 xl:justify-start xl:pl-0">
        {/* Sized by its own contents, never stretched: given `flex-1` here it
            narrowed to about 200px on a phone and its two pills wrapped one
            under the other, doubling the height of every row on the list. */}
        <FollowUpActions
          student={student}
          onContactAdded={onContactAdded}
          // Nothing here may make the block taller than the button it holds.
          // `pb-1` once nudged it up 2px against the Resolve beside it, and a
          // `min-h-14` reserved for a caption under the button nudged it up 10
          // — two adjacent controls on every row of the list, neither of them
          // on the row's optical line, which the avatar, the streak badge and
          // Resolve all sit on. The block's own `min-h-12` is the pill's
          // height and no more.
          className="xl:w-40"
        />
        {/*
          A button, and deliberately a quieter one than its neighbour.

          As a bare ghost it read as a link floating at the end of the row —
          on a laptop, where the strip folds into a column, it was text with
          no edges beside a filled pill, which is not a state this design
          system has. So it takes the same shell as Contact parent and sheds
          the fill: a ring and muted text against the page rather than a
          raised face. The two are then legible as what they are — the thing
          a leader does about this student on the phone, and the thing they
          do about the row — without the second competing for the first's
          weight on a list that exists to produce calls.
        */}
        {resolvable ? (
          <Button
            variant="ghost"
            // `md` for the reason its neighbour takes it: 44px under a thumb,
            // 36 under a mouse. Two 36px targets 6px apart, one of which files
            // a child as no longer expected, is not a phone control.
            size="md"
            // `ring-ink-800` measured 1.22:1 against the card — the label and
            // the ellipsis were carrying the whole affordance, and the ring was
            // buying neither an edge nor a boundary between two adjacent
            // targets. `ink-700` is the ring the secondary button already uses.
            // `min-w-28` is not cosmetic. Above the fold the identity group is
            // `flex-1`, so where the streak badge lands is decided by how wide
            // this strip is — and a released row, whose strip holds one shorter
            // word, stretched its own group 240px further and put its mark in
            // no column at all. Resolve and Undo are one width, and the
            // released strip reserves the contact slot, so the two rows' badge
            // columns land on the same pixel.
            //
            // At every size, not just above the fold: below it the two sat at
            // 109.5 and 74.5, so the column that holds "the thing you do about
            // this row" jogged 35px at the released row — and the narrower of
            // the two was the one that reverses a decision about a child.
            className="shrink-0 text-ink-400 ring-1 ring-ink-700 hover:text-ink-100 min-w-28"
            onClick={() => onResolve(item)}
            aria-label={`No longer expected — ${name}`}
          >
            Resolve…
          </Button>
        ) : null}
      </div>
    </li>
  );
}
