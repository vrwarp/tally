/**
 * Who's on this gathering — one sheet, two audiences.
 *
 * Opened from the check-in header, where a counselor stands at a door with a
 * new volunteer beside them, and from the event page, where a core member is
 * deciding what a team should see. Same component: a counselor gets the same
 * screen with fewer verbs, which is how `TeamList` already handles
 * admin-versus-core, and which means nobody has to learn two layouts.
 *
 * ## The sentence that is not a footnote
 *
 * The person is standing on one night's page and about to change every night of
 * the chain, past and future. Every chain-wide act in Tally says what it covers
 * before it does it — `EventDangerZone` makes you type the gathering's name to
 * end a repeat. This one is reversible in a tap, so a sentence is enough, but
 * the sentence has to be there.
 *
 * ## Why closing it pre-fills
 *
 * Nothing stops one core member restricting Friday Fellowship — the gathering
 * the whole ministry works — to themselves, and it is three taps. Starting the
 * list from whoever has recently taken the register makes the default outcome
 * of a mis-tap "no change" rather than "the ministry is locked out of Friday",
 * and the count of who is about to lose access is stated before the switch
 * commits.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, TextField } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { useTeam } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import { isPermissionDenied } from '@/lib/permissionDenied';
import { recentChainInstances } from '@/lib/time';
import {
  addChainMembers,
  recentRegisterTakers,
  removeChainMember,
  reopenChain,
  restrictChain,
} from '@/services/eventAccess';
import type { TallyEvent, UserProfile } from '@/types';

/**
 * How many recent nights the pre-fill reads.
 *
 * Enough to tell a gathering's team from a one-off stand-in, few enough that
 * the sheet opens while somebody is looking at it.
 */
const PREFILL_NIGHTS = 3;

export interface AccessSheetProps {
  open: boolean;
  onClose: () => void;
  event: TallyEvent;
  now: Date;
}

function displayName(profile: UserProfile): string {
  return profile.displayName?.trim() || profile.email;
}

