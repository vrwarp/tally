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

const FIELD_NAMES: Record<UpstreamEditField, string> = {
  firstName: 'first name',
  nickname: 'nickname',
  lastName: 'last name',
  grade: 'grade',
  allergies: 'allergies',
  birthday: 'birthday',
};

/** "Last name and grade", "Birthday", "Last name, grade and allergies". */
export function describeFields(edit: Pick<UpstreamEdit, 'patch'>): string {
  const names = editedFields(edit).map((field) => FIELD_NAMES[field]);
  if (names.length === 0) return 'This profile';
  if (names.length === 1) return capitalise(names[0]!);
  const last = names[names.length - 1]!;
  return capitalise(`${names.slice(0, -1).join(', ')} and ${last}`);
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

export function syncStripCopy(input: SyncStripInput): SyncStripCopy {
  const { edit, backend, mine, authorFirstName, ago } = input;
  const fields = describeFields(edit);
  const by = mine ? 'by you' : `by ${authorFirstName}`;

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
            heading: 'Held on this phone — no signal',
            body: `${fields}, ${by} ${ago}. It has not left the device yet. It goes as soon as you have signal, even if you lock the screen.`,
          }
        : {
            tone: 'run',
            glyph: '▪',
            heading: `Queued for ${backend}`,
            body: `${fields}, ${by} ${ago}. Nothing has reached ${backend} yet, so you can still stop it — and it goes on its own, even if you close this.`,
          };

    case 'sending':
      return isStalled(edit, input.now)
        ? {
            tone: 'run',
            glyph: '→',
            heading: 'Taking longer than it should',
            body: `${fields}, ${by} ${ago}. It may still land — nothing has failed, and nothing you typed is lost.`,
          }
        : {
            tone: 'run',
            glyph: '→',
            heading: `Sending to ${backend}`,
            body: `${fields}, ${by} ${ago}. A server is talking to ${backend} about it now.`,
          };

    case 'waiting':
      return {
        tone: 'run',
        glyph: '‖',
        heading: `Waiting on ${backend}`,
        body: `${fields}, ${by} ${ago}. ${backend} asked Tally to slow down, so it is paused and resumes on its own. Nothing is stuck.`,
      };

    case 'landed':
      return {
        tone: 'run',
        glyph: '✓',
        heading: `Saved in ${backend}`,
        body: `${fields}, ${by} ${ago}.`,
      };

    case 'differs':
      return {
        tone: 'bad',
        glyph: '≠',
        heading: `${backend} holds a different value`,
        body: `Your edit went out and did not overwrite anything — somebody had already changed the same field. Nothing of yours was written, and nothing of theirs was lost. Which one is right is yours to say.`,
      };

    case 'merged':
      return {
        tone: 'bad',
        glyph: '≠',
        heading: 'This record was merged into another person',
        // No name and no date: they are in the two cells below, and a value
        // that appears in a cell does not appear in the paragraph.
        body: `Your correction followed the merge and landed on the survivor, not here. This page now reads from them, and the ids below are what moved.`,
      };

    case 'orphaned':
      return {
        tone: 'bad',
        glyph: '⊘',
        heading: `No longer in ${backend}`,
        body:
          `${fields}, ${by} ${ago}. It has nowhere to land: the person it names was deleted — deleted outright, not merged into anybody. ` +
          `Nothing is lost, and neither is any gathering they attended — re-creating sends the edit with them, so nobody types it twice. ` +
          `Tally searches ${backend} for a matching person first and links to them if it finds one, rather than adding a second.`,
      };

    case 'failed':
    default:
      return {
        tone: 'bad',
        glyph: '!',
        heading: `${backend} refused this edit`,
        body: edit.message
          ? `${edit.message} ${fields.toLowerCase()}, ${by} ${ago}. Nothing was saved.`
          : `${fields}, ${by} ${ago}. Nothing was saved.`,
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
