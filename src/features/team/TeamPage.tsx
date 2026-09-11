/**
 * Who can use Tally, and what they can do with it.
 *
 * Two lists, because there are genuinely two states. *Invited* is an address an
 * admin has said may sign in; it has to exist before the person ever appears,
 * since there is no uid to grant a role on until they do. *Signed in* is a real
 * profile, and from that point it — not the invitation — decides what they may
 * do. So withdrawing an invitation stops somebody arriving; deactivating a
 * profile is what removes access from somebody already here.
 *
 * That is also why *Invited* lists only the addresses without a profile yet.
 * Nothing consumes an invitation when it is used, so every address that ever
 * signed in stayed on this card too, in both columns at once, under a heading
 * that said they had not — beside a switch reading "may sign in" that could
 * not touch them. The switch is gone entirely (see `@/services/access`) and the
 * list is filtered, so what is on this card is what the card claims: people who
 * have been let in and have not turned up.
 *
 * Access used to come from a Planning Center List, and this screen used to say
 * so. It could not keep saying so: a List is generated from filter rules, so
 * "these twelve adults may see a roster of minors" was only expressible by
 * inventing a custom field on every person in the church. It was also the wrong
 * place for the decision — the people who edit Planning Center are not
 * necessarily the people who should be granting access to this.
 *
 * It is its own screen rather than the last card on Settings, which is where it
 * used to live. Granting and revoking access to a roster of minors is the most
 * consequential thing an admin does in Tally and the thing they come back to
 * every season; the thresholds above it are set once a year.
 *
 * ## What the critique loop settled
 *
 * Four rounds — see `docs/refinements.md` — and three decisions are worth
 * knowing before editing this file, because each looks like an oddity and is
 * not:
 *
 * **The row is a container query, not a breakpoint.** An admin's roster shares
 * its width with the 24rem invite column, so at `lg` the row has 296px and at
 * 1440px it has 712px; a core member's is wide at both. `lg:` cannot be right
 * for all three. `@2xl` asks the row whether it has room, which is the actual
 * question, and turns three stacked facts into four aligned columns — eleven
 * profiles and four invitations on one laptop screen instead of six.
 *
 * **A badge here means an exception, never a role.** Counselor is plain text.
 * What wears a ring is the thing worth spotting: an elevated role, a suspended
 * person, an address nobody has ever signed in with. The rule holds across both
 * lists and both permission levels, and it is what lets the eye find the one
 * row that needs a decision without reading eleven.
 *
 * **The exceptions are drawn, the normal state is quiet.** Suspension used to
 * be signalled by the *absence* of a blue tick — ten rows shouting "fine" and
 * one saying nothing.
 *
 * **A pinned row is read, not remembered.** The deployment pins some addresses
 * as admins no matter what the database says, and this screen asks the server
 * which ones every time it draws rather than stamping a flag on the profile.
 * The first draft stamped one, and nothing could ever clear it: an address
 * that left the variable would have become an admin account no screen in the
 * app could end — the original defect with its sign flipped. When the question
 * cannot be answered the failure is drawn as a failure, in this file's own
 * idiom: the roster draws, the controls stay, and a line says what could not
 * be checked.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  SkeletonRows,
} from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { InviteCard } from '@/features/team/InviteCard';
import { useAuth } from '@/context/authContext';
import { useToast } from '@/context/toastContext';
import { cn } from '@/lib/utils';
import { listPinnedAdmins } from '@/services/functions';
import { subscribeUsers, upsertUser } from '@/services/users';
import { canonicalEmail, type Role, type UserProfile } from '@/types';
import { useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';

const ROLE_LABEL = {
  counselor: 'roleCounselor',
  core: 'roleCore',
  admin: 'roleAdmin',
} as const satisfies Record<Role, string>;

const ROLE_OPTIONS: readonly Role[] = ['counselor', 'core', 'admin'];

/**
 * The addresses the deployment pins as admins, as this screen knows them.
 *
 * `loading` and `failed` both come with an empty set, and both draw every row
 * with its controls: a slow answer must not withhold the team, and a failed one
 * is said out loud beside the roster rather than guessed at. Only `ready`
 * takes a select and a toggle off a row.
 */
interface PinnedAdmins {
  status: 'loading' | 'ready' | 'failed';
  /**
   * Canonical addresses — see `canonicalEmail` — so a pinned Gmail address
   * matches the profile however the variable spelled it.
   */
  emails: ReadonlySet<string>;
}

const NO_PINNED: ReadonlySet<string> = new Set();

