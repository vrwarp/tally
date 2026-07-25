/**
 * Who can use Tally, and what they can do with it.
 *
 * Two lists, because there are genuinely two facts. Planning Center decides who
 * is *allowed* in (the access roster); a `users/{uid}` document only exists once
 * that person has actually signed in and been provisioned. Showing them side by
 * side is what makes "I invited Sam but she is not in the list" a self-answering
 * question instead of a support call.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Card,
  CardHeader,
  CheckboxField,
  EmptyState,
  ErrorBanner,
  SkeletonRows,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { formatRelative } from '@/lib/time';
import { subscribeAccessRoster } from '@/services/pcoSync';
import { subscribeUsers, upsertUser } from '@/services/users';
import type { AccessRosterEntry, Role, UserProfile } from '@/types';

const ROLE_LABEL: Record<Role, string> = {
  counselor: 'Counselor',
  core: 'Core team',
  admin: 'Admin',
};

const ROLE_OPTIONS: readonly Role[] = ['counselor', 'core', 'admin'];

export function TeamList() {
  const { profile, can } = useAuth();
  const { groups } = useData();
  const { show } = useToast();

  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [roster, setRoster] = useState<AccessRosterEntry[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => subscribeUsers(setUsers, (cause) => setUsersError(cause.message)), []);
  useEffect(
    () => subscribeAccessRoster(setRoster, (cause) => setRosterError(cause.message)),
    [],
  );

  const isAdmin = can('admin');
  const groupNames = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  );
  const signedInEmails = useMemo(
    () => new Set((users ?? []).map((member) => member.email.toLowerCase())),
    [users],
  );

  const patchMember = async (member: UserProfile, changes: { role?: Role; active?: boolean }) => {
    setBusyId(member.id);
    try {
      // `upsertUser` merges, but the whole shape is passed so an edit never
      // drops a field somebody else set from another screen.
      await upsertUser(member.id, {
        email: member.email,
        displayName: member.displayName,
        role: changes.role ?? member.role,
        assignedGroupId: member.assignedGroupId,
        active: changes.active ?? member.active,
      });
      show(`${member.displayName || member.email} updated`, { tone: 'success' });
    } catch {
      show('Could not save that change.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl bg-ink-900 px-4 py-3 text-sm text-ink-400 ring-1 ring-ink-800">
        Access comes from Planning Center — anyone on the right may sign in, and they appear on the
        left only once they have. Roles can be overridden here without changing anything in Planning
        Center.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
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
              description="The first counselor to sign in with an email on the Planning Center roster gets provisioned automatically."
            />
          ) : (
            <ul className="divide-y divide-ink-800">
              {users.map((member) => {
                const isSelf = member.id === profile?.id;
                const group = member.assignedGroupId
                  ? groupNames.get(member.assignedGroupId)
                  : undefined;

                return (
                  <li key={member.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-50">
                        {member.displayName || member.email}
                        {isSelf ? <span className="ml-1 text-xs text-ink-500">(you)</span> : null}
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {member.email}
                        {group ? ` · ${group}` : ''}
                      </p>
                      <p className="text-xs text-ink-600">
                        {member.lastSeenAt
                          ? `Last seen ${formatRelative(member.lastSeenAt)}`
                          : 'Never signed in'}
                      </p>
                    </div>

                    {isAdmin && !isSelf ? (
                      <div className="flex flex-wrap items-center gap-3">
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

        <Card>
          <CardHeader
            title="Planning Center access"
            count={roster?.length}
            description="Who is allowed to sign in."
          />

          {rosterError ? (
            <div className="px-4 py-3">
              <ErrorBanner message={rosterError} />
            </div>
          ) : !roster ? (
            <SkeletonRows count={3} />
          ) : roster.length === 0 ? (
            <EmptyState
              title="No access roster yet."
              description="It is built by the Planning Center sync. Until it runs, only existing team members can sign in."
            />
          ) : (
            <ul className="divide-y divide-ink-800">
              {roster.map((entry) => {
                const hasSignedIn = signedInEmails.has(entry.email.toLowerCase());

                return (
                  <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-50">
                        {entry.displayName || entry.email}
                      </p>
                      <p className="truncate text-xs text-ink-500">{entry.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        tone={entry.role === 'counselor' ? 'neutral' : 'brand'}
                        title="The role Planning Center implies"
                      >
                        {ROLE_LABEL[entry.role]}
                      </Badge>
                      {!entry.active ? <Badge tone="danger">Revoked</Badge> : null}
                      {entry.active && !hasSignedIn ? (
                        <Badge tone="warn">Invited, not yet signed in</Badge>
                      ) : null}
                      <span className="text-xs text-ink-600">
                        synced {formatRelative(entry.syncedAt)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
