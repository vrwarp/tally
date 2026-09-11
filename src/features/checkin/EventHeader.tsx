/**
 * Which event am I checking students into, and how many are here?
 *
 * The date badge is the most important thing on this bar. Checking forty
 * students into last Friday is the worst failure this app has, and the event is
 * now chosen by hand rather than by the clock — so the screen has to keep
 * saying which night it is filing against, loudly, for as long as somebody is
 * tapping. "Today" is reassurance; anything else is a warning.
 *
 * ## The select demotes, never hides
 *
 * A gathering the reader is not on stays in the picker, under "Not yours" at
 * the foot, with a lock — hiding it is how a counselor concludes the app is
 * broken. Choosing one does not navigate: it opens the "Who's on" sheet in
 * place, for that gathering, so the night being worked is never unmounted, and
 * the select goes on reading the night being worked. It is a controlled select
 * whose value is always the current event for exactly that reason: a select
 * reading "Sunday School" over a Friday roster for even a moment is the one
 * mistake the app is built around.
 *
 * The sheet's state lives in `CheckInPage`, because the page has one more
 * reason to open the same sheet — a gathering that has refused three check-ins
 * — and two sheets for one question would be two answers.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, EventIcon } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { AccessSheet } from '@/features/events/AccessSheet';
import { useChainRequests } from '@/features/events/useAccessRequests';
import { useTeam } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import {
  isCheckInOpen,
} from '@/lib/time';
import {
  startOfDay,
} from '@/lib/time';
import type { TallyEvent } from '@/types';
import { useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';

export interface EventHeaderProps {
  event: TallyEvent;
  selectableEvents: readonly TallyEvent[];
  now: Date;
  present: number;
  eligible: number;
  /**
   * Checked in and not yet checked out, on a gathering that tracks check-out.
   *
   * When it does, this is the number the header leads with: it is the entire
   * reason the feature exists, and the attendance total moves beside it rather
   * than away.
   */
  inRoom?: number;
  tracksCheckOut?: boolean;
  /**
   * Which gathering the "Who's on" sheet is open for — `null` when it is shut.
   *
   * Usually this event, opened from the chip; a locked gathering when it was
   * chosen from the select's "Not yours" group. Owned by the page, see above.
   */
  accessSheet: TallyEvent | null;
  onAccessSheetChange: (event: TallyEvent | null) => void;
}

