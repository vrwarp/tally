/**
 * Who's on this gathering — one sheet, two audiences.
 *
 * Opened from the check-in header, where a counselor stands at a door with a
 * new volunteer beside them, and from the event page, where a core member is
 * deciding what a team should see. Same component: a counselor gets the same
 * screen with fewer verbs, which is how `TeamPage` already handles
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
 *
 * That last clause is why the register read happens when the sheet *opens*
 * rather than when the switch is pressed. A number that arrives with the
 * confirmation is a receipt; the same number one press earlier is a decision.
 *
 * ## Why "current" is not `disabled`
 *
 * The two states used to be told apart by which button was greyed out, which
 * read as the exact inverse of the truth: the active setting wore
 * `disabled:opacity-50` and the one that would fire — writing a restriction
 * across every past and future occurrence — was the bright one. Both are
 * pressable now, and the selected one carries a tick, a ring and the word
 * "Now". Pressing what is already true is a harmless no-op, and safer than a
 * control that looks broken.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, TextField } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { shortName, useTeam } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import { isPermissionDenied } from '@/lib/permissionDenied';
import { cn } from '@/lib/utils';
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

/**
 * One of the two states, drawn as a choice rather than as an availability.
 *
 * The selected one is the loud one — tick, brand ring, the word "Now" — because
 * that is the only convention a person brings to a pair of boxes in a dim room.
 * Nothing here is `disabled` for being current; `busy` is the only thing that
 * takes a press away, and only while a write is in the air.
 */
