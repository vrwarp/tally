/**
 * One person, gathered — the facts a director is actually looking for when
 * they tap a name on Team.
 *
 * A disclosure rather than a route, and that is the whole design. The journey
 * this exists for is 9:22 on a Sunday: Sam is standing at the nursery door,
 * somebody with a phone opens Team, finds him, and puts him on Nursery. A page
 * would cost a navigation, a back button and a lost scroll position on the one
 * screen where the reader is holding a list they still want. So the row opens
 * in place, below itself, and closing it puts the list back exactly as it was.
 *
 * ## What it gathers, and why each thing is here
 *
 * - **Role, last seen, how access began and ended.** Four stamps —
 *   `createdAt`, `invitedBy`, `accessEndedAt`/`accessEndedBy`,
 *   `accessRestoredAt` — are the narrow safeguarding fact a children's
 *   director asked to be able to answer: when access was granted, by whom, and
 *   when it ended. Where a stamp is missing the panel says so rather than
 *   guessing; see `invitedByLine`.
 * - **Every narrowed gathering, on it or not**, with the controls drawn *per
 *   chain* rather than per rank — anybody on a chain may add to it, core on
 *   the chain may remove, an admin passes everywhere. That mirrors
 *   `firestore.rules` and `AccessSheet`, which is where the same three lines
 *   are already written; neither enforces anything.
 * - **The kiosks this person paired**, because a device row records who
 *   approved it and their name at the time, and "whose tablet is that" has no
 *   other answer. Retire arms while the kiosk is live: retiring a working
 *   lobby screen mid-morning takes something away, and an installed tablet
 *   that has been re-paired leaves duplicate rows, which is exactly the shape
 *   of list a mis-tap happens in.
 * - **The week's unanswered asks** on the gatherings this person could act on
 *   (P7). Stated, not actioned: the place to answer an ask is the roster's own
 *   "Who's on" sheet, where the name is above the finger and the decision is
 *   being made. Here it is a fact an admin meets on a Tuesday — nobody
 *   answered Sam.
 * - **The shared-mailbox note**, where the address looks like one. One
 *   account is one person in Tally, and the cost of getting that wrong is
 *   every register filed under a name that is not the person who took it.
 *
 * ## The sentence at the foot is not a disclaimer
 *
 * Tally keeps no per-gathering membership history, and this panel is the one
 * place somebody would reasonably assume otherwise: it draws access dates and
 * a list of gatherings side by side, which reads as a history unless it says
 * it is not. A safeguarding record that looks more complete than it is, is
 * worse than one with visible holes.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { useChainTitles } from '@/features/team/gatherings';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import { isOutstanding, subscribeChainRequests } from '@/services/accessRequests';
import { addChainMembers, removeChainMember } from '@/services/eventAccess';
import {
  isKioskLive,
  retireKioskDevice,
  subscribeKioskDevices,
} from '@/services/kioskDevices';
import type { AccessRequest, UserProfile, KioskDevice} from '@/types';
import { useTranslations } from 'use-intl';

/**
 * The uid `provisionAccess` stamps for an address the deployment pins.
 *
 * Nobody invited them, because nobody could have: the address is in a
 * variable, and the grant is re-asserted at every sign-in. The panel says "the
 * deployment" rather than rendering a uid nothing can resolve.
 */
const DEPLOYMENT = 'deployment';

/**
 * When Tally started recording who let somebody in.
 *
 * Every profile older than this has no `invitedBy` and never will — the
 * backfill copies one from a surviving invitation, and most invitations from
 * before the change are long gone. The panel prints the boundary rather than
 * leaving a bare "Not recorded", because a reader who can see *why* the field
 * is empty stops looking for a system that lost it. Move this if the release
 * that carries the stamp does.
 */
const INVITED_BY_RECORDED_FROM = new Date('2026-09-11T00:00:00Z');

/**
 * Local parts that are nearly always a shared mailbox rather than a person.
 *
 * From the proposal's own list. It is a hint on a screen, never a rule: a
 * ministry whose director genuinely reads `kids@` is not wrong, they just need
 * to know that every register taken from that account is filed under it.
 */
const ROLE_MAILBOXES: readonly string[] = [
  'nursery',
  'kids',
  'youth',
  'office',
  'info',
  'admin',
  'hello',
];

function isRoleMailbox(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return ROLE_MAILBOXES.includes(local);
}

