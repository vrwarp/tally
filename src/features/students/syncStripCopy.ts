/**
 * What the strip on a student's record says, state by state.
 *
 * Its own module because this is copy that four rounds of critique argued over
 * and it is worth being able to read it in one place, without the JSX around
 * it. Several of the sentences are load-bearing in ways that are not obvious:
 *
 *  - `queued` is the only state that offers to cancel, because it is the only
 *    one where cancelling can keep its promise. Once a worker holds the job the
 *    patch may already be on its way, and a button that cannot do what it says
 *    is worse than no button. ("Undo" is a word check-in has already spent on
 *    an instant, certain reversal; nothing here may borrow it.)
 *  - `waiting` must never read as stuck. A backend that asked Tally to slow
 *    down will be answered on its own, and a leader who reads "stuck" retries
 *    something that was fine.
 *  - `stalled` must never read as failed. It may still land.
 *  - `differs` and `merged` are both "it landed and what came back is not what
 *    was sent", and they are different errands: one is a value somebody
 *    changed, the other is the person moving.
 *  - `orphaned`'s guarantee is a promise about behaviour, not about the state
 *    of a directory Tally has not read. It says what the re-create path does —
 *    searches first, links if it finds somebody — which is a sentence that can
 *    be true. Saying "there is no other record of her" would be a claim about
 *    the whole church database, and it is most wrong in exactly the case that
 *    matters: an office admin who deleted a duplicate by hand.
 */
import { editedFields, isStalled, type UpstreamEdit, type UpstreamEditField } from '@/types';

/**
 * Everything this copy needs from the catalogue, handed in as data.
 *
 * A pure module cannot call a hook, and every sentence below is a whole one
 * with named slots — the field list, who made the edit, how long ago, and
 * which backend. `StudentSyncStrip` supplies the translator and the locale.
 */
export interface SyncStripStrings {
  t: (key: string, values?: Record<string, string>) => string;
  locale: string;
}

const FIELD_NAMES: Record<UpstreamEditField, string> = {
  firstName: 'fieldFirstName',
  nickname: 'fieldNickname',
  lastName: 'fieldLastName',
  grade: 'fieldGrade',
  allergies: 'fieldAllergies',
  birthday: 'fieldBirthday',
};

