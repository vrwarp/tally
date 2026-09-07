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
import { shortAge } from '@/features/students/syncStripCopy';
import { cn } from '@/lib/utils';
import {
  isStalled,
  type UpstreamEdit,
  type UpstreamEditState,
} from '@/types';
import { useTranslations } from 'use-intl';
import type en from '../../../messages/en.json';

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

/**
 * The three keys a state's chip reads, and its one tone.
 *
 * A `string` here would widen against the typed catalogue and every lookup
 * below would stop compiling — which is the check doing its job.
 */
type ChipKey = Exclude<keyof typeof en.JobChip, 'withAge'>;

interface Words {
  long: ChipKey;
  short: ChipKey;
  tone: Tone;
  /**
   * Null for the one state with nothing to add. An empty catalogue entry would
   * be the obvious spelling and the parity test refuses it — rightly: a
   * translator handed "" cannot tell a deliberate blank from a missed key.
   */
  title: ChipKey | null;
}

/**
 * Keys rather than words: this is a module-level table read at render, and a
 * table cannot call a hook. `tone` and the glyph stay here because they are
 * the same in every language.
 */
const WORDS: Record<UpstreamEditState, Words> = {
  queued: { long: 'queuedLong', short: 'queuedShort', tone: 'run', title: 'queuedTitle' },
  sending: { long: 'sendingLong', short: 'sendingShort', tone: 'run', title: 'sendingTitle' },
  waiting: { long: 'waitingLong', short: 'waitingShort', tone: 'run', title: 'waitingTitle' },
  landed: { long: 'landedLong', short: 'landedShort', tone: 'ok', title: 'landedTitle' },
  differs: { long: 'differsLong', short: 'differsShort', tone: 'bad', title: 'differsTitle' },
  /*
   * A different word from `differs`, on purpose and against the same glyph.
   * "Somebody edited a field" and "this child is now a different person
   * upstream" are the same shape of trouble and completely different errands,
   * and on a phone the word is all a row gets — the caption is `lg:` only.
   */
  merged: { long: 'mergedLong', short: 'mergedShort', tone: 'bad', title: 'mergedTitle' },
  failed: { long: 'failedLong', short: 'failedShort', tone: 'bad', title: 'failedTitle' },
  orphaned: { long: 'orphanedLong', short: 'orphanedShort', tone: 'bad', title: 'orphanedTitle' },
  cancelled: { long: 'cancelledLong', short: 'cancelledShort', tone: 'mute', title: null },
};

/** The one wording that is derived from the clock rather than stored. */
const STALLED: Words = {
  long: 'stalledLong',
  short: 'stalledShort',
  tone: 'run',
  title: 'stalledTitle',
};

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
  const t = useTranslations('JobChip');
  const stalled = isStalled(edit, now);
  const words = stalled ? STALLED : WORDS[edit.state];
  const tone: Tone = held ? 'held' : words.tone;
  const glyph = GLYPHS[edit.state];
  const age = shortAge(edit.startedAt ?? edit.createdAt, now);

  const body = (
    <>
      <span aria-hidden="true">{glyph}</span>
      {short ? t(words.short) : t('withAge', { words: t(words.long), age })}
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
        title={words.title ? t(words.title) : undefined}
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
    <span className={classes} title={words.title ? t(words.title) : undefined}>
      {body}
    </span>
  );
}
