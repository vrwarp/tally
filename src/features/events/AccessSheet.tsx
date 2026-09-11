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
 * And it is why the switch cannot be pressed while the sentence still reads
 * "Working out…": the sentence is load-bearing, and pressing past it should
 * not be free.
 *
 * ## The kept list is on screen while the gathering is open
 *
 * A gathering that was narrowed in March and reopened for the summer still
 * holds its list, and narrowing it again keeps that list — `restrictChain`
 * unions rather than overwrites. That used not to be visible: the list about to
 * be kept was on no screen while the gathering was open. So while it is open
 * the sheet draws the kept list and the recent register-takers as ticks under
 * one heading, and unticking is local: nothing is written until "Only people I
 * add" is pressed, and that press is the single write. No per-name write ever
 * happens on an open gathering — `writerStays()` in the rules would refuse a
 * Remove for exactly the core member trimming a March list she is not on.
 *
 * Two things the ticks must not imply. The reader's own row is a fact, not a
 * tick: the rules require the writer on the list and `restrictChain` adds her
 * regardless, so her row is drawn fixed and the preview counts what will
 * actually be written. And somebody added to the document while the sheet is
 * open — Priya, at the door, sixty seconds ago — is kept whatever the ticks say,
 * because the write reads the document first and unions anybody it was not
 * shown; the sheet, already subscribed, draws that person as a ticked row with
 * a note rather than pretending the tick could clear them.
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
 *
 * ## The reader who is not on it
 *
 * Opened by somebody a restricted gathering refuses — from the header select's
 * demoted option, or the chip on a night they were just taken off — the sheet
 * has no verbs to offer, so it opens on the thing the locked page carries: who
 * can add them, by full name, and an admin by name whatever the list says.
 * Same component, different order.
 *
 * ## Suspended members
 *
 * Marked, never hidden, and never counted. Membership survives suspension by
 * design — un-suspending somebody restores them to every gathering they were
 * on — so a suspended member stays on the list with a badge, is left out of
 * every count of who can take attendance, and is never named as the way in.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, CheckboxField, Modal, TextField } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { approversFallback, rankApprovers } from '@/features/events/approvers';
import { AskToBeAdded } from '@/features/events/AskToBeAdded';
import { useChainRequests } from '@/features/events/useAccessRequests';
import { fullName, useTeam } from '@/features/events/useTeam';
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
import { clearAccessRequest } from '@/services/accessRequests';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import type { AccessRequest, Role, TallyEvent, UserProfile } from '@/types';
import { useTranslations } from 'use-intl';

/**
 * How many recent nights the pre-fill reads.
 *
 * Enough to tell a gathering's team from a one-off stand-in, few enough that
 * the sheet opens while somebody is looking at it.
 */
const PREFILL_NIGHTS = 3;

const ROLE_LABEL = {
  counselor: 'roleCounselor',
  core: 'roleCore',
  admin: 'roleAdmin',
} as const satisfies Record<Role, string>;

export interface AccessSheetProps {
  open: boolean;
  onClose: () => void;
  event: TallyEvent;
  now: Date;
}

/**
 * Who has recently taken this register — read on open, not on press.
 *
 * `idle` is a sheet that has no question to answer (shut, or already
 * restricted); `loading` is the second or so the three register reads take,
 * during which the preview says so and the switch is not pressable; `failed`
 * is a register that could not be read, which the preview says outright rather
 * than posing as "nobody has taken them".
 */
interface Prefill {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  uids: string[];
}

const byName = (a: UserProfile, b: UserProfile) => fullName(a).localeCompare(fullName(b));

/**
 * One of the two states, drawn as a choice rather than as an availability.
 *
 * The selected one is the loud one — tick, brand ring, the word "Now" — because
 * that is the only convention a person brings to a pair of boxes in a dim room.
 * Nothing here is `disabled` for being current; a write in the air takes the
 * press away, and so does a preview that has not finished working out what the
 * press would do.
 */
function AccessOption({
  selected,
  label,
  detail,
  disabled,
  onPress,
}: {
  selected: boolean;
  label: string;
  detail: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTranslations('Access');
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
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
              {t('nowBadge')}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-ink-400">{detail}</span>
      </span>
    </button>
  );
}