export function AccessSheet({ open, onClose, event, now }: AccessSheetProps) {
  const { access, events } = useData();
  const { profile, can } = useAuth();
  const { show } = useToast();
  const { members: team, byUid, loading: teamLoading } = useTeam(open);

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const chain = chainKey(event);
  const list = access.get(chain);
  const restricted = list?.restricted === true;
  const uid = profile?.id ?? '';

  /*
   * Who may change what.
   *
   * Adding is a counselor's verb and removing is not: handing somebody the
   * access you already hold is not an escalation, and it is the whole of the
   * volunteer-at-the-door journey. Evicting the person who set the gathering up
   * is a different act, and so is flipping the switch, which is a decision about
   * the gathering rather than about a person.
   *
   * These mirror `firestore.rules` rather than enforcing anything. A control
   * that is hidden here is still refused there.
   */
  const onIt = !restricted || list?.members.has(uid) === true || can('admin');
  const mayAdd = onIt;
  const mayRemove = can('core') && onIt;
  const mayFlip = can('core') && onIt;

  const current = useMemo(
    () =>
      [...(list?.members ?? [])]
        .map((memberUid) => byUid.get(memberUid))
        .filter((member): member is UserProfile => member !== undefined)
        .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [list, byUid],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    return team
      .filter((member) => member.active && !list?.members.has(member.id))
      .filter((member) => displayName(member).toLowerCase().includes(needle))
      .slice(0, 6);
  }, [team, query, list]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const failed = (cause: unknown) => {
    show(
      isPermissionDenied(cause)
        ? 'You are not allowed to change who is on this gathering.'
        : 'Could not save that. Try again.',
      { tone: 'error' },
    );
  };

  async function close() {
    setBusy(true);
    try {
      /*
       * Read the recent registers first, so the list arrives populated rather
       * than empty-then-filled. A sheet that flickers from "just you" to "four
       * people" invites somebody to save in the half-second between.
       */
      const recent = recentChainInstances(events, chain, now, PREFILL_NIGHTS);
      const takers = await recentRegisterTakers(recent);
      // Intersected with the directory, because a register also carries
      // `planning-center` and anything else a non-human route wrote.
      const people = [...takers].filter((taker) => byUid.has(taker));

      await restrictChain(chain, people, uid);
      show(`${event.title} is now limited to people you add.`, { tone: 'success' });
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      await reopenChain(chain, uid);
      show(`${event.title} is open to the whole team again.`, { tone: 'success' });
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(false);
    }
  }

  async function add(member: UserProfile) {
    setBusy(true);
    try {
      await addChainMembers(chain, [member.id], uid);
      setQuery('');
      show(`${displayName(member)} can now take this register.`, { tone: 'success' });
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: UserProfile) {
    setBusy(true);
    try {
      await removeChainMember(chain, member.id, uid);
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event.title}
      description={
        /* The gathering, not the night — this is what is about to change. */
        event.mode === 'oneoff' ? 'This gathering' : 'Every gathering in this repeat'
      }
    >
      <div className="flex flex-col gap-4">
        <section>
          {mayFlip ? (
            <div className="flex flex-col gap-2">
              <Button
                variant={restricted ? 'ghost' : 'secondary'}
                onClick={restricted ? reopen : undefined}
                disabled={busy || !restricted}
                aria-pressed={!restricted}
              >
                Everyone on the team
              </Button>
              <Button
                variant={restricted ? 'secondary' : 'ghost'}
                onClick={restricted ? undefined : close}
                disabled={busy || restricted}
                aria-pressed={restricted}
              >
                Only people I add
              </Button>
            </div>
          ) : (
            /* A counselor sees the state as a fact rather than a control they
               would be refused. Not a different screen — fewer verbs. */
            <p className="text-sm text-ink-400">
              {restricted
                ? 'Only people added to this gathering can take its register.'
                : 'Everyone on the team can take this register.'}
            </p>
          )}
        </section>

        {restricted ? (
          <>
            {mayAdd ? (
              <section>
                <TextField
                  label="Add somebody"
                  value={query}
                  onChange={(next) => setQuery(next.target.value)}
                  placeholder="Search the team…"
                  autoComplete="off"
                />
                {matches.length > 0 ? (
                  <ul className="flex flex-col pt-1">
                    {matches.map((member) => (
                      <li key={member.id}>
                        <button
                          type="button"
                          onClick={() => void add(member)}
                          disabled={busy}
                          className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-left text-sm text-ink-200 hover:bg-ink-800"
                        >
                          <span className="truncate">{displayName(member)}</span>
                          <span className="text-xs uppercase tracking-wider text-ink-600">
                            {member.role}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400">
                On this gathering
              </h3>
              {teamLoading && current.length === 0 ? (
                <p className="pt-2 text-sm text-ink-500">Loading the team…</p>
              ) : (
                <ul className="flex flex-col pt-1">
                  {current.map((member) => (
                    <li
                      key={member.id}
                      className="flex min-h-11 items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-ink-200">
                        {displayName(member)}
                        {member.id === uid ? (
                          <span className="pl-2 text-xs text-ink-500">You</span>
                        ) : null}
                      </span>
                      {member.role === 'admin' ? (
                        /* Admins pass the gate whatever this list says, so a
                           Remove here would be a control that does nothing. */
                        <span className="text-xs uppercase tracking-wider text-ink-600">
                          Always
                        </span>
                      ) : mayRemove && member.id !== uid ? (
                        <Button variant="ghost" onClick={() => void remove(member)} disabled={busy}>
                          Remove
                        </Button>
                      ) : (
                        <span className="text-xs uppercase tracking-wider text-ink-600">
                          {member.role}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}

        <p className="text-xs text-ink-500">
          {event.mode === 'oneoff'
            ? 'This applies to this gathering only.'
            : `Changing this affects every ${event.title}, past and future.`}
        </p>
      </div>
    </Modal>
  );
}
