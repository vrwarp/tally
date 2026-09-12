/**
 * The lock an admin sees on a gathering somebody has fenced.
 *
 * An admin passes every fence, so a narrowed gathering looked exactly like an
 * open one on their cards and rows — the one person who can fix a fence was
 * the one person who could not see it. Nobody else gets the tag: they already
 * learn it under "Not yours", and a lock on a door open to you is noise.
 *
 * 🔐, not the 🔒 the rest of the app wears, and that is the point: the plain
 * padlock means *you cannot pass* (`LockedGathering`, `NotYoursNotice`, the
 * chooser's locked group). An admin passes this one.
 *
 * No word beside the count. `narrowed` was the only place that word was a
 * label rather than part of a sentence — the button says "Limit", the toast
 * says "limited" — and the two or three admins per church who set fences learn
 * the mark the first time they press Limit. The sentence still goes to a
 * screen reader, and to a pointer on hover.
 */
import { useTranslations } from 'use-intl';
import { Badge } from '@/components/ui';

export function NarrowedBadge({ count }: { count: number }) {
  const t = useTranslations('Events');
  const spoken = t('narrowedTagLabel', { count });

  return (
    <Badge tone="neutral" title={spoken}>
      <span className="sr-only">{spoken}</span>
      <span aria-hidden="true">{t('narrowedTag', { count })}</span>
    </Badge>
  );
}