/** "Miriam, Sam and Dana", or "Miriam, Sam, Dana and 6 more". */
function nameList(t: AccessTranslator, names: readonly string[]): string {
  if (names.length === 0) return t('nobody');
  if (names.length === 1) return names[0]!;
  const head = names.slice(0, 3);
  const rest = names.length - head.length;
  if (rest > 0) return t('nameListMore', { names: head.join(', '), count: rest });
  return t('nameListLast', {
    names: head.slice(0, -1).join(', '),
    last: head[head.length - 1]!,
  });
}

/** The sheet's translator, narrowed so `nameList` can take it as data. */
type AccessTranslator = ReturnType<typeof useTranslations<'Access'>>;

/** The badge a suspended member wears wherever the sheet lists them. */
function SuspendedBadge() {
  const t = useTranslations('Access');
  return <Badge tone="danger">{t('suspended')}</Badge>;
}

export function AccessSheet({ open, onClose, event, now }: AccessSheetProps) {
  const t = useTranslations('Access');
  const tCommon = useTranslations('Common');
  const tEvents = useTranslations('Events');
  const tTeam = useTranslations('Team');
  const time = useTimeFormats();
  const { access, events } = useData();
  const { profile, can } = useAuth();
  const { show } = useToast();
  const { members: team, byUid, loading: teamLoading } = useTeam(open);

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [prefill, setPrefill] = useState<Prefill>(() => ({ status: 'idle', uids: [] }));
  /**
   * Who was on the document when the sheet opened — `null` until it has.
   *
   * Two jobs. Anybody on the document who is not in here arrived while the
   * sheet was open, and is drawn as a fixed tick with a note; and it is what
   * the press hands `restrictChain`, so the write can tell a deliberate untick
   * from a name it was never shown.
   */
  const [seenAtOpen, setSeenAtOpen] = useState<ReadonlySet<string> | null>(null);
  /** The rows the person has unticked. Local until the press; see above. */
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());

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
        .sort(byName),
    [list, byUid],
  );

  /*
   * The calendar, the clock and the access map the effects below read, held
   * in a ref rather than in their dependencies. `now` ticks once a minute on
   * the event page, and a sheet that re-read three nights of registers every
   * minute it stayed open would be paying for a sentence that has not changed;
   * `access` changes whenever anybody anywhere is added, and the moment the
   * sheet *opened* must not move with it.
   */
  const source = useRef({ events, now, access });
  source.current = { events, now, access };

  useEffect(() => {
    if (!open) {
      setSeenAtOpen(null);
      setUnticked(new Set());
      return;
    }
    setSeenAtOpen(new Set(source.current.access.get(chain)?.members ?? []));
  }, [open, chain]);

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
        // shut — but the sentence says so, rather than posing as "nobody has
        // taken them".
        if (live) setPrefill({ status: 'failed', uids: [] });
      });

    return () => {
      live = false;
    };
  }, [open, restricted, chain, mayFlip]);

  /** Everybody the ministry actually has. Inactive accounts cannot take a register. */
  const activeTeam = useMemo(() => team.filter((member) => member.active), [team]);

  /*
   * The two groups the ticks are drawn from.
   *
   * `kept` is whoever the existing document holds — the March list a reopened
   * gathering still carries — and `takers` is whoever has taken the register
   * lately and is not already on it. Both resolved against the directory,
   * because a register also carries `planning-center` and anything else a
   * non-human route wrote, and neither includes the reader, whose row is a
   * fact rather than a tick.
   */
  const kept = useMemo(() => current.filter((member) => member.id !== uid), [current, uid]);
  const takers = useMemo(
    () =>
      [...new Set(prefill.uids)]
        .filter((taker) => taker !== uid && list?.members.has(taker) !== true)
        .map((taker) => byUid.get(taker))
        .filter((member): member is UserProfile => member !== undefined)
        .sort(byName),
    [prefill.uids, byUid, uid, list],
  );
  const you = uid ? byUid.get(uid) : undefined;

  /**
   * On the document, and not there when the sheet opened: somebody else added
   * them while it was open, and the write keeps them whatever the ticks say.
   * Only the document counts — a register-taker is a suggestion, not a fact.
   */
  const arrived = (member: UserProfile) =>
    list?.members.has(member.id) === true && seenAtOpen !== null && !seenAtOpen.has(member.id);
  const ticked = (member: UserProfile) => arrived(member) || !unticked.has(member.id);

  const willKeep = useMemo(
    () => ({ kept: kept.filter(ticked), takers: takers.filter(ticked) }),
    // `ticked` closes over the list and the two sets; listing them is listing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kept, takers, unticked, seenAtOpen, list],
  );

  /*
   * What the press would write, counted the way every count here is counted:
   * the reader is on the list whatever the ticks say, and a suspended member
   * is on it too but cannot take attendance, so is not a person who "can".
   */
  const youOnDocument = list?.members.has(uid) === true;
  const youCounts = you !== undefined && you.active ? 1 : 0;
  const keptCount = willKeep.kept.filter((member) => member.active).length + (youOnDocument ? youCounts : 0);
  const takersCount =
    willKeep.takers.filter((member) => member.active).length + (youOnDocument ? 0 : youCounts);
  const written = keptCount + takersCount;

  /** Active people on the list, once the directory can say who is active. */
  const onList = teamLoading && current.length === 0
    ? (list?.members.size ?? 0)
    : current.filter((member) => member.active).length;

  const openDetail =
    activeTeam.length > 0
      ? t('openDetail', { count: activeTeam.length })
      : teamLoading
        ? t('counting')
        : t('openToAnyone');

  const workingOut = !restricted && (prefill.status === 'idle' || prefill.status === 'loading');

  const restrictedDetail = (() => {
    if (restricted) return t('restrictedDetail', { count: onList });
    if (workingOut) return t('workingOut');
    if (prefill.status === 'failed') {
      return keptCount > 0
        ? t('couldNotReadRegistersKept', { kept: keptCount })
        : t('couldNotReadRegisters');
    }
    const losing = Math.max(0, activeTeam.length - written);
    return list
      ? t('wouldKeepGroups', { kept: keptCount, takers: takersCount, count: losing })
      : t('wouldKeepTakers', { takers: takersCount, count: losing });
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
      .filter((member) => fullName(member).toLowerCase().includes(needle))
      .slice(0, 6);
  }, [team, query, list]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    return team
      .filter((member) => member.active && !list?.members.has(member.id))
      .filter((member) => fullName(member).toLowerCase().includes(needle))
      .slice(0, 6);
  }, [team, query, list]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const failed = (cause: unknown) => {
    show(
      isPermissionDenied(cause)
        ? t('notAllowed')
        : t('saveFailed'),
      { tone: 'error' },
    );
  };

  function toggle(memberUid: string) {
    setUnticked((previous) => {
      const next = new Set(previous);
      if (next.has(memberUid)) next.delete(memberUid);
      else next.add(memberUid);
      return next;
    });
  }

  async function close() {
    // The option is disabled while this is true; belt and braces for a press
    // that raced the state.
    if (workingOut) return;
    setBusy(true);
    try {
      /*
       * Exactly the ticked names. `restrictChain` adds the writer itself, and
       * keeps anybody who reached the document after the sheet opened — the
       * reason `seenAtOpen` travels with the list.
       */
      const chosen = [...willKeep.kept, ...willKeep.takers].map((member) => member.id);
      await restrictChain(chain, chosen, uid, seenAtOpen ?? []);
      show(
        t('nowLimited', { title: event.title, count: written }),
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
      show(t('nowOpen', { title: event.title }), { tone: 'success' });
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Somebody on the gathering answering an ask — by adding them, or by saying
   * they have dealt with it.
   *
   * Both clear the row, and clearing *marks* rather than deletes, which is the
   * whole mechanism: the asker's own screen reads the mark back as "Miriam
   * cleared this at 7:01 — ask her in person", so they can tell being answered
   * from being unread. A delete would leave those two indistinguishable.
   */
  async function answerAsk(request: AccessRequest, alsoAdd: boolean) {
    setBusy(true);
    try {
      if (alsoAdd) await addChainMembers(chain, [request.uid], uid);
      await clearAccessRequest(chain, request.uid, uid);
      show(
        alsoAdd
          ? t('addedFromAsk', { name: request.name })
          : t('cleared', { name: request.name }),
        { tone: 'success' },
      );
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
      show(t('memberAdded', { name: fullName(member) }), { tone: 'success' });
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

  /** One row of the kept list: a tick, or a fixed fact with the reason beside it. */
  const tickRow = (member: UserProfile) => {
    const fixed = arrived(member);
    return (
      <li
        key={member.id}
        className="flex min-h-11 items-center gap-3 pointer-fine:min-h-9"
      >
        <CheckboxField
          label={fullName(member)}
          hint={fixed ? t('addedJustNow') : undefined}
          checked={ticked(member)}
          disabled={busy || fixed}
          onChange={() => toggle(member.id)}
        />
        {!member.active ? <SuspendedBadge /> : null}
      </li>
    );
  };

  /** Who could add a reader the gathering refuses, and the admin fallback. */
  const asks = useChainRequests(restricted ? chain : null, open);
  const canAdd = !onIt ? rankApprovers(list?.members ?? [], byUid, now) : [];
  const fallback = !onIt ? approversFallback(tEvents, team) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event.title}
      description={
        /* The gathering, not the night — this is what is about to change. */
        event.mode === 'oneoff' ? t('scopeOneOff') : t('scopeSeries')
      }
    >
      <div className="flex flex-col gap-4">
        <section>
          {mayFlip ? (
            <div className="flex flex-col gap-2">
              <AccessOption
                selected={!restricted}
                label={t('everyoneOnTeam')}
                detail={openDetail}
                disabled={busy}
                onPress={restricted ? () => void reopen() : () => {}}
              />
              <AccessOption
                selected={restricted}
                label={t('onlyPeopleIAdd')}
                detail={restrictedDetail}
                /* Not pressable while the preview still reads "Working out…":
                   the sentence is what the press decides on. */
                disabled={busy || workingOut}
                onPress={restricted ? () => {} : () => void close()}
              />
            </div>
          ) : (
            /* A counselor sees the state as a fact rather than a control they
               would be refused. Not a different screen — fewer verbs. */
            <p className="text-sm text-ink-400">
              {restricted
                ? t('hintRestricted')
                : t('hintOpen')}
            </p>
          )}
        </section>

        {!restricted && mayFlip ? (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400">
              {t('keptHeading')}
            </h3>
            <p className="pt-1 text-xs text-ink-500">
              {t.rich('keptExplain', {
                option: t('onlyPeopleIAdd'),
                em: (chunks) => (
                  <em className="font-semibold not-italic text-ink-300">{chunks}</em>
                ),
              })}
            </p>
            {workingOut ? (
              <p className="pt-2 text-sm text-ink-500">{t('workingOut')}</p>
            ) : (
              <ul className="flex flex-col pt-1">
                {you ? (
                  /* A fact, not a tick — the rules keep the writer on the list
                     and `restrictChain` adds her regardless, so a box here
                     would be a control that does nothing. */
                  <li className="flex min-h-11 items-center gap-3 text-sm pointer-fine:min-h-9">
                    <span className="text-ink-200">{fullName(you)}</span>
                    <span className="text-xs text-ink-500">{t('you')}</span>
                  </li>
                ) : null}
                {kept.map(tickRow)}
                {takers.map(tickRow)}
              </ul>
            )}
          </section>
        ) : null}

        {restricted && !onIt ? (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400">
              {tEvents('askOneOfThese')}
            </h3>
            {canAdd.length > 0 ? (
              <ul className="flex flex-col pt-1">
                {canAdd.map((member) => (
                  <li key={member.id} className="flex min-h-11 items-center gap-2 text-sm">
                    <span className="text-ink-200">{fullName(member)}</span>
                    <span className="text-xs uppercase tracking-wider text-ink-600">
                      {tTeam(ROLE_LABEL[member.role])}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              /* The directory may not have loaded, or everybody on the list
                 may be suspended. "Find an admin" is true either way. */
              <p className="pt-2 text-sm text-ink-500">{tEvents('askAnAdmin')}</p>
            )}
            {/* Unconditionally, after the names: an admin is always a way in,
                and the person the list names may be on leave since June. */}
            {fallback ? <p className="pt-1 text-sm text-ink-400">{fallback}</p> : null}
            {/* Under the names, because the names are the answer and this is
                only the shortcut to them. */}
            <AskToBeAdded chain={chain} approvers={canAdd} enabled={open} />
          </section>
        ) : null}

        {/*
          * The durable home for an ask, and the first thing on the sheet when
          * there is one.
          *
          * First because it is the only item here that is somebody's to do:
          * everything below is a list to read. It is *here*, rather than on the
          * roster, because a strip inserted above the first roster row would
          * push every name down under a thumb already descending — the
          * mechanism Journey 1 was rebuilt to prevent, on the screen
          * `e2e/layout-shift.spec.ts` holds to a landing budget of zero. What
          * the roster carries instead is a dot on the chip that opens this.
          */}
        {restricted && onIt && asks.outstanding.length > 0 ? (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400">
              {t('askHeading')}
            </h3>
            <ul className="flex flex-col pt-1">
              {asks.outstanding.map((request) => (
                <li key={request.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-200">
                    {request.name}
                  </span>
                  {request.askedAt ? (
                    <span className="text-xs text-ink-500">
                      {t('askRowWhen', { when: time.relative(request.askedAt) })}
                    </span>
                  ) : null}
                  {mayAdd ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void answerAsk(request, true)}
                    >
                      {t('addThem')}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void answerAsk(request, false)}
                  >
                    {t('clear')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {restricted && onIt ? (
          <>
            {mayAdd ? (
              <section>
                <TextField
                  label={t('addSomebody')}
                  value={query}
                  onChange={(next) => setQuery(next.target.value)}
                  placeholder={t('searchTeam')}
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
                          <span className="truncate">{fullName(member)}</span>
                          <span className="text-xs uppercase tracking-wider text-ink-600">
                            {tTeam(ROLE_LABEL[member.role])}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : alreadyOn.length > 0 ? (
                  <p className="px-2 pt-2 text-sm text-ink-400">
                    {t('alreadyOn', {
                      count: alreadyOn.length,
                      names: nameList(t, alreadyOn.map((member) => fullName(member))),
                    })}
                  </p>
                ) : (
                  <p className="px-2 pt-2 text-sm text-ink-400">
                    {t('noTeamMatch', { query: query.trim() })}
                  </p>
                )}
              </section>
            ) : null}

            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-400">
                {t('onThisGathering')}
              </h3>
              {teamLoading && current.length === 0 ? (
                <p className="pt-2 text-sm text-ink-500">{t('loadingTeam')}</p>
              ) : (
                <ul className="flex flex-col pt-1">
                  {current.map((member) => (
                    <li
                      key={member.id}
                      className="flex min-h-11 items-center justify-between gap-2 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-ink-200">
                        <span className="truncate">{fullName(member)}</span>
                        {member.id === uid ? (
                          <span className="text-xs text-ink-500">{t('you')}</span>
                        ) : null}
                        {/* Marked, not hidden: the membership is real and
                            survives the suspension. */}
                        {!member.active ? <SuspendedBadge /> : null}
                      </span>
                      {member.role === 'admin' ? (
                        /* Admins pass the gate whatever this list says, so a
                           Remove here would be a control that does nothing. */
                        <span className="text-xs uppercase tracking-wider text-ink-600">
                          {t('always')}
                        </span>
                      ) : mayRemove && member.id !== uid ? (
                        <Button variant="ghost" onClick={() => void remove(member)} disabled={busy}>
                          {tCommon('remove')}
                        </Button>
                      ) : (
                        <span className="text-xs uppercase tracking-wider text-ink-600">
                          {tTeam(ROLE_LABEL[member.role])}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}

        {/* Only for somebody who can change it — the sentence is about a
            change, and a reader the gathering refuses is not making one. */}
        {onIt ? (
          <p className="text-xs text-ink-500">
            {event.mode === 'oneoff'
              ? t('appliesToThis')
              : t('appliesToSeries', { title: event.title })}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