function AccessOption({
  selected,
  label,
  detail,
  busy,
  onPress,
}: {
  selected: boolean;
  label: string;
  detail: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={busy}
      onClick={onPress}
      className={cn(
        'flex min-h-14 w-full items-start gap-3 rounded-xl px-3 py-3 text-left',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'pointer-fine:min-h-12',
        selected
          ? 'bg-brand-500/15 ring-2 ring-brand-400'
          : 'bg-ink-950 ring-1 ring-ink-800 hover:bg-ink-800',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold ring-1',
          selected
            ? 'bg-brand-500 text-white ring-brand-400'
            : 'bg-ink-900 text-transparent ring-ink-700',
        )}
      >
        ✓
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn('text-sm font-semibold', selected ? 'text-ink-50' : 'text-ink-200')}>
            {label}
          </span>
          {selected ? (
            <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-brand-200">
              Now
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-ink-400">{detail}</span>
      </span>
    </button>
  );
}

/** "Miriam, Sam and Dana", or "Miriam, Sam, Dana and 6 more". */
function nameList(names: readonly string[]): string {
  if (names.length === 0) return 'nobody';
  if (names.length === 1) return names[0]!;
  const head = names.slice(0, 3);
  const rest = names.length - head.length;
  if (rest > 0) return `${head.join(', ')} and ${rest} more`;
  return `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}`;
}

export function AccessSheet({ open, onClose, event, now }: AccessSheetProps) {
  const { access, events } = useData();
  const { profile, can } = useAuth();
  const { show } = useToast();
  const { members: team, byUid, loading: teamLoading } = useTeam(open);

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Who has recently taken this register — read on open, not on press.
   *
   * `idle` is a sheet that has no question to answer (shut, or already
   * restricted); `loading` is the second or so the three register reads take,
   * and the preview says so rather than showing a number it does not have yet.
   */
  const [prefill, setPrefill] = useState<{ status: 'idle' | 'loading' | 'ready'; uids: string[] }>(
    () => ({ status: 'idle', uids: [] }),
  );

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

  /*
   * The calendar and the clock the read uses, held in a ref rather than in the
   * effect's dependencies. `now` ticks once a minute on the event page, and a
   * sheet that re-read three nights of registers every minute it stayed open
   * would be paying for a sentence that has not changed.
   */
  const source = useRef({ events, now });
  source.current = { events, now };

  useEffect(() => {
    // Not for a counselor: they see the state as a sentence and have no switch
    // to press, and three register reads at a door is three reads for nothing.
    if (!open || restricted || !mayFlip) {
      setPrefill({ status: 'idle', uids: [] });
      return;
    }

    let live = true;
    setPrefill({ status: 'loading', uids: [] });

    const { events: known, now: at } = source.current;
    void recentRegisterTakers(recentChainInstances(known, chain, at, PREFILL_NIGHTS))
      .then((takers) => {
        if (live) setPrefill({ status: 'ready', uids: [...takers] });
      })
      .catch(() => {
        // A register that cannot be read is not a reason to hold the sheet
        // shut; the sentence falls back to "just you" and stays honest.
        if (live) setPrefill({ status: 'ready', uids: [] });
      });

    return () => {
      live = false;
    };
  }, [open, restricted, chain, mayFlip]);

  /** Everybody the ministry actually has. Inactive accounts cannot take a register. */
  const activeTeam = useMemo(() => team.filter((member) => member.active), [team]);

  /*
   * Who the restriction would keep, resolved against the directory.
   *
   * Intersected here rather than where the uids were read, because a register
   * also carries `planning-center` and anything else a non-human route wrote —
   * and because the directory usually lands after the registers do.
   */
  const keep = useMemo(() => {
    const ids = new Set(prefill.uids.filter((taker) => byUid.has(taker)));
    // `restrictChain` adds the caller whatever this list says; the sentence
    // should not claim otherwise.
    if (uid) ids.add(uid);
    return [...ids]
      .map((memberUid) => byUid.get(memberUid))
      .filter((member): member is UserProfile => member !== undefined)
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [prefill, byUid, uid]);

  const openDetail =
    activeTeam.length > 0
      ? `${activeTeam.length} ${activeTeam.length === 1 ? 'person' : 'people'} can take this register.`
      : teamLoading
        ? 'Counting the team…'
        : 'Anybody with a Tally account can take this register.';

  const restrictedDetail = (() => {
    if (restricted) {
      const size = list?.members.size ?? 0;
      return `${size} ${size === 1 ? 'person' : 'people'} — everybody else sees it locked.`;
    }
    if (prefill.status !== 'ready') return 'Working out who has been taking this register…';

    const kept = keep.length > 0 ? keep : null;
    const keeping = kept
      ? nameList(kept.map((member) => shortName(member) ?? displayName(member)))
      : 'just you';
    const losing = Math.max(
      0,
      activeTeam.length - (kept?.filter((member) => member.active).length ?? 1),
    );
    return losing === 0
      ? `Would keep ${keeping} — nobody else works this gathering.`
      : `Would keep ${keeping} — ${losing} ${losing === 1 ? 'other would lose' : 'others would lose'} it.`;
  })();

  /*
   * The two ways a search comes back empty, which are not the same answer.
   *
   * `matches` drops anybody already on the gathering, so typing the name of the
   * person you just added looked exactly like typing a name that does not
   * exist. This is what tells them apart.
   */
  const alreadyOn = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    return team
      .filter((member) => list?.members.has(member.id) === true)
      .filter((member) => displayName(member).toLowerCase().includes(needle))
      .slice(0, 6);
  }, [team, query, list]);

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
       * Normally already in hand — the sheet read this when it opened, which is
       * what lets the preview state the count before the press. The await is
       * the case where somebody was faster than three register reads.
       */
      const takers =
        prefill.status === 'ready'
          ? prefill.uids
          : [
              ...(await recentRegisterTakers(
                recentChainInstances(events, chain, now, PREFILL_NIGHTS),
              )),
            ];
      // Intersected with the directory, because a register also carries
      // `planning-center` and anything else a non-human route wrote.
      const people = [...new Set(takers.filter((taker) => byUid.has(taker)))];
      const total = new Set([...people, uid]).size;

      await restrictChain(chain, people, uid);
      show(
        `${event.title} is now limited to ${total} ${total === 1 ? 'person' : 'people'}.`,
        { tone: 'success' },
      );
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
              <AccessOption
                selected={!restricted}
                label="Everyone on the team"
                detail={openDetail}
                busy={busy}
                onPress={restricted ? () => void reopen() : () => {}}
              />
              <AccessOption
                selected={restricted}
                label="Only people I add"
                detail={restrictedDetail}
                busy={busy}
                onPress={restricted ? () => {} : () => void close()}
              />
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
                {query.trim().length === 0 ? null : matches.length > 0 ? (
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
                ) : alreadyOn.length > 0 ? (
                  <p className="px-2 pt-2 text-sm text-ink-400">
                    {nameList(alreadyOn.map((member) => displayName(member)))}{' '}
                    {alreadyOn.length === 1 ? 'is' : 'are'} already on this gathering.
                  </p>
                ) : (
                  <p className="px-2 pt-2 text-sm text-ink-400">
                    Nobody on the team matches “{query.trim()}”.
                  </p>
                )}
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
