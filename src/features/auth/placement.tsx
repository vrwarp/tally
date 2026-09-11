/**
 * What redeeming an invitation did to somebody's gatherings.
 *
 * Two screens say this and they must say it identically: the grant screen,
 * where an ordinary first sign-in happened to consume an invitation, and the
 * join screen, where somebody pressed **Join**. P5 is the argument for saying
 * it at all — a placement is the one moment Tally can confirm the text message
 * the volunteer is holding, and a skip is a fact somebody has to receive rather
 * than discover at a door on Sunday.
 *
 * The skip is not an error and is not styled as one: nothing broke, the person
 * who invited them has simply come off the gathering since, and the way out is
 * to ask a human. It is warned rather than shouted.
 *
 * A one-off carries its date and a chain does not, which is P5's "put on the
 * retreat (Sep 12 only)". The distinction is invisible to the person added and
 * permanent — being on *the retreat* is not being on the trips that follow it —
 * so the server answers `oneOffAt` beside the title rather than leaving the
 * screen to guess, and the date is formatted here because the server has no
 * idea what language anybody reads.
 */
import { useLocale, useTranslations } from 'use-intl';
import type { GatheringName } from '@/services/functions';

export function PlacementNotes({
  placed,
  skipped,
  invitedByName = null,
}: {
  placed?: GatheringName[];
  skipped?: GatheringName[];
  /** The inviter, where the screen knows them. The grant screen does not. */
  invitedByName?: string | null;
}) {
  const t = useTranslations('Auth');
  const locale = useLocale();

  /*
   * The date rides *inside* the name rather than in a clause after it, so a
   * list of three gatherings can hold one dated trip among two chains without
   * the sentence having to be built differently. Day and month only: the year
   * is noise on something happening this season, and a grant screen is read
   * once, now.
   */
  const name = (gathering: GatheringName) =>
    gathering.oneOffAt === null
      ? gathering.title
      : t('oneOffOnly', {
          title: gathering.title,
          date: new Date(gathering.oneOffAt).toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          }),
        });

  /*
   * `Intl.ListFormat` rather than a join: the separator and the conjunction
   * belong to the language — 、 and 和 in Chinese — and these are event titles
   * a leader typed, which are never translated.
   */
  const list = (gatherings: GatheringName[]) =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
      gatherings.map(name),
    );

  const put = placed ?? [];
  const missed = skipped ?? [];

  return (
    <>
      {put.length > 0 ? (
        <p className="text-sm text-ink-300">{t('placed', { gatherings: list(put) })}</p>
      ) : null}
      {missed.length > 0 ? (
        <p className="text-sm text-warn-400">
          {invitedByName
            ? t('skippedByName', {
                gatherings: list(missed),
                name: invitedByName,
                count: missed.length,
              })
            : t('skipped', { gatherings: list(missed), count: missed.length })}
        </p>
      ) : null}
    </>
  );
}
