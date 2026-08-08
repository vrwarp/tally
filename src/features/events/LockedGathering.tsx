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
 */
import { Link } from 'react-router-dom';
import { EventIcon } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { shortName, useTeam } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import { formatEventDay, formatEventWindow } from '@/lib/time';
import type { TallyEvent } from '@/types';

export interface LockedGatheringProps {
  event: TallyEvent;
  now: Date;
  /** Where "back" goes. The chooser from check-in, the calendar from events. */
  backTo?: string;
  backLabel?: string;
}

export function LockedGathering({
  event,
  now,
  backTo = '/',
  backLabel = 'Check-in',
}: LockedGatheringProps) {
  const { access } = useData();
  const { byUid } = useTeam(true);

  const list = access.get(chainKey(event));
  const people = [...(list?.members ?? [])]
    .map((uid) => byUid.get(uid))
    .filter((profile): profile is NonNullable<typeof profile> => profile !== undefined)
    .sort((a, b) => {
      const rank = (role: string) => (role === 'admin' ? 0 : role === 'core' ? 1 : 2);
      return rank(a.role) - rank(b.role);
    });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4">
      <Link to={backTo} className="text-sm font-semibold text-brand-300">
        ‹ {backLabel}
      </Link>

      <header className="flex items-start gap-3">
        <EventIcon name={event.icon} size="lg" tone="muted" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-100">{event.title}</h1>
          <p className="text-sm text-ink-500">
            {formatEventDay(event.startAt, now)} · {formatEventWindow(event)}
          </p>
        </div>
      </header>

      <div className="rounded-2xl bg-ink-900 p-4 ring-1 ring-ink-800">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-200">
          <span aria-hidden>🔒</span> Only people added to this gathering can take its register.
        </p>
        <p className="pt-1 text-sm text-ink-500">
          You are still signed in to Tally and everything else is unchanged — this one gathering
          has been narrowed to a set of people, and you are not on the list yet.
        </p>

        {people.length > 0 ? (
          <>
            <h2 className="pt-4 text-xs font-bold uppercase tracking-wider text-ink-400">
              Ask one of these to add you
            </h2>
            <ul className="flex flex-col pt-1">
              {people.map((profile) => (
                <li key={profile.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <span className="text-ink-200">
                    {profile.displayName ?? shortName(profile) ?? profile.email}
                  </span>
                  <span className="text-xs uppercase tracking-wider text-ink-600">
                    {profile.role}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          /*
           * No names is a real state, not a rendering failure: the directory may
           * not have loaded, or an admin may have restricted the gathering to
           * nobody at all. Either way "find an admin" is the true next step and
           * a blank space is not.
           */
          <p className="pt-3 text-sm text-ink-500">Ask an admin to add you to this gathering.</p>
        )}
      </div>
    </div>
  );
}