export interface PersonPanelProps {
  member: UserProfile;
  /** The whole team, for naming an inviter by their profile rather than a uid. */
  byUid: ReadonlyMap<string, UserProfile>;
  /** The clock the week's asks and a kiosk's liveness are measured against. */
  now?: Date;
}

/**
 * A labelled fact, as two cells of the panel's own grid rather than as a row
 * of its own.
 *
 * Set inline, each value started wherever its label happened to end — four
 * facts at four left edges, in a panel captioned "a person, gathered in one
 * place". The `<dl>` above carries `grid-cols-[auto_minmax(0,1fr)]`, so the
 * label column is as wide as the longest label and no wider, and every value
 * shares one edge at every width without a hard-coded measure.
 *
 * Sentence case, not uppercase: the section headings below are uppercase, and
 * when both wore it the panel read as six peer tags rather than as four facts
 * followed by two sections.
 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="min-w-0 text-sm text-ink-200">{children}</dd>
    </>
  );
}

/** A heading inside the panel: quieter than the card's, louder than a fact's label. */
function PanelHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-400">{children}</h4>
  );
}

/**
 * Every unanswered ask, this week, on the gatherings this person is on.
 *
 * One listener per chain, opened only while the panel is open — which is what
 * makes a per-person read of a collection nobody can query by person
 * affordable. A chain that refuses the read is silence rather than a failure
 * banner: the asks are the least load-bearing thing on this panel, and a red
 * line about them beside somebody's access dates reads as a problem with the
 * person.
 */
