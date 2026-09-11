/**
 * A gathering somebody has opened but is not on.
 *
 * The shape is borrowed from `ArchivedNight`, which already exists for "you may
 * look at this but you cannot work it" — and the resemblance is the point. This
 * is not an error screen. Nothing has gone wrong, the person is in good
 * standing, and the app is not broken; they have simply not been added to this
 * one gathering. A red banner would say the opposite of all four.
 *
 * What it must not do is mount the register. The check-in screen's whole
 * apparatus — the live attendance listener, the history reads the prediction is
 * built from, `ensureMaterialized` — would each be refused, once a minute,
 * forever, filling the console with failures on a screen that already knows the
 * answer. The caller short-circuits before any of it; see `CheckInPage`.
 *
 * ## Who it names
 *
 * Full names, ranked the way `approvers()` ranks them — whoever opened Tally
 * today first, then the core team, then admins — and never a suspended
 * profile, whose membership survives suspension by design. Then, whatever the
 * list said, one admin by name: an admin passes every gate, and the person the
 * list names may be on leave since June, which the app cannot know and the
 * reader can.
 *
 * ## "You've just been taken off"
 *
 * The live access stream replaces the roster with this page the moment
 * somebody is removed, and a page that then reads as though the reader was
 * never on it is a lie the app knows it is telling — it had a roster open a
 * second ago. `justRemoved` is that fact, decided by the caller, which is the
 * only thing that knows what was mounted before.
 */
import { Link } from 'react-router-dom';
import { EventIcon } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { fallbackAdmin, rankApprovers } from '@/features/events/approvers';
import { AskToBeAdded } from '@/features/events/AskToBeAdded';
import { fullName, useTeam } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import type { Role, TallyEvent } from '@/types';
import { useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';

export interface LockedGatheringProps {
  event: TallyEvent;
  now: Date;
  /** Where "back" goes. The chooser from check-in, the calendar from events. */
  backTo?: string;
  /** The word after the chevron. Without one, "Check-in" — the chooser. */
  backLabel?: string;
  /**
   * The reader had this gathering's roster open and was taken off it just now.
   *
   * Swaps the lead sentence for one that says so. See the note above.
   */
  justRemoved?: boolean;
}

const ROLE_LABEL = {
  counselor: 'roleCounselor',
  core: 'roleCore',
  admin: 'roleAdmin',
} as const satisfies Record<Role, string>;

export function LockedGathering({
  event,
  now,
  backTo = '/',
  backLabel,
  justRemoved = false,
}: LockedGatheringProps) {
  const time = useTimeFormats();
  const t = useTranslations('Events');
  const tCheckIn = useTranslations('CheckIn');
  const tTeam = useTranslations('Team');
  const { access } = useData();
  const { members: team, byUid } = useTeam(true);

  /*
   * The errand, read off the clock rather than plumbed through the route.
   *
   * A locked past row on the catch-up tail and a locked row for tonight go to
   * the same URL, so nothing in the link says which errand brought somebody
   * here — but a gathering that has already finished can only have been
   * reached for its register.
   */
  const finished = (event.endAt ?? event.startAt).getTime() < now.getTime();
  const chain = chainKey(event);
  const list = access.get(chain);
  const people = rankApprovers(list?.members ?? [], byUid, now);
  /*
   * The admin, as a row rather than as a sentence after the list.
   *
   * They are unconditionally a way in — the point of naming them at all — and
   * under the list as prose that read as the afterthought instead of as the
   * answer. Skipped when the ranking already named them, or the same person
   * would appear twice.
   */
  const admin = fallbackAdmin(team);
  const askable = admin && !people.some((one) => one.id === admin.id) ? [...people, admin] : people;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4">
      <Link to={backTo} className="text-sm font-semibold text-brand-300">
        {backLabel ? `‹ ${backLabel}` : tCheckIn('backToCheckIn')}
      </Link>

      <header className="flex items-start gap-3">
        <EventIcon name={event.icon} size="lg" tone="muted" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-100">{event.title}</h1>
          <p className="text-sm text-ink-500">
            {t('when', {
              day: time.eventDay(event.startAt, now),
              window: time.eventWindow(event),
            })}
          </p>
        </div>
      </header>

      <div className="rounded-2xl bg-ink-900 p-4 ring-1 ring-ink-800">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-200">
          <span aria-hidden>🔒</span> {t('lockedRestricted')}
        </p>
        {/*
          * Three sentences, and which one is true is something the app knows
          * without asking. Taken off just now: it had the roster open a second
          * ago, so saying "you are not on this" would be a lie it knows it is
          * telling. A gathering that has finished: the reader came here to take
          * a register for a night that is over — the catch-up errand — and a
          * sentence about tonight would not answer them. Otherwise, the plain
          * one.
          */}
        {/* The measure, not the card. Two sentences do the whole work of this
            screen and they were set to 97 characters a line in a 737px card
            on a 1440px window — a width nothing forced. */}
        <p className="max-w-[62ch] pt-1 text-sm text-ink-500">
          {justRemoved
            ? t('justTakenOff')
            : finished
              ? t('lockedCatchUp')
              : t('lockedExplain')}
        </p>

        {askable.length > 0 ? (
          <>
            <h2 className="pt-4 text-xs font-bold uppercase tracking-wider text-ink-400">
              {t('askOneOfThese')}
            </h2>
            <ul className="flex flex-col pt-1">
              {askable.map((profile) => (
                <li key={profile.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <span className="text-ink-200">{fullName(profile)}</span>
                  <span className="text-xs uppercase tracking-wider text-ink-600">
                    {tTeam(ROLE_LABEL[profile.role])}
                  </span>
                </li>
              ))}
            </ul>
            {/* Under the names, because the names are the answer and this is
                the shortcut to them — not a substitute for walking over. */}
            <AskToBeAdded chain={chain} approvers={askable} />
          </>
        ) : (
          /*
           * No names is a real state, not a rendering failure: the directory may
           * not have loaded, an admin may have restricted the gathering to
           * nobody at all, or everybody on it may be suspended. Either way "find
           * an admin" is the true next step and a blank space is not.
           */
          /* `askable` being empty means there is no active admin in the
             directory either, so there is no name to print — the sentence is
             all there is to say, and the button is still worth offering. */
          <>
            <p className="pt-3 text-sm text-ink-500">{t('askAnAdmin')}</p>
            <AskToBeAdded chain={chain} approvers={askable} />
          </>
        )}
      </div>
    </div>
  );
}