export function EventHeader({
  event,
  selectableEvents,
  now,
  present,
  eligible,
  inRoom = 0,
  tracksCheckOut = false,
  accessSheet,
  onAccessSheetChange,
}: EventHeaderProps) {
  const time = useTimeFormats();
  const t = useTranslations('EventHeader');
  const navigate = useNavigate();
  const { access, canWork } = useData();
  const { show } = useToast();
  const open = isCheckInOpen(event, now);

  const list = access.get(chainKey(event));
  const restricted = list?.restricted === true;
  /*
   * The directory, only for a restricted gathering, and only to leave the
   * suspended out of the count: a chip reading "3" over two people who can
   * take attendance is a number the counselor will act on. Until the directory
   * lands the raw size stands in, rather than a "0" that reads as nobody.
   */
  const { byUid, loading: teamLoading } = useTeam(restricted);
  const onGathering = useMemo(() => {
    const members = [...(list?.members ?? [])];
    if (teamLoading && byUid.size === 0) return members.length;
    return members.filter((uid) => byUid.get(uid)?.active === true).length;
  }, [list, byUid, teamLoading]);
  /*
   * Whether anybody is asking to be put on this gathering.
   *
   * Subscribed on the roster rather than only in the sheet, because the dot is
   * the only signal there is — nothing is notified, so a leader who never opens
   * the sheet would never learn. Only for a restricted gathering: nobody asks
   * to be added to one everybody can already work.
   */
  const asks = useChainRequests(restricted ? chainKey(event) : null, restricted);
  const asking = asks.outstanding.length > 0;

  /*
   * The nudge, once, when an ask lands while somebody who can act on it has
   * the roster open.
   *
   * An ordinary toast: evictable, timed out like every other, and carrying one
   * action. The fact it announces lives in the sheet, which is what makes that
   * acceptable — a place for things that have just happened is not a place for
   * an outstanding item. Keyed on the row id so a re-render never re-announces,
   * and only for rows that arrive *after* the screen settled, so opening a
   * roster does not greet somebody with a week of history.
   */
  const announced = useRef<Set<string> | null>(null);
  useEffect(() => {
    /*
     * The baseline is the first *snapshot*, not the first ask. Taking it from
     * the first ask would swallow exactly the row this exists to announce: on
     * a roster that opened with nobody asking, the one that arrives at 18:40
     * would look like history and be silently added to the set.
     */
    if (!asks.settled) return;
    if (announced.current === null) {
      announced.current = new Set(asks.outstanding.map((row) => row.id));
      return;
    }
    for (const row of asks.outstanding) {
      if (announced.current.has(row.id)) continue;
      announced.current.add(row.id);
      show(t('somebodyAsking', { name: row.name }), {
        action: { label: t('see'), onPress: () => onAccessSheetChange(event) },
      });
    }
  }, [asks.outstanding, asks.settled, show, t, onAccessSheetChange, event]);

  const isToday = startOfDay(event.startAt).getTime() === startOfDay(now).getTime();

  // The picker only offers the last month plus everything upcoming, so an event
  // reached by a deep link may not be in the list — its own option must exist or
  // the select would render someone else's event as selected.
  const options = selectableEvents.some((candidate) => candidate.id === event.id)
    ? selectableEvents
    : [event, ...selectableEvents];

  /*
   * The current night is always in the top group whatever `canWork` says:
   * this header only mounts over a roster the reader may work, and the select
   * has to be able to show its own value.
   */
  const own = options.filter((candidate) => candidate.id === event.id || canWork(candidate));
  const locked = options.filter((candidate) => candidate.id !== event.id && !canWork(candidate));

  return (
    <div>
      {/* The gutter is the page's, not this component's — see `BAND` in
          `CheckInPage`. Every band on the screen shares one left edge, and it
          is the same edge Insights, Events and Students start at. */}
      <div className="flex items-start gap-3">
        {/* Small, and only here: the header scrolls away, so the icon's job is
            to make "am I in the right gathering?" answerable at a glance rather
            than to decorate a screen a counselor is about to work down. */}
        <EventIcon name={event.icon} size="sm" className="mt-0.5" />

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight text-ink-50">{event.title}</h1>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {event.location
              ? t('whenWithLocation', {
                  when: time.eventDay(event.startAt, now),
                  window: time.eventWindow(event),
                  location: event.location,
                })
              : t('when', {
                  when: time.eventDay(event.startAt, now),
                  window: time.eventWindow(event),
                })}
          </p>
        </div>

        <p className="shrink-0 text-right leading-none">
          <span aria-hidden="true" className="text-2xl font-bold tabular-nums text-present-400">
            {tracksCheckOut ? inRoom : present}
            <span className="text-base text-ink-500">
              /{tracksCheckOut ? present : eligible}
            </span>
          </span>
          {/* Both numbers, always: the room count is what the volunteer is
              working from, and the head count is what the evening will be
              remembered as. A screen reader user needs the same pair. */}
          <span className="sr-only">
            {tracksCheckOut
              ? t('spokenInRoom', { inRoom, present, eligible })
              : t('spokenPresent', { present, eligible })}
          </span>
          <span className="mt-1 block text-[11px] uppercase tracking-wide text-ink-500">
            {tracksCheckOut ? t('unitInRoom') : t('unitPresent')}
          </span>
        </p>
      </div>

      {/*
        A status, then the two ways to a different gathering, grouped as such.

        The row used to run three vocabularies — a small grey capsule, a bare
        blue word with no boundary, and a large ringed select — with the two
        controls that do the same job looking least alike, and the one with no
        visible boundary being the one that navigates. The status now sits apart
        at the leading edge and the pair sits together, so proximity says what
        the styling says.

        **One row, always.** The select is the widest control here and the one
        most likely to be reached for on the wrong night, so it is the one that
        flexes: everything beside it holds its size and the select takes what is
        left, truncating rather than wrapping. Letting it wrap put the whole
        control on a line of its own and pushed the roster down a step on every
        phone — and a second line of chips reads as a second group of things,
        which these are not.
      */}
      {/*
        * It wraps, and the select is what moves.
        *
        * Holding one row unconditionally is what produced a gathering select
        * 59px wide rendering as "S." on a 390px phone — a control with no
        * label, in the top-right corner, on the screen a counselor reaches for
        * when they have landed on the wrong night. A second line is a cost
        * paid once at a width; a select nobody can read is paid every time.
        */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/*
          Only when it is a warning.

          The line directly above already says which day this is —
          `formatEventDay` renders "Today" in exactly the spot a reader looks
          first — so a neutral "Today" capsule beside it was the same word
          twice, spending the row's scarcest resource to say nothing new. What
          is *not* redundant is the warn-toned version: "Fri 7" up there is a
          date, and checking forty students into last Friday is the worst
          failure this app has, so that one keeps its capsule and its colour.
        */}
        {!isToday ? (
          <Badge tone="warn" title={t('notTodayTitle')}>
            {event.startAt < now ? t('pastGathering') : t('notToday')}
          </Badge>
        ) : null}

        {/*
          The only route a counselor has to who is on this gathering.

          They never reach the Events tab — it is core-team only — so without
          this chip the volunteer standing next to them at the door could not be
          added by the one person who is allowed to add them. It names the sheet
          it opens — a noun, no verb: the volunteer quick-adds visitors most
          weeks and read "Add" beside a roster as "add a child" — and carries
          the count, because most of the time it is information; the sheet
          behind it is where the verbs are. Nothing else is ever added to it:
          everything beside the select holds its size.

          Brand-coloured like the Change pill beside it, because it opens
          something too. The full sentence lives in the label, where a screen
          reader gets it and the layout does not pay for it.
        */}
        <button
          type="button"
          onClick={() => onAccessSheetChange(event)}
          aria-label={[
            restricted ? t('whoCount', { count: onGathering }) : t('whoEveryone'),
            asking ? t('askWaiting') : '',
          ]
            .filter(Boolean)
            .join(' ')}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink-900 px-3 text-xs font-semibold text-brand-300 ring-1 ring-ink-700 hover:bg-ink-800 active:bg-ink-800 pointer-fine:min-h-9"
        >
          {restricted ? t('whosOnCount', { count: onGathering }) : t('whosOnEveryone')}
          {/*
            * Somebody is asking to be added, and this is the whole of how the
            * roster says so: eight pixels, after the text, no word and no
            * target of its own.
            *
            * It costs the chip no width — the select beside it keeps its
            * measure — and it cannot push a roster row under a descending
            * thumb, which is what ruled out every louder version of this. The
            * sentence is in the label, where a screen reader gets it; the sheet
            * behind the chip is where the ask actually lives.
            */}
          {asking ? (
            <span
              aria-hidden
              data-testid="ask-waiting"
              className="inline-block size-2 shrink-0 rounded-full bg-warn-400"
            />
          ) : null}
        </button>

        {/* The way back to the chooser. It is a link rather than a "back to
            now" jump because there is no longer a "now" the app has picked —
            somebody who is on the wrong night wants the question again, not a
            second guess at the answer. */}
        {/* `ml-1` on top of the row's gap: this is the only control in the
            strip that *leaves* the roster, and at six pixels from the chip
            that opens a sheet a thumb reaching for one lost its place in the
            queue with the other. */}
        <Link
          to="/"
          className="ml-1 flex min-h-11 shrink-0 items-center rounded-full bg-ink-900 px-3 text-xs font-semibold text-brand-300 ring-1 ring-ink-700 hover:bg-ink-800 active:bg-ink-800 pointer-fine:min-h-9"
        >
          {t('change')}
        </Link>

        <select
          aria-label={t('switchEvent')}
          value={event.id}
          onChange={(changed) => {
            // A demoted option fires the sheet and nothing else; the value
            // stays the night being worked. See the note at the top.
            const chosen = locked.find((candidate) => candidate.id === changed.target.value);
            if (chosen) {
              onAccessSheetChange(chosen);
              return;
            }
            navigate(`/event/${changed.target.value}`);
          }}
          /* It flexes because on a phone it is the widest control here and the
             one most likely to be reached for on the wrong night. On a laptop
             band the same rule made it a 900px pill: past the width of the
             longest option there is nothing left to reveal, so it stops. */
          className="min-h-11 min-w-0 flex-1 basis-40 truncate rounded-full bg-ink-900 px-3 text-xs text-ink-200 ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-400 pointer-fine:min-h-9 lg:max-w-sm"
        >
          {own.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {time.shortDate(candidate.startAt)} · {candidate.title}
            </option>
          ))}
          {locked.length > 0 ? (
            <optgroup label={t('notYoursGroup')}>
              {locked.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  🔒 {time.shortDate(candidate.startAt)} · {candidate.title}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>

      {!open ? (
        <p className="mt-2 text-[11px] text-warn-400">
          {t('windowClosed')}
        </p>
      ) : null}

      <AccessSheet
        open={accessSheet !== null}
        onClose={() => onAccessSheetChange(null)}
        event={accessSheet ?? event}
        now={now}
      />
    </div>
  );
}