/**
 * The row, as columns, once there is room for columns.
 *
 * Two templates because the two permission levels hold different numbers of
 * things: an admin's row ends in a role control and a toggle, a core member's
 * ends at the role. The read-only one caps its identity track rather than
 * letting it stretch — the freed width belongs at the end of the row, not
 * between somebody's name and the facts about them.
 */
const COLUMNS_EDITABLE = '@2xl:grid-cols-[minmax(0,1fr)_10.5rem_7.5rem_6.5rem]';
const COLUMNS_READ_ONLY = '@2xl:grid-cols-[minmax(0,20rem)_10.5rem_7.5rem]';

/**
 * The access toggle, as one target rather than a box beside a word.
 *
 * `CheckboxField` is right for a form, where a checkbox sits in a column of
 * fields with its own label. In a row lane it produced a 20×20 target twelve
 * pixels from a 44px select — so a tap eight pixels off opened somebody else's
 * role picker, on the one control that removes an adult's access to a roster of
 * minors. Wrapping the pair in a label makes the whole 44px band the target.
 */
function AccessToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  const tCommon = useTranslations('Common');
  return (
    <label className="-mr-2 flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm text-ink-400 pointer-fine:min-h-9 @2xl:mr-0">
      <input
        type="checkbox"
        // Same drawn box as `CheckboxField` — `ui-check` carries the tick; see
        // the rule in `index.css`. The label is what differs: this one is the
        // row's whole 44px lane rather than a checkbox beside a caption.
        className="ui-check size-5 shrink-0 appearance-none rounded bg-ink-950 ring-1 ring-inset ring-ink-600 checked:bg-brand-500 checked:ring-brand-500 disabled:opacity-50"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      {tCommon('active')}
    </label>
  );
}

/** A person's name, and — only when there is one — what is wrong with it. */
function Identity({
  title,
  suffix,
  badge,
  meta,
}: {
  title: string;
  suffix?: ReactNode;
  badge?: ReactNode;
  meta: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink-50">
        <span className="min-w-0 truncate">{title}</span>
        {suffix}
        {badge}
      </p>
      {meta}
    </div>
  );
}

