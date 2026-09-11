/**
 * Who has been let in and has not turned up yet — and what happened to the
 * ones who have.
 *
 * The card holds four kinds of row, and they are four kinds rather than one
 * list with badges because each of them is a different question:
 *
 * - **A link** is named by the words the inviter typed, because it has no
 *   address until somebody spends it. It says when it stops working and
 *   carries the two acts that keep it alive: **Extend**, which mints a new
 *   token, and **QR**, which mints a ten-minute one for the person standing in
 *   the room. Both re-mint, so the row's id changes underneath them — every
 *   act here reads the row back off the subscription rather than assuming the
 *   id it started with is still there.
 * - **An address** is the old kind, and now says who invited it and what it is
 *   for.
 * - **Arrived this week** is the confirmation the inviter would otherwise have
 *   to go looking for: the name and the address the link was actually spent
 *   by. A name nobody recognises is one tap from a suspension, one card over.
 *   These rows carry no Withdraw — the invitation is now the audit record of
 *   who arrived on it, and deleting it would evict nobody.
 * - **An outstanding placement** is the one thing on this card that is somebody's
 *   to do: a gathering the redemption could not add them to, because the
 *   inviter had come off it in the meantime. It stays until the person is on
 *   the gathering or somebody says to stop asking.
 *
 * Withdraw appears only where the rules would actually allow the delete — an
 * admin on any unspent invitation, a core member on the counselor ones they
 * created. A control that produces a permission error is worse than no control.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  SkeletonRows,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { useServerText } from '@/hooks/useServerText';
import { useTimeFormats } from '@/hooks/useTimeFormats';
import { Identity, RoleTag } from '@/features/team/Identity';
import { useChainTitles } from '@/features/team/gatherings';
import { InviteForm } from '@/features/team/InviteForm';
import { InviteLinkPanel, type MintedLink } from '@/features/team/InviteLinkPanel';
import {
  readDismissedSkips,
  skipId,
  writeDismissedSkips,
} from '@/features/team/dismissedSkips';
import { cn } from '@/lib/utils';
import { inviteToTally, subscribeInvitations, withdrawInvitation } from '@/services/access';
import { addChainMembers } from '@/services/eventAccess';
import { refreshInvitationLink, type InviteLife } from '@/services/functions';
import { canonicalEmail, type Invitation, type UserProfile } from '@/types';
import { useTranslations } from 'use-intl';

/** How long an arrival stays news. The proposal's word for it is "this week". */
const ARRIVED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteCardProps {
  /** The signed-in team. Null while the roster read is in flight. */
  members: UserProfile[] | null;
  /** Set when that read failed — see the sorting note below. */
  membersError: string | null;
}

/** One gathering one redemption could not carry out. */
interface OutstandingSkip {
  invitation: Invitation;
  chain: string;
  id: string;
}

