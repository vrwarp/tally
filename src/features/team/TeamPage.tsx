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
 * every season; the thresholds above it are set once a year. Below the fold of a
 * page whose other cards are appearance and API connections is the wrong place
 * to keep it — a leader looking for "who can see this" should not have to scroll
 * past a colour picker to find out.
 */
import { useEffect, useState, type FormEvent } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CheckboxField,
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

export function TeamPage() {
  const { profile, can } = useAuth();
  const { show } = useToast();

  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('counselor');
  const [inviting, setInviting] = useState(false);

  useEffect(() => subscribeUsers(setUsers, (cause) => setUsersError(cause.message)), []);

  const isAdmin = can('admin');

  // Admin-only by rule as well as by screen: this is a list of staff addresses,
  // so a core-team subscription would just be a denial in the console.
  useEffect(() => {
    if (!isAdmin) return;
    return subscribeInvitations(setInvitations, () => setInvitations([]));
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

  const dropInvitation = async (invitation: Invitation) => {
    setBusyId(invitation.id);
    try {
      await withdrawInvitation(invitation.id);
      show(`${invitation.email} withdrawn`, { tone: 'success' });
    } catch {
      show('Could not withdraw that invitation.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageFrame>
      <header>
        <h1 className="text-xl font-bold text-ink-50">Team</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Who may sign in to Tally, and what they may do once they have. Changes apply to every
          phone immediately.
        </p>
      </header>

      <p className="rounded-xl bg-ink-900 px-4 py-3 text-sm text-ink-400 ring-1 ring-ink-800 lg:max-w-4xl">
        Tally decides access by Google address. An admin invites somebody here, they sign in with
        that Google account, and their profile appears beside this — from then on the profile
        decides what they may do. Some admins are pinned by the deployment itself and cannot be
        changed here; that is the way back in if access is ever lost.
      </p>

      {/*
       * Two columns for an admin above `lg`, one for everybody else.
       *
       * The invite form is three short controls, and a screen-wide email box
       * with a screen-wide button under it is what a full-width column does to
       * it — the field looks like it wants a paragraph. Beside the roster it is
       * also where it belongs: inviting somebody and seeing who is already here
       * is one thought, and on a monitor it should be one glance.
       *
       * A core member sees no invite column at all, so the grid would only park
       * the roster in a 60% gutter. They get the single column they had.
       */}
      <div
        className={cn('grid gap-3', isAdmin && 'lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start')}
      >
        <Card>
          <CardHeader
            title="Signed-in team"
            count={users?.length}
            description="People with a Tally profile."
          />

          {usersError ? (
            <div className="px-4 py-3">
              <ErrorBanner message={usersError} />
            </div>
          ) : !users ? (
            <SkeletonRows count={3} />
          ) : users.length === 0 ? (
            <EmptyState
              title="Nobody has signed in yet."
              description="Invite a Google address above, or sign in with one of the addresses named in TALLY_ADMIN_EMAILS."
            />
          ) : (
            <ul className="divide-y divide-ink-800">
              {users.map((member) => {
                const isSelf = member.id === profile?.id;
                const editable = isAdmin && !isSelf;

                return (
                  // Identity left, the controls that act on it right — a phone
                  // stack until there is width for both. Only for a row that
                  // has controls: the read-only rows end in a sentence, and a
                  // sentence flung to the far edge of a monitor reads as a
                  // caption for the whitespace next to it.
                  <li
                    key={member.id}
                    className={cn(
                      'flex flex-col gap-2 px-4 py-3',
                      editable && 'sm:flex-row sm:items-center sm:justify-between sm:gap-4',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-50">
                        {member.displayName || member.email}
                        {isSelf ? <span className="ml-1 text-xs text-ink-500">(you)</span> : null}
                      </p>
                      <p className="truncate text-xs text-ink-500">{member.email}</p>
                      <p className="text-xs text-ink-600">
                        {member.lastSeenAt
                          ? `Last seen ${formatRelative(member.lastSeenAt)}`
                          : 'Never signed in'}
                      </p>
                    </div>

                    {editable ? (
                      <div className="flex shrink-0 flex-wrap items-center gap-3">
                        <select
                          aria-label={`Role for ${member.displayName || member.email}`}
                          value={member.role}
                          disabled={busyId === member.id}
                          onChange={(changed) =>
                            void patchMember(member, { role: changed.target.value as Role })
                          }
                          className="min-h-11 rounded-xl bg-ink-950 px-2 text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-50"
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </option>
                          ))}
                        </select>

                        <CheckboxField
                          label="Active"
                          checked={member.active}
                          disabled={busyId === member.id}
                          onChange={(changed) =>
                            void patchMember(member, { active: changed.target.checked })
                          }
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={member.role === 'counselor' ? 'neutral' : 'brand'}>
                          {ROLE_LABEL[member.role]}
                        </Badge>
                        {!member.active ? <Badge tone="danger">Suspended</Badge> : null}
                        {/* Changing your own role is how an admin locks the team
                            out of user management entirely. */}
                        {isAdmin && isSelf ? (
                          <span className="text-xs text-ink-600">
                            Another admin has to change your own access.
                          </span>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {isAdmin ? (
          <Card>
            <CardHeader
              title="Invited"
              count={invitations?.length}
              description="Addresses that may sign in but have not yet."
            />

            <form className="flex flex-col gap-3 px-4 py-3" onSubmit={(event) => void handleInvite(event)}>
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

            {!invitations ? (
              <SkeletonRows count={2} />
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
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-50">
                        {invitation.email}
                      </p>
                      <p className="text-xs text-ink-500">
                        {ROLE_LABEL[invitation.role]}
                        {invitation.invitedAt ? ` · invited ${formatRelative(invitation.invitedAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                      <CheckboxField
                        label="Active"
                        checked={invitation.active}
                        disabled={busyId === invitation.id}
                        onChange={(changed) =>
                          void patchInvitation(invitation, changed.target.checked)
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === invitation.id}
                        onClick={() => void dropInvitation(invitation)}
                      >
                        Withdraw
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </PageFrame>
  );
}
