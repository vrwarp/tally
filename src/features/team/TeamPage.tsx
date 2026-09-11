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
 *
 * ## What the screen grew afterwards
 *
 * **The list folds its leavers.** A suspended profile moves under a collapsed
 * *No longer on the team* at the foot of the card, in the same "Not yours"
 * idiom `LockedGatherings` uses on the chooser — so the working list is the
 * working team, and a departure is not memorialised at the top of a list every
 * core member reads. Nobody is ever deleted, and the reason is on the screen's
 * own disclosure: a deleted profile orphans the `checkedInBy` on every register
 * that person took, and — because nothing consumes an invitation — their next
 * sign-in would re-provision them from the stale one at whatever rank it
 * carries.
 *
 * **A find field sits over the list and searches the fold too, opening it on a
 * match.** The person a director most often looks for by name is the one who
 * left.
 *
 * **Ending access is armed; changing a role is not.** Suspension is the one act
 * here that takes something away from somebody who may be standing at a door,
 * so it costs a second tap over a sentence computed from what the app actually
 * knows — which gatherings they are on, and where they are the last person on
 * one. Un-suspending is armed for the mirror reason: membership survives
 * suspension by design, so one tap on a folded row would otherwise put a former
 * leader back on Nursery with nothing on screen saying so. A role change is
 * reversible in a tap and gets a toast with Undo instead.
 *
 * **A row opens rather than navigating.** Everything the app knows about a
 * person is a disclosure under their row — see `PersonPanel` — because the
 * journey it exists for is somebody standing in a nursery doorway holding a
 * list they still want when they are done.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  SkeletonRows,
  TextField,
} from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { Identity, ROLE_LABEL, ROLE_OPTIONS } from '@/features/team/Identity';
import { InviteCard } from '@/features/team/InviteCard';
import { PersonPanel } from '@/features/team/PersonPanel';
import { useChainTitles } from '@/features/team/gatherings';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { cn, createSearchMatcher } from '@/lib/utils';
import { listPinnedAdmins } from '@/services/functions';
import { setAccessActive, setRole, subscribeUsers } from '@/services/users';
import { canonicalEmail, type Role, type UserProfile } from '@/types';
import { useLocale, useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';

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
 * How many people there have to be before the screen offers to search them.
 *
 * A ministry of six is a list you read; the find field would be a control
 * taking a line off the first screen to answer a question nobody has. Eight is
 * about where a phone stops showing everybody at once.
 */
const FIND_FROM = 8;

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

/**
 * What ending — or giving back — somebody's access actually does, in one
 * sentence, computed from what the app already knows.
 *
 * The sentence is the whole of the arm step. A confirmation that says "are you
 * sure?" asks the reader to remember which gatherings Marcus works and whether
 * anybody else on Nursery can add a volunteer; this says it. Two facts earn
 * their place, and nothing else does:
 *
 * - **Which gatherings they are on**, because membership survives suspension by
 *   design and comes back untouched — which is exactly why un-suspending is
 *   armed as well. One tap on a folded row otherwise returns a former leader to
 *   Nursery in silence.
 * - **Where they are the last person on a narrowed list**, because that is the
 *   consequence nobody holds in their head: after this, only an admin can put
 *   anybody on that gathering.
 *
 * There is deliberately no kiosk clause. A kiosk holds its own identity now
 * (`kioskDevices`), so suspending whoever paired the lobby tablet stops
 * nothing, and the sentence that used to say otherwise was frightening people
 * out of a correct act.
 *
 * Written without "he" or "she": a display name has no gender, and guessing one
 * from it is wrong often enough to be worth never doing.
 */
function useConsequence(byUid: ReadonlyMap<string, UserProfile>) {
  const t = useTranslations('Team');
  const locale = useLocale();
  const { access } = useData();
  const titles = useChainTitles();

  return (member: UserProfile, active: boolean): string => {
    const name = member.displayName || member.email;
    const on: string[] = [];
    const sole: string[] = [];

    for (const list of access.values()) {
      if (!list.restricted || !list.members.has(member.id)) continue;
      const title = titles.get(list.id) ?? list.id;
      on.push(title);
      /*
       * "The only person left on it" counts the gathering's own list, which is
       * what the sentence claims and what a director reads — an admin passes
       * every fence whatever a list says, which is why the clause ends by
       * naming them rather than pretending the gathering becomes unreachable.
       * Suspended members are not a way in either, so they do not count.
       */
      const others = [...list.members].filter((uid) => {
        if (uid === member.id) return false;
        return byUid.get(uid)?.active === true;
      });
      if (others.length === 0) sole.push(title);
    }

    on.sort((a, b) => a.localeCompare(b));
    sole.sort((a, b) => a.localeCompare(b));
    const names = (list: string[]) =>
      new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(list);
    const role = t(ROLE_LABEL[member.role]);

    if (active) {
      return on.length > 0
        ? t('armRestoreOn', { name, role, gatherings: names(on) })
        : t('armRestore', { name, role });
    }

    const parts = [t('armSuspend', { name })];
    if (on.length > 0) parts.push(t('armSuspendOn', { gatherings: names(on) }));
    if (sole.length > 0) {
      parts.push(t('armSuspendSole', { count: sole.length, gatherings: names(sole) }));
    }
    return parts.join(' ');
  };
}

/** What the reader is being asked to confirm, and about whom. */
interface Armed {
  id: string;
  /** The state the confirming press would write. */
  active: boolean;
}

export function TeamPage() {
  const time = useTimeFormats();
  const t = useTranslations('Team');
  const tCommon = useTranslations('Common');
  const { profile, can } = useAuth();
  const { show } = useToast();

  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Which row, if any, is one press from having its access changed.
   *
   * One at a time, like the withdrawal on the invite card: arming a second row
   * disarms the first, which is the behaviour a half-finished confirmation
   * should have.
   */
  const [armed, setArmed] = useState<Armed | null>(null);
  /** Which person's facts are open. One at a time: this is a list, not a stack. */
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** Whether the reader has opened the fold themselves; see `foldOpen`. */
  const [foldChosen, setFoldChosen] = useState(false);

  useEffect(() => subscribeUsers(setUsers, (cause) => setUsersError(cause.message)), []);

  const byUid = useMemo(
    () => new Map((users ?? []).map((member) => [member.id, member])),
    [users],
  );
  const consequence = useConsequence(byUid);

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

  /**
   * Ends access, or gives it back, and offers the way out of either.
   *
   * `setAccessActive` rather than a whole-profile write: the stamps it leaves —
   * `accessEndedAt`, `accessEndedBy`, `accessRestoredAt` — are the record a
   * safeguarding question is asked of, and a merged `upsertUser` would have
   * been this screen deciding to rewrite a document it only meant to flip one
   * field of.
   *
   * The Undo is not the arm step's twin. The arm step is for the press that has
   * not happened; this is for the one that just did, from the phone that did
   * it, and it writes the mirror stamp rather than erasing the first — a
   * suspension that vanishes when it is lifted leaves a record saying the
   * person was never suspended.
   */
  const applyAccess = async (member: UserProfile, active: boolean, undoing = false) => {
    if (!profile) return;
    setArmed(null);
    setBusyId(member.id);
    const name = member.displayName || member.email;
    try {
      await setAccessActive(member.id, active, profile.id);
      show(t(active ? 'accessRestored' : 'accessEnded', { name }), {
        tone: 'success',
        // One step back, not a chain of them: an Undo of an Undo is the press
        // the reader just made, and offering it again invites a loop.
        ...(undoing
          ? {}
          : {
              action: {
                label: tCommon('undo'),
                onPress: () => void applyAccess(member, !active, true),
              },
            }),
      });
    } catch {
      show(t('saveChangeFailed'), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Changes what somebody may do, with no arm step and a way back.
   *
   * A role is reversible and takes nothing away that a second tap cannot
   * return, so making somebody confirm it would teach them to confirm without
   * reading — which is the one thing the suspension's arm step cannot afford.
   */
  const changeRole = async (member: UserProfile, role: Role, undoing = false) => {
    const previous = member.role;
    setBusyId(member.id);
    try {
      await setRole(member.id, role);
      show(
        t('roleChanged', {
          name: member.displayName || member.email,
          role: t(ROLE_LABEL[role]),
        }),
        {
          tone: 'success',
          ...(undoing
            ? {}
            : {
                action: {
                  label: tCommon('undo'),
                  onPress: () => void changeRole(member, previous, true),
                },
              }),
        },
      );
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

  /*
   * The working team, the people who have left, and the find field over both.
   *
   * Suspension is the only thing that moves a row into the fold, and it is a
   * fact about the front door rather than about the person — so the fold is a
   * second list of the same rows rather than a different kind of row: the
   * facts, the disclosure and the un-suspend live on it exactly as they do
   * above.
   *
   * The search runs over the name *and* the address, because the reader who
   * cannot remember how a name was spelled usually can remember the mailbox,
   * and `createSearchMatcher` forgives the four things anybody gets wrong
   * typing a name in a hurry.
   */
  const matcher = createSearchMatcher(query);
  const matches = (member: UserProfile) =>
    matcher.matches(`${member.displayName ?? ''} ${member.email}`);
  const working = ordered?.filter((member) => member.active && matches(member)) ?? null;
  const left = ordered?.filter((member) => !member.active && matches(member)) ?? [];

  /*
   * Open when there is nothing above it, and open on a match.
   *
   * Both halves are the same rule — a fold the reader cannot see past is a list
   * that has gone silent. The first is `LockedGatherings`'s: a section that
   * opens by itself precisely when the reader has chosen nothing. The second is
   * what makes the find field honest, since the name a director most often
   * searches for is the leaver's, and a search that returned nothing while the
   * answer sat folded underneath would be the screen lying.
   */
  const foldOpen =
    foldChosen || query.trim().length > 0 || (working !== null && working.length === 0);

  const columns = isAdmin ? COLUMNS_EDITABLE : COLUMNS_READ_ONLY;

  /**
   * One person's row, drawn the same in both lists.
   *
   * The fold below is the same rows under a different heading, not a different
   * kind of row: everything a leaver's row carries — the facts, the role, the
   * un-suspend — is what an active one carries, because the only difference
   * between the two lists is a boolean about the front door.
   */
  const memberRow = (member: UserProfile) => {
    const isSelf = member.id === profile?.id;
    const isPinned = isAdmin && pinned.emails.has(canonicalEmail(member.email));
    // A row whose controls are an explanation rather than a
    // select and a toggle: the admin's own, and one the
    // deployment pins. Neither can be changed from here, and each
    // says by whom.
    const explained = isAdmin && (isSelf || isPinned);
    const editable = isAdmin && !explained;
    const name = member.displayName || member.email;
    const open = openPerson === member.id;
    const panelId = `person-${member.id}`;

    /*
     * The name is the door, and the whole of it is the target.
     *
     * A separate chevron button beside the name would be a 20px target in a
     * lane that already holds a role select and the switch that ends somebody's
     * access — and the journey this opens is somebody on a phone in a doorway.
     * A button rather than a `<summary>` because the row carries two other
     * controls, and a `<details>` wrapped round them would make the select and
     * the toggle part of the thing that opens the panel.
     */
    const identity = (
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenPerson(open ? null : member.id)}
        className="-mx-2 flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-2 text-left hover:bg-ink-800/60 pointer-fine:min-h-9"
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block shrink-0 text-xs text-ink-500 transition-transform',
            open && 'rotate-90',
          )}
        >
          ▸
        </span>
        <Identity
          phrasing
          title={name}
          suffix={
            isSelf ? (
              <span className="shrink-0 text-xs font-normal text-ink-500">{t('you')}</span>
            ) : undefined
          }
          badge={!member.active ? <Badge tone="danger">{t('suspended')}</Badge> : undefined}
          meta={<span className="block truncate text-xs text-ink-400">{member.email}</span>}
        />
      </button>
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
          // `flex-wrap` is what lets the panel and the armed sentence take a
          // line of their own in the tablet band, where the row is a flex row
          // rather than a grid and `basis-full` would otherwise sit in it.
          editable && 'sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4',
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
              onChange={(changed) => void changeRole(member, changed.target.value as Role)}
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

            {/* The toggle arms rather than writes, so it goes on reading the
                truth — `checked` is what the profile says, not what the press
                asked for — while the sentence and the confirming press sit in
                the lane below. A switch that flipped first would be a change
                that has already happened wearing a question's clothes. */}
            <AccessToggle
              checked={member.active}
              disabled={busyId === member.id}
              label={t('maySignIn', { name })}
              onChange={(active) =>
                setArmed((current) =>
                  current?.id === member.id ? null : { id: member.id, active },
                )
              }
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

        {/*
          * The consequence, then the two presses — a lane of its own at every
          * width, because the sentence is the control here and a sentence that
          * sets a column's width is one nobody finishes reading.
          */}
        {armed?.id === member.id ? (
          <div className="w-full basis-full @2xl:col-span-full">
            <p role="alert" className="text-xs leading-snug text-ink-300">
              {consequence(member, armed.active)}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setArmed(null)}>
                {t('leaveItAsIs')}
              </Button>
              <Button
                variant={armed.active ? 'primary' : 'danger'}
                loading={busyId === member.id}
                onClick={() => void applyAccess(member, armed.active)}
              >
                {armed.active ? t('yesRestore') : t('yesEndAccess')}
              </Button>
            </div>
          </div>
        ) : null}

        {open ? (
          <div id={panelId} className="w-full basis-full @2xl:col-span-full">
            <PersonPanel member={member} byUid={byUid} />
          </div>
        ) : null}
      </li>
    );
  };

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
            // What the card is listing, which while somebody is typing is not
            // the same as how many profiles exist: a count over a filter has to
            // be a promise about what is under it, or it is worse than none.
            count={ordered ? (working?.length ?? 0) + left.length : undefined}
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

          {/*
            * Find by name, over both lists.
            *
            * Only once there are enough rows to lose somebody in — a search box
            * over five names is a control that costs a line of the first screen
            * and answers nothing. It searches the fold as well, and opens it on
            * a match, because the person a director most often looks for by
            * name is the one who left in June.
            */}
          {ordered && ordered.length > FIND_FROM ? (
            <div className="border-b border-ink-800 px-4 py-2">
              <TextField
                label={t('findLabel')}
                labelHidden
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t('findPlaceholder')}
                value={query}
                onChange={(changed) => setQuery(changed.target.value)}
                onClear={() => setQuery('')}
              />
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
            <>
              {working && working.length > 0 ? (
                <ul className="divide-y divide-ink-800">{working.map(memberRow)}</ul>
              ) : query.trim().length > 0 ? (
                /* A search that found nobody says so where the rows would have
                   been. The fold below opens itself on the same keystroke, so
                   this sentence is only ever the *whole* answer when the name
                   is on neither list. */
                <p className="px-4 py-6 text-center text-sm text-ink-400">
                  {t('noMatch', { query: query.trim() })}
                </p>
              ) : (
                /* Nothing at all when a ministry's whole roster has left: the
                   fold below is open, holds every row, and is the answer. A
                   sentence here would be the screen saying "nobody" over a list
                   of eleven people. */
                null
              )}

              {/*
                * The leavers, folded, in the app's "Not yours" idiom — the same
                * construction `LockedGatherings` uses on the chooser, down to
                * the caret being turned about the arrowhead's ink rather than
                * its em box, because `⌄` hangs low in its square and a plain
                * 180° flip visibly jumps when the section opens.
                *
                * There is no Delete here and there never will be. Deleting a
                * profile orphans the `checkedInBy` on every register that
                * person took — the attribution on a roster of minors — and
                * since nothing consumes an invitation, their next sign-in would
                * re-provision them from the stale one at whatever rank it
                * carries. The reason is on the screen's own disclosure rather
                * than in a tooltip nobody opens.
                */}
              {left.length > 0 ? (
                <section className="border-t border-ink-800 px-4">
                  <details
                    className="group"
                    open={foldOpen}
                    onToggle={(event) => setFoldChosen(event.currentTarget.open)}
                  >
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg text-xs font-bold uppercase tracking-wider text-ink-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500">
                      <span>{t('noLongerOnTeam', { count: left.length })}</span>
                      <span
                        aria-hidden
                        className="origin-[50%_69%] transition-transform group-open:rotate-180"
                      >
                        ⌄
                      </span>
                    </summary>
                    <ul className="-mx-4 divide-y divide-ink-800 border-t border-ink-800">
                      {left.map(memberRow)}
                    </ul>
                  </details>
                </section>
              ) : null}
            </>
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