export function TeamPage() {
  const time = useTimeFormats();
  const t = useTranslations('Team');
  const { profile, can } = useAuth();
  const { show } = useToast();

  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => subscribeUsers(setUsers, (cause) => setUsersError(cause.message)), []);

  const isAdmin = can('admin');

  const [pinned, setPinned] = useState<PinnedAdmins>({ status: 'loading', emails: NO_PINNED });
  /** Bumped by Retry, so a failed answer can be asked for again. */
  const [pinnedEpoch, setPinnedEpoch] = useState(0);

  /*
   * Which rows the deployment pins, read where the truth lives.
   *
   * Asked once when the screen draws, and never cached on a profile — a
   * deploy-time fact must not outlive the deploy on a document (see the file
   * comment). Admin-only on the server as well as here, and a core member's
   * read-only view has no controls to take off a row, so it never asks.
   *
   * A failure keeps its empty set: the rows keep their controls, the line at
   * the top of the card says what could not be checked, and a change to a
   * pinned admin made in the meantime reverts at their next sign-in — which
   * is the truth the line states.
   */
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setPinned((current) =>
      current.status === 'loading' ? current : { ...current, status: 'loading' },
    );
    listPinnedAdmins()
      .then((response) => {
        if (cancelled) return;
        setPinned({
          status: 'ready',
          emails: new Set(response.data.emails.map(canonicalEmail)),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPinned({ status: 'failed', emails: NO_PINNED });
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, pinnedEpoch]);

  const patchMember = async (member: UserProfile, changes: { role?: Role; active?: boolean }) => {
    setBusyId(member.id);
    try {
      // `upsertUser` merges, but the whole shape is passed so an edit never
      // drops a field somebody else set from another screen.
      await upsertUser(member.id, {
        email: member.email,
        displayName: member.displayName,
        role: changes.role ?? member.role,
        active: changes.active ?? member.active,
      });
      show(t('memberUpdated', { name: member.displayName || member.email }), { tone: 'success' });
    } catch {
      show(t('saveChangeFailed'), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  /*
   * A–Z, with the reader first.
   *
   * The list arrives in write order, which is no order a reader can use: to
   * find the counselor who left in June you had to read every row. Sorting by
   * name rather than by role or recency also means changing somebody's role
   * never slides their row out from under a pointer already travelling to it.
   */
  const ordered = users
    ? [...users].sort((a, b) => {
        if (a.id === profile?.id) return -1;
        if (b.id === profile?.id) return 1;
        return (a.displayName || a.email).localeCompare(b.displayName || b.email);
      })
    : null;

  const columns = isAdmin ? COLUMNS_EDITABLE : COLUMNS_READ_ONLY;

  return (
    <PageFrame>
      <header>
        <h1 className="text-xl font-bold text-ink-50">{t('title')}</h1>
        <p className="mt-0.5 max-w-2xl text-balance text-sm text-ink-400">
          {t('description')}
        </p>

        {/* Reference, not instruction. It was a boxed paragraph that owned half
            of the first screen — including for a core member, who cannot invite
            anybody — and the one sentence in it worth keeping is the last. */}
        <details className="group mt-2 max-w-2xl">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-3 text-sm font-medium text-ink-400 hover:text-ink-100 pointer-fine:py-1">
            <span
              aria-hidden="true"
              className="inline-block text-xs text-ink-400 transition-transform group-open:rotate-90"
            >
              ▸
            </span>
            {t('howSummary')}
          </summary>
          <p className="pb-2 text-sm leading-snug text-ink-500">
            {t('howBody')}
          </p>
        </details>
      </header>

      <div
        className={cn(
          'grid gap-4',
          isAdmin ? 'lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-6' : 'lg:max-w-3xl',
        )}
      >
        <Card className="@container">
          <CardHeader
            title={t('membersTitle')}
            count={users?.length}
            // A core member is told the category exists rather than shown it:
            // `invitations` is get/list admin-only in the rules, so a count here
            // would be invented. Without the line, eleven profiles read as the
            // complete list of who can sign in, and four addresses already can.
            description={
              isAdmin ? t('membersDescriptionAdmin') : t('membersDescription')
            }
            descriptionClassName={isAdmin ? 'hidden lg:block' : 'text-sm text-ink-400'}
            columns={columns}
            columnLabel={t('columnLastSeen')}
          />

          {/* The failure, rendered as a failure: the roster below keeps every
              control, and this says which of them might not hold. Under the
              header rather than in place of the list, because the list is
              not what failed. */}
          {isAdmin && pinned.status === 'failed' ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ink-800 px-4 py-2">
              <p role="status" className="text-xs text-warn-400">
                {t('pinnedNotLoaded')}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="-mr-2 ring-1 ring-ink-700"
                onClick={() => setPinnedEpoch((epoch) => epoch + 1)}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}

          {usersError ? (
            <div className="px-4 py-3">
              <ErrorBanner message={usersError} />
            </div>
          ) : !ordered ? (
            /* Pulsing bars are nothing to read, so they are hidden — and
               hidden, they are silence, which is exactly what an empty list
               also sounds like. The sentence beside them is the difference.
               `aria-hidden` on the wrapper rather than a prop on the shared
               component: whatever `SkeletonRows` does or does not announce for
               itself, this region announces once, and says which region. */
            <>
              <span role="status" className="sr-only">
                {t('loadingTeam')}
              </span>
              <div aria-hidden="true">
                <SkeletonRows count={3} />
              </div>
            </>
          ) : ordered.length === 0 ? (
            <EmptyState
              title={t('membersEmptyTitle')}
              description={t('membersEmptyBody')}
            />
          ) : (
            <ul className="divide-y divide-ink-800">
              {ordered.map((member) => {
                const isSelf = member.id === profile?.id;
                const isPinned = isAdmin && pinned.emails.has(canonicalEmail(member.email));
                // A row whose controls are an explanation rather than a
                // select and a toggle: the admin's own, and one the
                // deployment pins. Neither can be changed from here, and each
                // says by whom.
                const explained = isAdmin && (isSelf || isPinned);
                const editable = isAdmin && !explained;
                const name = member.displayName || member.email;

                const identity = (
                  <Identity
                    title={name}
                    suffix={
                      isSelf ? (
                        <span className="shrink-0 text-xs font-normal text-ink-500">(you)</span>
                      ) : undefined
                    }
                    badge={!member.active ? <Badge tone="danger">Suspended</Badge> : undefined}
                    meta={<p className="truncate text-xs text-ink-400">{member.email}</p>}
                  />
                );

                {
                  /* Never-signed-in is a fact, not a threshold, so it gets a
                     badge; "11 days ago" does not, because nothing in the
                     product says when a volunteer's silence is a problem. */
                }
                const recency = member.lastSeenAt ? (
                  <p className="min-h-5 truncate text-xs text-ink-300">
                    <span className="@2xl:hidden">{t('lastSeenPrefix')}</span>
                    {time.relative(member.lastSeenAt)}
                  </p>
                ) : (
                  <p className="min-h-5 text-xs">
                    <Badge tone="warn" className="-mx-1.5">
                      {t('neverSignedIn')}
                    </Badge>
                  </p>
                );

                return (
                  <li
                    key={member.id}
                    className={cn(
                      'flex flex-col gap-2 px-4 py-3',
                      editable && 'sm:flex-row sm:items-center sm:justify-between sm:gap-4',
                      // The wash is what binds a 712px row together: the toggle
                      // is 626px from the name it belongs to, and a click one
                      // row high revokes the wrong adult's access.
                      '@2xl:grid @2xl:items-center @2xl:gap-4 @2xl:py-2 @2xl:pointer-fine:hover:bg-ink-800/40',
                      columns,
                    )}
                  >
                    {/* `contents` promotes the identity block's children to grid
                        items at width and leaves the phone's stack untouched. */}
                    <div className="min-w-0 @2xl:contents">
                      {identity}
                      {editable ? (
                        recency
                      ) : (
                        <div className="flex min-w-0 items-center justify-between gap-3 @2xl:contents">
                          {recency}
                          {/* Nothing at all for an explained row rather than
                              an empty cell: `contents` makes this a grid item,
                              and an empty one took column three and pushed the
                              role and its explanation onto a second line. */}
                          {explained ? null : (
                            <div className="flex shrink-0 items-center gap-1.5">
                              {member.role === 'counselor' ? (
                                <span className="text-xs text-ink-400">
                                  {t(ROLE_LABEL[member.role])}
                                </span>
                              ) : (
                                <Badge tone="brand" className="-mx-1.5">
                                  {t(ROLE_LABEL[member.role])}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {editable ? (
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 @2xl:contents">
                        <select
                          aria-label={t('roleFor', { name })}
                          value={member.role}
                          disabled={busyId === member.id}
                          onChange={(changed) =>
                            void patchMember(member, { role: changed.target.value as Role })
                          }
                          // Brand marks the elevated values rather than dimming
                          // the nine plain ones: a select stripped of its ring
                          // *and* its contrast reads as inert text.
                          className={cn(
                            'min-h-11 rounded-xl bg-ink-950 px-2 text-sm ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-50 pointer-fine:min-h-9',
                            // Quiet at rest where there is a pointer to firm it
                            // up; a phone keeps the field, because a control
                            // with no resting affordance is one nobody finds.
                            '@2xl:bg-transparent @2xl:ring-transparent @2xl:hover:bg-ink-950 @2xl:hover:ring-ink-700',
                            member.role === 'counselor' ? 'text-ink-100' : 'text-brand-300',
                          )}
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {t(ROLE_LABEL[role])}
                            </option>
                          ))}
                        </select>

                        <AccessToggle
                          checked={member.active}
                          disabled={busyId === member.id}
                          label={t('maySignIn', { name })}
                          onChange={(active) => void patchMember(member, { active })}
                        />
                      </div>
                    ) : explained ? (
                      <div className="flex flex-wrap items-center gap-1.5 @2xl:col-span-2 @2xl:flex-col @2xl:items-start @2xl:gap-0 @2xl:pl-3">
                        {isPinned ? (
                          /* Pinned by the deployment: no select and no toggle,
                             because a change made here would revert at their
                             next sign-in, and a control that reverts is worse
                             than none. The role still reads — between a deploy
                             and the next sign-in it can be something other
                             than admin, and the row says what it is. */
                          <>
                            <span className="flex items-center gap-1.5">
                              <Badge
                                tone={member.role === 'counselor' ? 'neutral' : 'brand'}
                                className="-ml-1.5"
                              >
                                {t(ROLE_LABEL[member.role])}
                              </Badge>
                              <Badge tone="neutral">{t('pinnedBadge')}</Badge>
                            </span>
                            <span className="text-xs text-ink-400">{t('pinnedExplain')}</span>
                          </>
                        ) : (
                          /* Changing your own role is how an admin locks the
                             team out of user management entirely. */
                          <>
                            <Badge
                              tone={member.role === 'counselor' ? 'neutral' : 'brand'}
                              className="-ml-1.5"
                            >
                              {t(ROLE_LABEL[member.role])}
                            </Badge>
                            <span className="text-xs text-ink-400">
                              {t('otherAdminOnly')}
                            </span>
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/*
          * Who is on their way in, one card over from who is already here.
          *
          * Lifted out whole when the invitation grew a second door: a link is
          * minted rather than typed, lives on a token nobody can recover, and
          * carries four kinds of row — see `InviteCard`. Keeping that inside
          * this file would have made the screen a place where two unrelated
          * jobs shared one set of `useState` calls.
          *
          * Core and up, not admin only. A children's director recruiting her
          * own nursery team used to need an admin over everyone's access to a
          * roster of minors, because she had one nineteen-year-old to add.
          */}
        {can('core') ? <InviteCard members={users} membersError={usersError} /> : null}
      </div>
    </PageFrame>
  );
}
