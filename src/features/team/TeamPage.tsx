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
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  SelectField,
  SkeletonRows,
  TextField,
} from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { useAuth } from '@/context/authContext';
import { useToast } from '@/context/toastContext';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  inviteToTally,
  setInvitationActive,
  subscribeInvitations,
  withdrawInvitation,
} from '@/services/access';
import { subscribeUsers, upsertUser } from '@/services/users';
import type { Invitation, Role, UserProfile } from '@/types';

const ROLE_LABEL: Record<Role, string> = {
  counselor: 'Counselor',
  core: 'Core team',
  admin: 'Admin',
};

const ROLE_OPTIONS: readonly Role[] = ['counselor', 'core', 'admin'];

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
      Active
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
  const { profile, can } = useAuth();
  const { show } = useToast();

  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  /**
   * Which invitation, if any, is one tap from being deleted.
   *
   * One id rather than a set: arming a second row disarms the first, which is
   * the behaviour a half-finished confirmation should have.
   */
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('counselor');
  const [inviting, setInviting] = useState(false);

  /*
   * The invite card is a disclosure on a phone and an ordinary card on a laptop.
   *
   * Below `lg` it opens on a tap, because promoting the *form* above eleven
   * people — which is what an earlier round did — put zero of them on the first
   * screen and the person an admin came to switch off two and a half viewports
   * down. What is promoted now is the action, at 44px, at the top of the page.
   *
   * `open` is driven rather than left to the browser so the laptop is never in
   * the collapsed state: at `lg` the body is always shown and the summary takes
   * no pointer events. Doing it with `::details-content` instead would have
   * pinned the layout to a browser floor Tally does not otherwise need.
   */
  const [inviteOpen, setInviteOpen] = useState(false);
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => subscribeUsers(setUsers, (cause) => setUsersError(cause.message)), []);

  const isAdmin = can('admin');

  // Admin-only by rule as well as by screen: this is a list of staff addresses,
  // so a core-team subscription would just be a denial in the console. It is
  // also why a core member's screen says outstanding invitations exist rather
  // than showing them — the browser cannot read them to count.
  //
  // Three states, the same three the roster above already has: `null` while
  // the first snapshot is in flight, a string when the read failed, and `[]`
  // only ever from a snapshot that actually arrived.
  //
  // The error callback used to answer `setInvitations([])`, which is not a
  // record of a failure but a claim: the card then drew a count badge reading
  // `0` and an empty state saying everybody invited had signed in. On a dropped
  // connection that is a screen telling an admin — about access to a roster of
  // minors — that four outstanding invitations are not outstanding.
  useEffect(() => {
    if (!isAdmin) return;
    return subscribeInvitations(setInvitations, (cause) => setInvitationsError(cause.message));
  }, [isAdmin]);

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
      show(`${member.displayName || member.email} updated`, { tone: 'success' });
    } catch {
      show('Could not save that change.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = inviteEmail.trim();
    if (!address || !profile || inviting) return;

    setInviting(true);
    try {
      await inviteToTally(address, inviteRole, profile.id);
      setInviteEmail('');
      show(`${address} can now sign in`, { tone: 'success' });
    } catch {
      show('Could not save that invitation.', { tone: 'error' });
    } finally {
      setInviting(false);
    }
  };

  const patchInvitation = async (invitation: Invitation, active: boolean) => {
    setBusyId(invitation.id);
    try {
      await setInvitationActive(invitation.id, active);
    } catch {
      show('Could not save that change.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Puts a withdrawn invitation back, exactly as it was.
   *
   * The document id is derived from the address, so re-inviting writes the same
   * document the delete removed rather than a second one — which is what makes
   * an undo possible at all here. The one thing `inviteToTally` cannot express
   * is a suspended invitation: it always writes `active: true`. Restoring a
   * switched-off address as switched-on would be an undo that quietly grants
   * access, so the hold is put back explicitly.
   */
  const restoreInvitation = async (invitation: Invitation) => {
    if (!profile) return;
    setBusyId(invitation.id);
    try {
      await inviteToTally(invitation.email, invitation.role, profile.id, invitation.note);
      if (!invitation.active) await setInvitationActive(invitation.id, false);
      show(`${invitation.email} invited again`, { tone: 'success' });
    } catch {
      show('Could not restore that invitation.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const dropInvitation = async (invitation: Invitation) => {
    setBusyId(invitation.id);
    try {
      await withdrawInvitation(invitation.id);
      // The only way back from a `deleteDoc`. Without it the confirmation of an
      // irreversible act is the one toast in the app that offers nothing.
      show(`${invitation.email} withdrawn`, {
        tone: 'success',
        action: { label: 'Undo', onPress: () => void restoreInvitation(invitation) },
      });
    } catch {
      show('Could not withdraw that invitation.', { tone: 'error' });
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
  const suspendedInvites = invitations?.filter((invitation) => !invitation.active).length ?? 0;

  return (
    <PageFrame>
      <header>
        <h1 className="text-xl font-bold text-ink-50">Team</h1>
        <p className="mt-0.5 max-w-2xl text-balance text-sm text-ink-400">
          Who may sign in to Tally, and what they may do once they have. Changes apply to every
          phone immediately.
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
            How Tally decides who may sign in
          </summary>
          <p className="pb-2 text-sm leading-snug text-ink-500">
            Tally decides access by Google address. An admin invites somebody here, they sign in
            with that Google account, and their profile appears beside this — from then on the
            profile decides what they may do. Some admins are pinned by the deployment itself and
            cannot be changed here; that is the way back in if access is ever lost.
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
            title="Signed-in team"
            count={users?.length}
            // A core member is told the category exists rather than shown it:
            // `invitations` is get/list admin-only in the rules, so a count here
            // would be invented. Without the line, eleven profiles read as the
            // complete list of who can sign in, and four addresses already can.
            description={
              isAdmin ? 'People with a Tally profile.' : 'Outstanding invitations are not listed here.'
            }
            descriptionClassName={isAdmin ? 'hidden lg:block' : 'text-sm text-ink-400'}
            columns={columns}
            columnLabel="Last seen"
          />

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
                Loading the team
              </span>
              <div aria-hidden="true">
                <SkeletonRows count={3} />
              </div>
            </>
          ) : ordered.length === 0 ? (
            <EmptyState
              title="Nobody has signed in yet."
              description="Invite a Google address above, or sign in with one of the addresses named in TALLY_ADMIN_EMAILS."
            />
          ) : (
            <ul className="divide-y divide-ink-800">
              {ordered.map((member) => {
                const isSelf = member.id === profile?.id;
                const editable = isAdmin && !isSelf;
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
                    <span className="@2xl:hidden">Last seen </span>
                    {formatRelative(member.lastSeenAt)}
                  </p>
                ) : (
                  <p className="min-h-5 text-xs">
                    <Badge tone="warn" className="-mx-1.5">
                      Never signed in
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
                          {/* Nothing at all for the self row rather than an
                              empty cell: `contents` makes this a grid item, and
                              an empty one took column three and pushed the role
                              and its explanation onto a second line. */}
                          {isSelf && isAdmin ? null : (
                            <div className="flex shrink-0 items-center gap-1.5">
                              {member.role === 'counselor' ? (
                                <span className="text-xs text-ink-400">
                                  {ROLE_LABEL[member.role]}
                                </span>
                              ) : (
                                <Badge tone="brand" className="-mx-1.5">
                                  {ROLE_LABEL[member.role]}
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
                          aria-label={`Role for ${name}`}
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
                              {ROLE_LABEL[role]}
                            </option>
                          ))}
                        </select>

                        <AccessToggle
                          checked={member.active}
                          disabled={busyId === member.id}
                          label={`${name} may sign in`}
                          onChange={(active) => void patchMember(member, { active })}
                        />
                      </div>
                    ) : isSelf && isAdmin ? (
                      /* Changing your own role is how an admin locks the team
                         out of user management entirely. */
                      <div className="flex flex-wrap items-center gap-1.5 @2xl:col-span-2 @2xl:flex-col @2xl:items-start @2xl:gap-0 @2xl:pl-3">
                        <Badge
                          tone={member.role === 'counselor' ? 'neutral' : 'brand'}
                          className="-ml-1.5"
                        >
                          {ROLE_LABEL[member.role]}
                        </Badge>
                        <span className="text-xs text-ink-400">
                          Another admin has to change this.
                        </span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {isAdmin ? (
          <Card className="order-first lg:order-none">
            <details
              className="group"
              open={wide || inviteOpen}
              onToggle={(event) => setInviteOpen(event.currentTarget.open)}
            >
              <summary
                className={cn(
                  'flex list-none items-center justify-between gap-3 border-b border-transparent px-4 py-3 group-open:border-ink-800',
                  wide ? 'pointer-events-none' : 'cursor-pointer',
                )}
              >
                <div className="flex min-h-11 flex-col justify-center">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-ink-100">
                    <span
                      aria-hidden="true"
                      className="inline-block text-xs text-ink-400 transition-transform group-open:rotate-90 lg:hidden"
                    >
                      ▸
                    </span>
                    Invited
                    {/* No number at all when the read failed: a stale count is
                        the same false claim the empty state used to make. */}
                    {invitations && !invitationsError ? (
                      <span className="rounded-full bg-ink-800 px-2 py-0.5 text-xs font-semibold text-ink-300">
                        {invitations.length}
                      </span>
                    ) : null}
                  </h2>
                  {/* Shut, the card would otherwise report a clean 4 when one of
                      the four is switched off — or, when the read failed, say
                      nothing whatever beside a "＋ Invite someone" that reads as
                      "nobody is waiting". The banner itself is inside the card. */}
                  {invitationsError ? (
                    <p className="mt-0.5 group-open:hidden lg:hidden">
                      <Badge tone="danger">Not loaded</Badge>
                    </p>
                  ) : suspendedInvites > 0 ? (
                    <p className="mt-0.5 group-open:hidden lg:hidden">
                      <Badge tone="danger">{suspendedInvites} suspended</Badge>
                    </p>
                  ) : null}
                  <p className="mt-0.5 hidden text-sm text-ink-500 lg:block">
                    Addresses that may sign in but have not yet.
                  </p>
                </div>
                <span className="-mr-2 flex shrink-0 items-center lg:hidden">
                  <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-brand-300 group-open:hidden">
                    <span aria-hidden="true">＋</span>Invite someone
                  </span>
                  <span className="hidden min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-ink-400 group-open:inline-flex">
                    Close
                  </span>
                </span>
              </summary>

              <form
                className="flex flex-col gap-3 border-b border-ink-800 px-4 py-3"
                onSubmit={(event) => void handleInvite(event)}
              >
                <TextField
                  label="Google address"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="volunteer@example.org"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  hint="It has to be the Google account they will actually sign in with — Tally matches on the address."
                />
                <SelectField
                  label="Role"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as Role)}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </SelectField>
                <Button type="submit" loading={inviting} disabled={!inviteEmail.trim()}>
                  Invite
                </Button>
              </form>

              {invitationsError ? (
                <div className="px-4 py-3">
                  <ErrorBanner message={invitationsError} />
                </div>
              ) : !invitations ? (
                <>
                  <span role="status" className="sr-only">
                    Loading invitations
                  </span>
                  <div aria-hidden="true">
                    <SkeletonRows count={2} />
                  </div>
                </>
              ) : invitations.length === 0 ? (
                <EmptyState
                  title="No pending invitations."
                  description="Everybody who has been invited has signed in."
                />
              ) : (
                <ul className="divide-y divide-ink-800">
                  {invitations.map((invitation) => (
                    <li
                      key={invitation.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:flex-col lg:items-stretch lg:gap-2"
                    >
                      <Identity
                        title={invitation.email}
                        meta={
                          // The exception leads the line and the granted role
                          // speaks the roster's vocabulary: a pending Core team
                          // is an elevation, and it used to hide in the grey.
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
                            {!invitation.active ? (
                              <Badge tone="danger" className="first:-ml-1.5">
                                Suspended
                              </Badge>
                            ) : null}
                            {invitation.role === 'counselor' ? (
                              <span>{ROLE_LABEL[invitation.role]}</span>
                            ) : (
                              <Badge tone="brand" className="first:-ml-1.5">
                                {ROLE_LABEL[invitation.role]}
                              </Badge>
                            )}
                            {invitation.invitedAt ? (
                              <span>· invited {formatRelative(invitation.invitedAt)}</span>
                            ) : null}
                          </p>
                        }
                      />
                      {/*
                        * The reversible control at the thumb's edge and the
                        * destructive one at the other: they used to sit 12px
                        * apart, both under 44px.
                        *
                        * They were also the wrong way round in weight.
                        * Withdrawing is a `deleteDoc` and it wore `ghost`, the
                        * quietest variant in the system — quieter than the
                        * *reversible* toggle beside it — and fired on one tap,
                        * on a row where those two are the only two things a
                        * thumb can land on. It now costs a second, red tap, the
                        * shape the event page already uses for calling off a
                        * gathering, and the toast that follows offers the way
                        * back. The toggle is untouched: friction on the
                        * reversible act is backwards.
                        */}
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        {confirmingWithdrawal === invitation.id ? (
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={() => setConfirmingWithdrawal(null)}>
                              Keep it
                            </Button>
                            <Button
                              variant="danger"
                              loading={busyId === invitation.id}
                              onClick={() => {
                                setConfirmingWithdrawal(null);
                                void dropInvitation(invitation);
                              }}
                            >
                              Yes, withdraw
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="secondary"
                            disabled={busyId === invitation.id}
                            onClick={() => setConfirmingWithdrawal(invitation.id)}
                          >
                            Withdraw
                          </Button>
                        )}
                        <AccessToggle
                          checked={invitation.active}
                          disabled={busyId === invitation.id}
                          label={`${invitation.email} may sign in`}
                          onChange={(active) => void patchInvitation(invitation, active)}
                        />
                        {/* `basis-full` drops the consequence onto its own line
                            inside the same row rather than adding a wrapper the
                            three layouts would each have to be re-checked
                            against. Short, because in the tablet band the row is
                            shrink-to-fit and a long sentence sets its width. */}
                        {confirmingWithdrawal === invitation.id ? (
                          <p role="alert" className="basis-full text-xs text-ink-400">
                            This deletes the invitation for good.
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </Card>
        ) : null}
      </div>
    </PageFrame>
  );
}
