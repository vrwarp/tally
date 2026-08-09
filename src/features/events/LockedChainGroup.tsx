/**
 * One gathering the reader is not on, and every night of it, in one row.
 *
 * The idiom is `LockedGatherings`' — a divider, a collapsed group, a lock, and
 * the name of somebody who can let you in — carried from the counselor's chooser
 * onto the calendar, where the same problem is larger. A core member who has
 * never stood at the Friday door sees the whole Friday and Sunday calendar, and
 * before this every one of those thirty-one nights carried its own padlock,
 * eleven pixels high, at the far right edge of a row otherwise identical to the
 * rows that work.
 *
 * The head states everything true of the chain and the rows state what is not.
 *
 *  - **The chain's name**, once, instead of thirty-one times.
 *  - **The date that matters** — the next one coming up, or the latest one gone
 *    by. This is the fact a leader actually opens the calendar for, and the
 *    first version of this component buried it behind the disclosure while
 *    spending the head's first line on a count nobody had asked for.
 *  - **The time and the room**, whenever the chain shares them, which a weekly
 *    series always does. See `sharedDetail`.
 *  - **The count**, at the right margin, at `lg` only. The phone's head has
 *    about 248px of title run and the title already uses nearly all of it, so a
 *    right-hand word there would truncate the date to buy a redundancy.
 *
 * ## Why the head is not a card
 *
 * A filled surface is the one treatment unavailable here. On this screen a fill
 * means *this one is yours* — it is what makes the two gatherings the reader can
 * open findable at a glance in a column of thirty — so bracketing the group with
 * one would say the opposite of what the lock says. The head is bracketed by
 * where its marks sit instead: the caret inline beside the date it discloses
 * rather than parked in the far margin, and a rail down the children.
 */
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { LockedEventRow } from '@/features/events/LockedEventRow';
import { sharedDetail, sharedWeekday, type LockedChain } from '@/features/events/lockedChains';

export interface LockedChainGroupProps {
  chain: LockedChain;
  /** `next` ahead of today, `latest` behind it — see `partitionBand`. */
  lead: 'next' | 'latest';
  /**
   * Open on mount. Mirrors `LockedGatherings`' `open={!hasOwn}`: when nothing in
   * a band is the reader's, the group is the band, and a reader looking at an
   * apparently empty week needs to see what is actually on it.
   */
  defaultOpen?: boolean;
}

/**
 * A locked chain with exactly one night on this band.
 *
 * The head's recipe, with a chevron where the caret would be, because there is
 * nothing to disclose and everywhere to go. Deliberately not the child row's
 * recipe: this sits in the band's own list beside group heads, and the two have
 * to line up.
 */
function SoloLockedRow({ chain, detail }: { chain: LockedChain; detail: string | null }) {
  const event = chain.events[0]!;

  return (
    <li>
      <Link
        to={`/events/${event.id}`}
        className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl px-3 py-1.5 hover:bg-ink-800/40 active:bg-ink-800 pointer-fine:min-h-11"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-11 shrink-0 items-center justify-center text-xl grayscale opacity-80"
        >
          🔒
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink-200">
            <span className="sr-only">Not yours · </span>
            {chain.label}
            <span className="font-normal text-ink-400"> ·</span>{' '}
            {format(event.startAt, 'EEE, MMM d')}
          </span>
          {detail ? (
            <span className="mt-0.5 block text-xs leading-snug text-ink-400">{detail}</span>
          ) : null}
        </span>

        <span aria-hidden="true" className="shrink-0 text-lg text-ink-400">
          ›
        </span>
      </Link>
    </li>
  );
}

/** How the head names its date. A chain on one weekday has already said it. */
function headDate(chain: LockedChain): string {
  const anchor = chain.events[0]!;
  return format(anchor.startAt, sharedWeekday(chain.events) ? 'EEE d' : 'EEE, MMM d');
}

export function LockedChainGroup({ chain, lead, defaultOpen = false }: LockedChainGroupProps) {
  const detail = sharedDetail(chain.events);
  const weekday = sharedWeekday(chain.events);
  const listId = useId();

  /*
   * A group of one is not a group.
   *
   * Four of the eight disclosures on the first version of this screen guarded a
   * single row each — a control whose whole job was to reveal the thing it was
   * already naming, and the case where a mis-tap cost the most for the least. A
   * chain with one night on the calendar is drawn at the head's own weight and
   * simply goes there.
   */
  if (chain.events.length === 1) {
    return <SoloLockedRow chain={chain} detail={detail} />;
  }

  return (
    <li>
      <details open={defaultOpen} className="group">
        <summary className="flex min-h-14 min-w-0 cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-1.5 hover:bg-ink-800/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 pointer-fine:min-h-11">
          {/* No tile and no ring — the absence of a surface is what says "not
              yours". The glyph is `text-xl` so it holds the 44px slot it shares
              with every icon tile on the page; at `text-sm` it was the smallest
              mark on the screen sitting in the largest slot, and the first thing
              to disappear at a squint. */}
          <span
            aria-hidden="true"
            className="inline-flex size-11 shrink-0 items-center justify-center text-xl grayscale opacity-80"
          >
            🔒
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-ink-200">
              <span className="min-w-0 truncate">
                {/* The count, for a reader who cannot see the right margin. It
                    is the same fact the `lg:` span below carries, said once. */}
                <span className="sr-only">{`Not yours · ${chain.events.length} gatherings · `}</span>
                {chain.label}
                <span className="font-normal text-ink-400">{` · ${lead}`}</span> {headDate(chain)}
              </span>

              {/*
                Beside the date, not in the far margin.

                A head and a single locked row are otherwise the same drawn
                object, and the difference between "this opens under your thumb"
                and "this leaves the page" was a glyph 470px from the title the
                eye reads. `origin-[50%_69%]` because the flip has to turn about
                the arrowhead's ink rather than its em box, which sits 6px away.
              */}
              <span
                aria-hidden="true"
                className="shrink-0 origin-[50%_69%] text-base leading-none text-ink-500 transition-transform group-open:rotate-180"
              >
                ⌄
              </span>
            </span>

            {detail ? (
              <span className="mt-0.5 block text-xs leading-snug text-ink-400">{detail}</span>
            ) : null}
          </span>

          <span
            aria-hidden="true"
            className="hidden shrink-0 text-xs tabular-nums text-ink-400 lg:block"
          >
            {chain.events.length} gatherings
          </span>
        </summary>

        {/*
          A ladder on a phone, a wrapping flow where there is a pointer.

          Each child carries one six-character token, so a row per token is a
          column layout applied to data that is not a column: thirteen dates cost
          546px stacked and 108px wrapped. The rail is the ladder's device and is
          hidden at `lg` for the same reason — a spine beside a flow is a stub
          attached to nothing, and this page allows a hairline exactly one
          meaning.

          `lg:pl-14.5` rather than `lg:pl-17`: the chip carries its own 10px of
          padding for its hover rect, so the list is indented by the axis minus
          that, which lands every wrapped row's glyphs on the column's text edge
          rather than only the first.
        */}
        <ul
          id={listId}
          className="relative mt-1 mb-1 flex flex-col gap-0.5 before:absolute before:inset-y-0 before:left-8 before:w-px before:bg-ink-800 lg:flex-row lg:flex-wrap lg:gap-1 lg:pl-14.5 lg:before:hidden"
        >
          {chain.events.map((event) => (
            <LockedEventRow key={event.id} event={event} sharedWeekday={weekday} detail={detail} />
          ))}
        </ul>
      </details>
    </li>
  );
}
