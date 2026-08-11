/**
 * The mark that says something is happening to this student upstream.
 *
 * Two families live on a roster row and they must never be mistaken for each
 * other. The **standing flags** — Allergy, No contact, No birthday, Visitor —
 * are filled badges, and they are facts about a child that will still be true
 * tomorrow. A **job mark** is unfilled and dashed, and it is a thing happening
 * right now that will be gone in a minute. Reading the shape settles which kind
 * of object it is before any word is read, which is what a leader scanning
 * forty-five rows is actually doing.
 *
 * The first pass of this drew job marks as filled amber badges — the allergy
 * badge's exact class string — and the cost was that amber stopped meaning one
 * thing on a row. On the screen where an amber mark can mean "a child carries
 * an EpiPen", it may not also mean "a surname is on its way to Planning Center".
 *
 * Inside the family, **hue answers one question and only one: is this mine to
 * do something about?** Warn is everything that clears itself, danger is
 * everything that will not, present is a job that finished. That is not the
 * same cut as "how did it go" — a `differs` job has finished perfectly well and
 * still needs a human — and sorting by the other question is what put the one
 * row on the list that never resolves itself in with the three that do.
 */
import { cn } from '@/lib/utils';
import {
  isStalled,
  type UpstreamEdit,
  type UpstreamEditState,
} from '@/types';

type Tone = 'run' | 'ok' | 'bad' | 'mute' | 'held';

const TONES: Record<Tone, string> = {
  run: 'text-warn-400 border-warn-500/50',
  ok: 'text-present-400 border-present-500/50',
  bad: 'text-danger-400 border-danger-500/55',
  mute: 'text-ink-400 border-ink-700',
  /** Damped danger: nine rows held by one outage, said once above the list. */
  held: 'text-danger-400/70 border-danger-500/30',
};

/**
 * One mark per state, chosen as silhouettes at 11px rather than as characters
 * in a font table — and none of them a character a standing badge already owns.
 * `⚠` is the allergy badge's and stays the allergy badge's.
 *
 * `merged` shares `differs`' mark deliberately: both mean "it landed and what
 * came back is not what was sent". What they must not share is the *word*.
 */
const GLYPHS: Record<UpstreamEditState, string> = {
  queued: '▪',
  sending: '→',
  waiting: '‖',
  landed: '✓',
  differs: '≠',
  merged: '≠',
  failed: '!',
  orphaned: '⊘',
  cancelled: '▪',
};

interface Words {
  long: string;
  short: string;
  tone: Tone;
  title: string;
}

const WORDS: Record<UpstreamEditState, Words> = {
  queued: {
    long: 'Queued',
    short: 'Queued',
    tone: 'run',
    title: 'Written down and not sent yet — you can still cancel it.',
  },
  sending: {
    long: 'Sending',
    short: 'Sending',
    tone: 'run',
    title: 'A server is talking to the people backend about this one right now.',
  },
  waiting: {
    long: 'Waiting',
    short: 'Waiting',
    tone: 'run',
    title: 'The backend asked Tally to slow down. It resumes on its own — nothing is stuck.',
  },
  landed: {
    long: 'Saved',
    short: 'Saved',
    tone: 'ok',
    title: 'Saved upstream.',
  },
  differs: {
    long: 'Changed upstream',
    short: 'Changed',
    tone: 'bad',
    title:
      'It landed on a value nobody typed — somebody changed the same field upstream. It will not resolve itself.',
  },
  /*
   * A different word from `differs`, on purpose and against the same glyph.
   * "Somebody edited a field" and "this child is now a different person
   * upstream" are the same shape of trouble and completely different errands,
   * and on a phone the word is all a row gets — the caption is `lg:` only.
   */
  merged: {
    long: 'Merged upstream',
    short: 'Merged',
    tone: 'bad',
    title:
      'The person you edited was merged into somebody else upstream. Your correction landed on them, under a different id.',
  },
  failed: {
    long: 'Save failed',
    short: 'Failed',
    tone: 'bad',
    title: 'The backend refused this edit. Open the record to see why.',
  },
  orphaned: {
    long: 'No upstream record',
    short: 'No record',
    tone: 'bad',
    title: 'The person this edit names no longer exists upstream.',
  },
  cancelled: { long: 'Cancelled', short: 'Cancelled', tone: 'mute', title: '' },
};

/** The one wording that is derived from the clock rather than stored. */
const STALLED: Words = {
  long: 'Still sending',
  short: 'Sending',
  tone: 'run',
  title: 'Taking longer than it should. It may still land — nothing has failed.',
};

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

export interface JobChipProps {
  edit: UpstreamEdit;
  now: Date;
  /** The row's cramped form: the word alone, no age. Below `lg`. */
  short?: boolean;
  /** Held by an outage said once above the list — damped, not shouted nine times. */
  held?: boolean;
  /**
   * Makes the chip a link to prose on the same page saying the same thing.
   *
   * Only ever passed where the page holds that sentence in real text, because
   * the point is that a thumb can reach an explanation a pointer gets on hover.
   * A `title` is not an explanation on a touch screen.
   */
  href?: string;
  className?: string;
}

export function JobChip({ edit, now, short, held, href, className }: JobChipProps) {
  const stalled = isStalled(edit, now);
  const words = stalled ? STALLED : WORDS[edit.state];
  const tone: Tone = held ? 'held' : words.tone;
  const glyph = GLYPHS[edit.state];
  const age = shortAge(edit.startedAt ?? edit.createdAt, now);

  const body = (
    <>
      <span aria-hidden="true">{glyph}</span>
      {short ? words.short : `${words.long} · ${age}`}
      {href ? (
        <span aria-hidden="true" className="ml-0.5">
          ↓
        </span>
      ) : null}
    </>
  );

  const classes = cn(
    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border',
    'border-dashed bg-transparent px-2 py-px text-xs font-semibold leading-snug lg:text-[11px]',
    TONES[tone],
    className,
  );

  /*
   * The hit area grows on touch and the visual box does not. "Do not make the
   * chip bigger" and "a thumb needs 44px" are both right, and a pseudo-element
   * is how they are both true at once — it collapses back to the ink at `lg`,
   * where a pointer already has the tooltip.
   */
  if (href) {
    return (
      <a
        href={href}
        title={words.title}
        className={cn(
          classes,
          "relative cursor-pointer after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] lg:after:inset-0",
        )}
      >
        {body}
      </a>
    );
  }

  return (
    <span className={classes} title={words.title}>
      {body}
    </span>
  );
}