export function InviteCard({ members, membersError }: InviteCardProps) {
  const t = useTranslations('Team');
  const tCommon = useTranslations('Common');
  const time = useTimeFormats();
  const { profile, can } = useAuth();
  const { access } = useData();
  const { show } = useToast();
  const serverText = useServerText();
  const chainTitles = useChainTitles();

  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  /**
   * Which invitation, if any, is one tap from being deleted.
   *
   * One id rather than a set: arming a second row disarms the first, which is
   * the behaviour a half-finished confirmation should have.
   */
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The token in hand, if there is one. See `InviteLinkPanel`. */
  const [minted, setMinted] = useState<MintedLink | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

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

  // Read once at mount rather than on every render: it is the reader's own
  // note to themselves, and nothing else in the app writes the key.
  useEffect(() => setDismissed(readDismissedSkips()), []);

  /*
   * Core and up, which is the whole of this screen — the rules widened with
   * P4 so that Miriam can recruit her own nursery team without being made an
   * admin over everybody's access to a roster of minors.
   *
   * Three states, the same three the roster beside it has: `null` while the
   * first snapshot is in flight, a string when the read failed, and `[]` only
   * ever from a snapshot that actually arrived. The error callback used to
   * answer `[]`, which is not a record of a failure but a claim — a count
   * badge reading `0` and an empty state saying everybody invited had signed
   * in, on a dropped connection, about access to a roster of minors.
   */
  useEffect(
    () => subscribeInvitations(setInvitations, (cause) => setInvitationsError(cause.message)),
    [],
  );

  const uid = profile?.id ?? '';
  const isAdmin = can('admin');
  const byUid = useMemo(
    () => new Map((members ?? []).map((member) => [member.id, member])),
    [members],
  );

  /*
   * The three lists this card draws, cut from one subscription.
   *
   * Held at `null` until the roster arrives, because until then the screen
   * cannot say which address invitations are outstanding and a count is a
   * claim. A roster that failed outright is the one case they are listed
   * unfiltered — the card beside this one is already carrying that error, and
   * a list with a stale row in it is a better answer there than a card that
   * has gone silent about who may arrive.
   *
   * Compared on the canonical address rather than lowercased: an invitation
   * typed `josmith@gmail.com` is the profile that signed in as
   * `jo.smith@gmail.com`, and a plain `toLowerCase()` here would keep that
   * mailbox under "have not yet" for as long as the deployment lived.
   */
  const lists = useMemo(() => {
    if (!invitations || !(members || membersError)) return null;
    const signedIn = new Set((members ?? []).map((member) => canonicalEmail(member.email)));
    const since = Date.now() - ARRIVED_WINDOW_MS;

    const pending: Invitation[] = [];
    const arrived: Invitation[] = [];
    const outstanding: OutstandingSkip[] = [];

    for (const invitation of invitations) {
      if (invitation.resolvedAt) {
        if (invitation.resolvedAt.getTime() >= since) arrived.push(invitation);
        for (const chain of invitation.skipped ?? []) {
          /*
           * A skip that has since been fixed disappears on its own, because
           * "fixed" is a fact on the access document every phone can read —
           * whether it was fixed by Add now, by an admin, or by somebody at a
           * door three days later. Only the explicit Dismiss needs storage.
           */
          if (invitation.redeemedBy && access.get(chain)?.members.has(invitation.redeemedBy)) {
            continue;
          }
          outstanding.push({ invitation, chain, id: skipId(invitation.id, chain) });
        }
        continue;
      }
      if (invitation.email && signedIn.has(canonicalEmail(invitation.email))) continue;
      pending.push(invitation);
    }

    return {
      pending,
      arrived,
      outstanding: outstanding.filter((skip) => !dismissed.has(skip.id)),
    };
  }, [invitations, members, membersError, access, dismissed]);

  /** Who sent it, by name, for the "invited by" every row now carries. */
  const inviterName = (invitation: Invitation): string => {
    const inviter = invitation.invitedBy ? byUid.get(invitation.invitedBy) : undefined;
    if (inviter) return inviter.displayName || inviter.email;
    return t('someoneNoLongerHere');
  };

  const gatheringNames = (invitation: Invitation): string | null => {
    const named = (invitation.gatherings ?? [])
      .map((chain) => chainTitles.get(chain))
      .filter((title): title is string => title !== undefined);
    return named.length > 0 ? named.join(', ') : null;
  };

  /**
   * Puts a withdrawn invitation back, exactly as it was.
   *
   * The document id is derived from the address, so re-inviting writes the same
   * document the delete removed rather than a second one — which is what makes
   * an undo possible at all here. Role, note and gatherings are carried back
   * because an undo that returns somebody as a counselor they were not, on none
   * of the gatherings they were invited to, is not an undo. `invitedBy` is the
   * *original* inviter and not whoever pressed Undo: the field is write-once in
   * the rules precisely so that this restore can put back what was there.
   */
  const restoreInvitation = async (invitation: Invitation) => {
    if (!profile || !invitation.email) return;
    setBusyId(invitation.id);
    try {
      await inviteToTally(
        invitation.email,
        invitation.role,
        invitation.invitedBy ?? profile.id,
        invitation.note,
        invitation.gatherings ?? [],
      );
      show(t('invitedAgain', { email: invitation.email }), { tone: 'success' });
    } catch {
      show(t('restoreInviteFailed'), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const dropInvitation = async (invitation: Invitation) => {
    setBusyId(invitation.id);
    try {
      await withdrawInvitation(invitation.id);
      if (invitation.kind === 'link') {
        /*
         * No Undo on a link, and the toast says why rather than leaving a gap
         * where one usually is. Re-inviting an address rewrites the same
         * document; a link's token was shown once and is not in this browser
         * any more, so "putting it back" could only mean minting a different
         * link — which is the Create button, not an undo.
         */
        show(t('linkWithdrawn', { label: invitation.label ?? '' }), { tone: 'success' });
      } else {
        // The only way back from a `deleteDoc`. Without it the confirmation of
        // an irreversible act is the one toast in the app that offers nothing.
        show(t('withdrawn', { email: invitation.email ?? '' }), {
          tone: 'success',
          action: { label: tCommon('undo'), onPress: () => void restoreInvitation(invitation) },
        });
      }
    } catch (cause) {
      show(serverText(cause, t('withdrawInviteFailed')), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Extend, and QR: the same act with two lifetimes.
   *
   * Both mint a new token and retire the old one, so both end on the panel
   * that shows a token — anything else would leave somebody holding a row
   * whose link had just stopped working with no way to see the new one.
   */
  const remint = async (invitation: Invitation, life: InviteLife) => {
    setBusyId(invitation.id);
    try {
      const { data } = await refreshInvitationLink({ id: invitation.id, life });
      setMinted({ ...data, label: invitation.label ?? '', life });
    } catch (cause) {
      show(serverText(cause, t('extendFailed')), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const addToGathering = async (skip: OutstandingSkip) => {
    const who = skip.invitation.redeemedBy;
    if (!who || !profile) return;
    setBusyId(skip.id);
    try {
      await addChainMembers(skip.chain, [who], profile.id);
      show(
        t('addedToGathering', {
          name: skip.invitation.redeemedName || skip.invitation.redeemedEmail || '',
          gathering: chainTitles.get(skip.chain) ?? t('unknownGathering'),
        }),
        { tone: 'success' },
      );
    } catch (cause) {
      show(serverText(cause, t('addToGatheringFailed')), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const dismissSkip = (skip: OutstandingSkip) => {
    setDismissed((current) => {
      const next = new Set(current).add(skip.id);
      writeDismissedSkips(next);
      return next;
    });
  };

  /** Mirrors the delete rule in `firestore.rules`; it does not enforce it. */
  const mayWithdraw = (invitation: Invitation) =>
    invitation.resolvedAt === null &&
    (isAdmin || (invitation.invitedBy === uid && invitation.role === 'counselor'));

  /** Adding is allowed to anybody on the gathering; the proposal offers it to
      the ranks who can also be expected to know whether it should happen. */
  const mayAddTo = (chain: string) =>
    isAdmin || (can('core') && access.get(chain)?.members.has(uid) === true);

  const pendingCount = lists && !invitationsError ? lists.pending.length : null;

  return (
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
              {t('statusInvited')}
              {/* No number at all when the read failed: a stale count is the
                  same false claim the empty state used to make. */}
              {pendingCount !== null ? (
                <span className="rounded-full bg-ink-800 px-2 py-0.5 text-xs font-semibold text-ink-300">
                  {pendingCount}
                </span>
              ) : null}
            </h2>
            {/* Shut, the card would otherwise say nothing whatever when the
                read failed, beside a "＋ Invite someone" that reads as "nobody
                is waiting". The banner itself is inside the card. */}
            {invitationsError ? (
              <p className="mt-0.5 group-open:hidden lg:hidden">
                <Badge tone="danger">{t('invitesNotLoaded')}</Badge>
              </p>
            ) : null}
            <p className="mt-0.5 hidden text-sm text-ink-500 lg:block">{t('invitesDescription')}</p>
          </div>
          <span className="-mr-2 flex shrink-0 items-center lg:hidden">
            <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-brand-300 group-open:hidden">
              <span aria-hidden="true">＋</span>
              {t('inviteSomeone')}
            </span>
            <span className="hidden min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-ink-400 group-open:inline-flex">
              {tCommon('close')}
            </span>
          </span>
        </summary>

        {/* The token replaces the form rather than sitting under it. It is the
            only copy that will ever exist, and a form still on screen is an
            invitation to press Create again and lose it. */}
        {minted ? (
          <InviteLinkPanel minted={minted} onDismiss={() => setMinted(null)} />
        ) : (
          <InviteForm members={members} onMinted={setMinted} />
        )}

        {invitationsError ? (
          <div className="px-4 py-3">
            <ErrorBanner message={invitationsError} />
          </div>
        ) : !lists ? (
          <>
            <span role="status" className="sr-only">
              {t('loadingInvitations')}
            </span>
            <div aria-hidden="true">
              <SkeletonRows count={2} />
            </div>
          </>
        ) : (
          <>
            {lists.outstanding.length > 0 ? (
              <section aria-labelledby="team-outstanding">
                <h3
                  id="team-outstanding"
                  className="border-b border-ink-800 bg-warn-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-warn-300"
                >
                  {t('outstandingHeading')}
                </h3>
                <ul className="divide-y divide-ink-800">
                  {lists.outstanding.map((skip) => (
                    <li key={skip.id} className="flex flex-col gap-2 px-4 py-3">
                      <Identity
                        title={t('arrivedName', {
                          name:
                            skip.invitation.redeemedName ||
                            skip.invitation.redeemedEmail ||
                            skip.invitation.label ||
                            '',
                          when: skip.invitation.resolvedAt
                            ? time.weekdayDate(skip.invitation.resolvedAt)
                            : '',
                        })}
                        meta={
                          <p className="text-xs leading-snug text-warn-300">
                            {t('skipDetail', {
                              gathering: chainTitles.get(skip.chain) ?? t('unknownGathering'),
                              inviter: inviterName(skip.invitation),
                            })}
                          </p>
                        }
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {mayAddTo(skip.chain) ? (
                          <Button
                            variant="secondary"
                            loading={busyId === skip.id}
                            onClick={() => void addToGathering(skip)}
                          >
                            {t('addNow')}
                          </Button>
                        ) : (
                          <p className="text-xs text-ink-400">
                            {t('askSomebodyOnIt', {
                              gathering: chainTitles.get(skip.chain) ?? t('unknownGathering'),
                            })}
                          </p>
                        )}
                        <Button variant="ghost" onClick={() => dismissSkip(skip)}>
                          {tCommon('dismiss')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {lists.pending.length === 0 ? (
              <EmptyState title={t('invitesEmptyTitle')} description={t('invitesEmptyBody')} />
            ) : (
              <ul className="divide-y divide-ink-800">
                {lists.pending.map((invitation) => {
                  const link = invitation.kind === 'link';
                  const expired =
                    invitation.tokenExpiresAt !== null &&
                    invitation.tokenExpiresAt.getTime() < Date.now();
                  const gatherings = gatheringNames(invitation);

                  return (
                    <li
                      key={invitation.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:flex-col lg:items-stretch lg:gap-2"
                    >
                      <Identity
                        title={link ? (invitation.label ?? '') : (invitation.email ?? '')}
                        badge={
                          link ? <Badge tone="neutral">{t('linkBadge')}</Badge> : undefined
                        }
                        meta={
                          <div className="flex flex-col gap-0.5 text-xs text-ink-400">
                            {/* The granted role speaks the roster's vocabulary:
                                a pending Core team is an elevation, and it used
                                to hide in the grey. */}
                            <p className="flex flex-wrap items-center gap-1.5">
                              <RoleTag role={invitation.role} />
                              <span>·</span>
                              <span>{t('invitedBy', { name: inviterName(invitation) })}</span>
                              {invitation.invitedAt ? (
                                <span>· {time.relative(invitation.invitedAt)}</span>
                              ) : null}
                            </p>
                            {link && invitation.tokenExpiresAt ? (
                              <p className={expired ? 'text-warn-400' : undefined}>
                                {expired
                                  ? t('linkExpired', {
                                      when: time.weekdayDate(invitation.tokenExpiresAt),
                                    })
                                  : t('linkPending', {
                                      when: time.weekdayDate(invitation.tokenExpiresAt),
                                    })}
                              </p>
                            ) : null}
                            {gatherings ? <p>{t('putsThemOn', { gatherings })}</p> : null}
                          </div>
                        }
                      />

                      {/*
                        * The destructive control costs a second, red tap — the
                        * shape the event page already uses for calling off a
                        * gathering — and the toast that follows offers the way
                        * back. Withdrawing is a `deleteDoc`, and it used to
                        * wear `ghost`, the quietest variant in the system, and
                        * fire on one tap.
                        */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                        {link ? (
                          <>
                            <Button
                              variant="secondary"
                              loading={busyId === invitation.id}
                              onClick={() => void remint(invitation, 'link')}
                            >
                              {t('extend')}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busyId === invitation.id}
                              onClick={() => void remint(invitation, 'qr')}
                            >
                              {t('qr')}
                            </Button>
                          </>
                        ) : null}

                        {mayWithdraw(invitation) ? (
                          confirmingWithdrawal === invitation.id ? (
                            <div className="flex items-center gap-2">
                              <Button variant="ghost" onClick={() => setConfirmingWithdrawal(null)}>
                                {t('keepIt')}
                              </Button>
                              <Button
                                variant="danger"
                                loading={busyId === invitation.id}
                                onClick={() => {
                                  setConfirmingWithdrawal(null);
                                  void dropInvitation(invitation);
                                }}
                              >
                                {t('yesWithdraw')}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="secondary"
                              disabled={busyId === invitation.id}
                              onClick={() => setConfirmingWithdrawal(invitation.id)}
                            >
                              {t('withdraw')}
                            </Button>
                          )
                        ) : null}

                        {/* `basis-full` drops the consequence onto its own line
                            inside the same row rather than adding a wrapper the
                            three layouts would each have to be re-checked
                            against. Short, because in the tablet band the row is
                            shrink-to-fit and a long sentence sets its width. */}
                        {confirmingWithdrawal === invitation.id ? (
                          <p role="alert" className="basis-full text-xs text-ink-400">
                            {link ? t('withdrawLinkWarning') : t('withdrawWarning')}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Nothing at all when nobody has arrived this week: a heading over
                an empty list is a week that went wrong, said in chrome. */}
            {lists.arrived.length > 0 ? (
              <section aria-labelledby="team-arrived">
                <h3
                  id="team-arrived"
                  className="border-y border-ink-800 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400"
                >
                  {t('arrivedHeading')}
                </h3>
                <ul className="divide-y divide-ink-800">
                  {lists.arrived.map((invitation) => (
                    <li key={invitation.id} className="px-4 py-3">
                      <Identity
                        title={
                          invitation.label ?? invitation.email ?? invitation.redeemedEmail ?? ''
                        }
                        meta={
                          <p className="text-xs leading-snug text-ink-400">
                            {invitation.redeemedName && invitation.redeemedEmail
                              ? t('usedByNamed', {
                                  name: invitation.redeemedName,
                                  email: invitation.redeemedEmail,
                                  when: invitation.resolvedAt
                                    ? time.weekdayDate(invitation.resolvedAt)
                                    : '',
                                })
                              : t('usedBy', {
                                  who: invitation.redeemedEmail ?? t('somebody'),
                                  when: invitation.resolvedAt
                                    ? time.weekdayDate(invitation.resolvedAt)
                                    : '',
                                })}
                          </p>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </details>
    </Card>
  );
}