/** "Last name and grade", "Birthday", "Last name, grade and allergies". */
export function describeFields(
  { t, locale }: SyncStripStrings,
  edit: Pick<UpstreamEdit, 'patch'>,
): string {
  const names = editedFields(edit).map((field) => t(FIELD_NAMES[field]));
  if (names.length === 0) return t('fieldsNone');
  if (names.length === 1) return capitalise(names[0]!);
  // `Intl.ListFormat`, because the separator and the conjunction belong to the
  // language. `capitalise` is a no-op on a script with no case, which is the
  // right outcome rather than something to branch on.
  return capitalise(
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names),
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface SyncStripCopy {
  tone: 'run' | 'bad';
  glyph: string;
  heading: string;
  body: string;
  /**
   * Rendered in the quiet register under the body rather than in the actions
   * column, which is reserved for guards short enough not to wrap the strip.
   */
  aside?: string;
}

export interface SyncStripInput {
  edit: UpstreamEdit;
  now: Date;
  /** "Planning Center" or "Attendees" — never hard-coded, two backends exist. */
  backend: string;
  /** Whether the person reading is the person who queued it. */
  mine: boolean;
  authorFirstName: string;
  ago: string;
}

export function syncStripCopy(strings: SyncStripStrings, input: SyncStripInput): SyncStripCopy {
  const { t } = strings;
  const { edit, backend, mine, authorFirstName, ago } = input;
  const fields = describeFields(strings, edit);
  const by = mine ? t('byYou') : t('byPerson', { name: authorFirstName });
  const slots = { fields, by, ago, backend };

  switch (edit.state) {
    case 'queued':
      /*
       * Two readings of one state, and the difference is the device. Firestore
       * holds an unsent write locally, so "it goes on its own" is true of a job
       * the server has seen and a promise about nothing for one still on the
       * handset — in the exact moment a corridor makes it least likely.
       */
      return edit.pendingOnDevice
        ? {
            tone: 'run',
            glyph: '▪',
            heading: t('queuedOnDeviceHeading'),
            /*
             * "Even if you lock the screen" was here, and Tally cannot keep it.
             * The Firestore client is built with a memory cache on purpose
             * (see `lib/firebase.ts`: the persistent one can wedge a whole
             * client behind a Web Lock that is never granted, with a queue at
             * the door). An unsent write therefore lives as long as the page
             * does, and a phone that discards a backgrounded tab takes the
             * correction with it. Saying so is not a nice sentence to write,
             * and it is the difference between a leader who leaves Tally open
             * for the walk back to the office and one who is told a fortnight
             * later that the surname never changed.
             */
            body: t('queuedOnDeviceBody', slots),
          }
        : {
            tone: 'run',
            glyph: '▪',
            heading: t('queuedHeading', slots),
            body: t('queuedBody', slots),
          };

    case 'sending':
      return isStalled(edit, input.now)
        ? {
            tone: 'run',
            glyph: '→',
            heading: t('stalledHeading'),
            body: t('stalledBody', slots),
          }
        : {
            tone: 'run',
            glyph: '→',
            heading: t('sendingHeading', slots),
            body: t('sendingBody', slots),
          };

    case 'waiting':
      return {
        tone: 'run',
        glyph: '‖',
        heading: t('waitingHeading', slots),
        body: t('waitingBody', slots),
      };

    case 'landed':
      return {
        tone: 'run',
        glyph: '✓',
        heading: t('landedHeading', slots),
        body: t('landedBody', slots),
      };

    case 'differs':
      return {
        tone: 'bad',
        glyph: '≠',
        heading: t('differsHeading', slots),
        body: t('differsBody'),
      };

    case 'merged':
      return {
        tone: 'bad',
        glyph: '≠',
        heading: t('mergedHeading'),
        // No name and no date: they are in the two cells below, and a value
        // that appears in a cell does not appear in the paragraph.
        body: t('mergedBody'),
      };

    case 'orphaned':
      return {
        tone: 'bad',
        glyph: '⊘',
        heading: t('orphanedHeading', slots),
        body: t('orphanedBody', slots),
      };

    case 'failed':
    default:
      /*
       * Two failures wearing one word, and a leader has to be able to tell
       * them apart before pressing anything. `exhausted` is a backend Tally
       * could not reach and has stopped ringing — pressing again is the whole
       * answer, and often works. Every other class is the backend answering
       * and saying no, where pressing again unchanged will be told no again;
       * a heading that called both of them "refused" sent people to retry the
       * one retrying cannot fix, and made the outage look like a rejection of
       * something they had typed.
       */
      return edit.failure === 'exhausted'
        ? {
            tone: 'bad',
            glyph: '!',
            heading: t('exhaustedHeading', slots),
            body: t('exhaustedBody', slots),
          }
        : {
            tone: 'bad',
            glyph: '!',
            heading: t('refusedHeading', slots),
            /*
             * The field sentence first, the backend's own words after, in that
             * order on every state in this file. Inverted here once, and the
             * backend's message ends in a full stop — so the sentence a leader
             * read was a lowercase fragment starting mid-thought, on the one
             * screen in the queue where the words are all there is.
             */
            body: edit.message
              ? t('refusedBodyWithMessage', { ...slots, message: edit.message })
              : t('refusedBody', slots),
          };
  }
}

/**
 * How long ago, in the two or three characters a row can spare.
 *
 * Deliberately coarse. The number is there to separate a job queued fourteen
 * seconds ago from one that has been sitting for a week, not to be read as a
 * clock — and a mark that will clear itself in a minute should never be the
 * widest thing in the column.
 */
export function shortAge(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : `${Math.round(days / 7)}wk`;
}