function useAsksOnChains(chains: readonly string[], nowMs: number): AccessRequest[] {
  /*
   * The chain list as a value rather than an array, so the effect below can
   * depend on *what* the chains are instead of on the identity of the array
   * that held them — which is new on every render of the panel above.
   */
  const key = JSON.stringify(chains);
  const [byChain, setByChain] = useState<ReadonlyMap<string, AccessRequest[]>>(new Map());

  useEffect(() => {
    const wanted = JSON.parse(key) as string[];
    if (wanted.length === 0) {
      setByChain(new Map());
      return;
    }
    const stops = wanted.map((chain) =>
      subscribeChainRequests(chain, (requests) =>
        setByChain((current) => new Map(current).set(chain, requests)),
      ),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [key]);

  return useMemo(() => {
    const wanted = new Set(JSON.parse(key) as string[]);
    const open: AccessRequest[] = [];
    for (const [chain, requests] of byChain) {
      // A listener's last answer outlives the chain it was about until the
      // effect re-runs, so the set is what decides rather than the map.
      if (!wanted.has(chain)) continue;
      for (const request of requests) if (isOutstanding(request, nowMs)) open.push(request);
    }
    return open.sort((a, b) => (b.askedAt?.getTime() ?? 0) - (a.askedAt?.getTime() ?? 0));
  }, [byChain, key, nowMs]);
}

export function PersonPanel({ member, byUid, now = new Date() }: PersonPanelProps) {
  const t = useTranslations('Team');
  const tCommon = useTranslations('Common');
  const time = useTimeFormats();
  const { profile, can } = useAuth();
  const { access } = useData();
  const { show } = useToast();
  const chainTitles = useChainTitles();

  const uid = profile?.id ?? '';
  const isAdmin = can('admin');
  const name = member.displayName || member.email;
  const nowMs = now.getTime();

  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Which kiosk, if any, is one tap from being put down.
   *
   * One id rather than a set, like the withdrawal on the invite card: arming a
   * second row disarms the first, which is what a half-finished confirmation
   * should do.
   */
  const [armedRetire, setArmedRetire] = useState<string | null>(null);

  const [devices, setDevices] = useState<KioskDevice[] | null>(null);
  const [devicesFailed, setDevicesFailed] = useState(false);

  /*
   * The device rows, read while this panel is open and not before. Core and up
   * may read the collection, which is exactly who can see this screen, so
   * there is no rank to check here — a refusal is drawn as a failure instead.
   */
  useEffect(
    () =>
      subscribeKioskDevices(
        (rows) => {
          setDevicesFailed(false);
          setDevices(rows);
        },
        () => setDevicesFailed(true),
      ),
    [],
  );

  /** Every narrowed gathering, named, in the order a reader would look for one. */
  const narrowed = useMemo(() => {
    const rows = [...access.values()]
      .filter((list) => list.restricted)
      .map((list) => ({
        chain: list.id,
        // A chain whose every occurrence has fallen out of the calendar window
        // and has no series document is left with its key rather than dropped:
        // on this screen the row is a fact about the person, and hiding it
        // would say they are on nothing.
        title: chainTitles.get(list.id) ?? list.id,
        onIt: list.members.has(member.id),
        readerOn: isAdmin || list.members.has(uid),
      }));
    return rows.sort((a, b) => a.title.localeCompare(b.title));
  }, [access, chainTitles, member.id, uid, isAdmin]);

  const memberChains = useMemo(
    () => narrowed.filter((row) => row.onIt).map((row) => row.chain),
    [narrowed],
  );
  const asks = useAsksOnChains(memberChains, nowMs);

  const theirKiosks = useMemo(
    () => (devices ?? []).filter((device) => device.approvedBy === member.id),
    [devices, member.id],
  );

  const add = async (chain: string, title: string) => {
    setBusy(chain);
    try {
      await addChainMembers(chain, [member.id], uid);
      show(t('addedToGathering', { name, gathering: title }), { tone: 'success' });
    } catch {
      show(t('addToGatheringFailed'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (chain: string, title: string) => {
    setBusy(chain);
    try {
      await removeChainMember(chain, member.id, uid);
      show(t('removedFromGathering', { name, gathering: title }), { tone: 'success' });
    } catch {
      show(t('removeFromGatheringFailed'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const retire = async (device: KioskDevice) => {
    setArmedRetire(null);
    setBusy(device.id);
    try {
      await retireKioskDevice(device.id, uid);
      // No Undo, and the toast says what happens instead of leaving a gap
      // where one usually is: the rules refuse un-retiring, because the row is
      // the provenance of every morning that kiosk recorded.
      show(t('kioskRetiredToast', { device: device.id }), { tone: 'success' });
    } catch {
      show(t('retireKioskFailed'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Who let this person in, said honestly.
   *
   * Three answers, and the third is the one that matters: a profile written
   * before the stamp existed has no inviter and never will, so the panel names
   * the boundary rather than printing a blank beside a safeguarding question.
   */
  const invitedByLine = (): string => {
    if (member.invitedBy === DEPLOYMENT) return t('invitedByDeployment');
    if (!member.invitedBy) {
      return t('invitedByNotRecorded', { when: time.shortDate(INVITED_BY_RECORDED_FROM) });
    }
    const inviter = byUid.get(member.invitedBy);
    return inviter ? inviter.displayName || inviter.email : t('someoneNoLongerHere');
  };

  /**
   * When access ended, and — where the profile is still on the team — by whom.
   *
   * The name is looked up rather than stored, so somebody who has themselves
   * left since is a date without an attribution rather than a raw uid. That is
   * the honest reading: the stamp says which account ended it, and this screen
   * can only turn that back into a name while the account is still here.
   */
  const endedLine = (endedAt: Date): string => {
    const by = member.accessEndedBy ? byUid.get(member.accessEndedBy) : undefined;
    const when = time.weekdayDate(endedAt);
    return by ? t('endedByWhen', { when, name: by.displayName || by.email }) : when;
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-ink-900/60 p-3 ring-1 ring-ink-800">
      {/* No ROLE row. The row this panel opens out of carries the role sixty
          pixels above, in a live select — a static duplicate underneath is a
          second answer to a question already answered, in the weaker of the
          two affordances. */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
        <Fact label={t('columnLastSeen')}>
          {member.lastSeenAt ? time.relative(member.lastSeenAt, now) : t('neverSignedIn')}
        </Fact>
        <Fact label={t('factInvitedBy')}>{invitedByLine()}</Fact>
        <Fact label={t('factAccessBegan')}>{time.weekdayDate(member.createdAt)}</Fact>
        {member.accessEndedAt ? (
          <Fact label={t('factAccessEnded')}>{endedLine(member.accessEndedAt)}</Fact>
        ) : null}
        {member.accessRestoredAt ? (
          <Fact label={t('factAccessRestored')}>
            {time.weekdayDate(member.accessRestoredAt)}
          </Fact>
        ) : null}
      </dl>

      <section className="flex flex-col gap-1.5">
        <PanelHeading>{t('gatheringsHeading')}</PanelHeading>
        {narrowed.length === 0 ? (
          <p className="text-sm text-ink-400">{t('panelNothingNarrowed')}</p>
        ) : (
          <>
            {/* What the list is, said once. Without it a single row reading
                "Sunday School — Not on it" is read as the whole answer, and a
                counselor who can work every open gathering in the ministry
                looks like somebody who works none. */}
            <p className="text-xs leading-snug text-ink-500">
              {t('gatheringsScope', { name: member.displayName || member.email })}
            </p>
            <ul className="flex flex-col gap-1">
            {narrowed.map((row) => (
              <li
                key={row.chain}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm text-ink-100">{row.title}</span>
                  {row.onIt ? (
                    <Badge tone="brand">{t('onGathering')}</Badge>
                  ) : (
                    <span className="text-xs text-ink-500">{t('notOnGathering')}</span>
                  )}
                </span>

                {/* An admin passes every fence whatever a list says, so Add and
                    Remove on one would be controls that change a document and
                    nothing else. The sheet says "Always" in the same place. */}
                {member.role === 'admin' ? (
                  <span className="text-xs uppercase tracking-wider text-ink-600">
                    {t('alwaysOn')}
                  </span>
                ) : row.onIt ? (
                  // Never on your own row: `writerStays()` refuses a write that
                  // takes the writer off, so nobody can lock the door behind
                  // themselves and a control offering it would only ever fail.
                  can('core') && row.readerOn && member.id !== uid ? (
                    <Button
                      variant="ghost"
                      loading={busy === row.chain}
                      onClick={() => void remove(row.chain, row.title)}
                    >
                      {tCommon('remove')}
                    </Button>
                  ) : null
                ) : row.readerOn ? (
                  <Button
                    variant="secondary"
                    loading={busy === row.chain}
                    onClick={() => void add(row.chain, row.title)}
                  >
                    {t('addToGathering')}
                  </Button>
                ) : null}
              </li>
            ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <PanelHeading>{t('kiosksHeading')}</PanelHeading>
        {devicesFailed ? (
          <p className="text-sm text-warn-400">{t('kiosksNotLoaded')}</p>
        ) : theirKiosks.length === 0 ? (
          <p className="text-sm text-ink-400">{t('kiosksNone')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {theirKiosks.map((device) => {
              const live = isKioskLive(device, nowMs);
              return (
                <li key={device.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-100">{device.id}</span>
                    <span className="block text-xs text-ink-400">
                      {device.retiredAt
                        ? t('kioskRetiredOn', { when: time.weekdayDate(device.retiredAt) })
                        : live
                          ? t('kioskLive', { gathering: device.boundTo ?? '' })
                          : t('kioskIdle', {
                              when: device.pairedAt ? time.weekdayDate(device.pairedAt) : '',
                            })}
                    </span>
                  </span>

                  {device.retiredAt ? null : armedRetire === device.id ? (
                    <span className="flex items-center gap-2">
                      <Button variant="ghost" onClick={() => setArmedRetire(null)}>
                        {t('keepItRunning')}
                      </Button>
                      <Button
                        variant="danger"
                        loading={busy === device.id}
                        onClick={() => void retire(device)}
                      >
                        {t('yesRetire')}
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={busy === device.id}
                      onClick={() => (live ? setArmedRetire(device.id) : void retire(device))}
                    >
                      {t('retireKiosk')}
                    </Button>
                  )}

                  {/* The consequence on its own line inside the row, the shape
                      Withdraw already uses: short, because the row is
                      shrink-to-fit in the tablet band and a long sentence sets
                      its width. */}
                  {armedRetire === device.id ? (
                    <p role="alert" className="basis-full text-xs text-ink-400">
                      {t('retireLiveWarning', { gathering: device.boundTo ?? '' })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Nothing at all in a week nobody asked: a heading over an empty list is
          chrome saying something happened when it did not. */}
      {asks.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <PanelHeading>{t('asksHeading')}</PanelHeading>
          <ul className="flex flex-col gap-1">
            {asks.map((ask) => (
              <li key={ask.id} className="text-sm text-ink-300">
                {t('askRow', {
                  name: ask.name,
                  gathering: chainTitles.get(ask.chainKey) ?? t('unknownGathering'),
                  when: ask.askedAt ? time.relative(ask.askedAt, now) : '',
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isRoleMailbox(member.email) ? (
        <p className="text-xs leading-snug text-warn-300">
          {t('mailboxNote', { address: member.email })}
        </p>
      ) : null}

      <p className="text-xs leading-snug text-ink-500">{t('noHistoryNote')}</p>
    </div>
  );
}
