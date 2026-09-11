/**
 * The pieces both cards on the Team screen draw a person with.
 *
 * The roster lists profiles and the card beside it lists invitations, but the
 * two rows say the same kind of thing — a name, what is wrong with it, what
 * rank it carries — and they have to *look* like the same kind of thing, or a
 * reader parses the screen as two unrelated tables. Kept here rather than in
 * either file so neither one owns the other's appearance.
 */
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';
import type { Role } from '@/types';
import { useTranslations } from 'use-intl';

export const ROLE_LABEL = {
  counselor: 'roleCounselor',
  core: 'roleCore',
  admin: 'roleAdmin',
} as const satisfies Record<Role, string>;

export const ROLE_OPTIONS: readonly Role[] = ['counselor', 'core', 'admin'];

/** A person's name, and — only when there is one — what is wrong with it. */
export function Identity({
  title,
  suffix,
  badge,
  meta,
  phrasing = false,
}: {
  title: string;
  suffix?: ReactNode;
  badge?: ReactNode;
  meta: ReactNode;
  /**
   * Draw the block out of `span`s rather than a `div` and a `p`.
   *
   * For the one caller that puts a whole identity inside a `<button>` — the
   * Team row, where the name is the control that opens the person. A button may
   * only contain phrasing content, so a `div` and a `p` in there are invalid
   * markup, and the browsers that do not simply tolerate it close the paragraph
   * early and leave the rest of the name outside the target. The layout is
   * identical: `block` on a `span` is what a `p` was doing anyway. A caller
   * passing this has to pass a `span` as its `meta` too.
   */
  phrasing?: boolean;
}) {
  const Box = phrasing ? 'span' : 'div';
  const Line = phrasing ? 'span' : 'p';
  return (
    <Box className={phrasing ? 'block min-w-0' : 'min-w-0'}>
      <Line className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink-50">
        <span className="min-w-0 truncate">{title}</span>
        {suffix}
        {badge}
      </Line>
      {meta}
    </Box>
  );
}

/**
 * A rank, drawn the way this screen draws ranks: a badge means an exception.
 *
 * Counselor is plain text because it is what nearly everybody is, and eleven
 * badges reading "Counselor" teach the eye to skip the lane the one "Admin" is
 * hiding in.
 */
export function RoleTag({ role }: { role: Role }) {
  const t = useTranslations('Team');
  if (role === 'counselor') return <span>{t(ROLE_LABEL[role])}</span>;
  return (
    <Badge tone="brand" className="first:-ml-1.5">
      {t(ROLE_LABEL[role])}
    </Badge>
  );
}
