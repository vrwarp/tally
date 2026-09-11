/**
 * Two doors into the same act: letting one more adult sign in.
 *
 * The form used to be an address and a role, which assumed the inviter knew
 * which Google account the volunteer would use. Mostly they do not — it is a
 * personal Gmail, spelled a way nobody says out loud — and that assumption is
 * the whole of the failure the invite link removes (`docs/team-access.md`, P2).
 * So the link is the default door and the address is the second one, for the
 * case where the account really is known: the church's own Workspace address.
 *
 * The two doors share the gathering tick-boxes, and deliberately do not share
 * anything else. A link is a hand-off — it says who it is for, in the
 * inviter's words, because a row with no address on it has nothing else to be
 * recognised by — and it always grants counselor, whoever mints it, because a
 * link that leaks in a screenshot must not be able to open Settings.
 *
 * ## What a core member sees
 *
 * The same form with the role fixed, and a line saying so. Core may invite
 * counselors and nothing else (P4); a select whose only value is Counselor
 * would be a control that cannot be used, and no control at all leaves
 * somebody wondering what rank they just handed out.
 */
import { useState, type FormEvent } from 'react';
import {
  Button,
  CheckboxField,
  ErrorBanner,
  SelectField,
  TabBar,
  TextAreaField,
  TextField,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useToast } from '@/context/toastContext';
import { useServerText } from '@/hooks/useServerText';
import { ROLE_LABEL, ROLE_OPTIONS } from '@/features/team/Identity';
import { MAX_GATHERINGS, useInvitableGatherings } from '@/features/team/gatherings';
import type { MintedLink } from '@/features/team/InviteLinkPanel';
import { inviteToTally } from '@/services/access';
import { createInvitationLink } from '@/services/functions';
import { canonicalEmail, type Role, type UserProfile } from '@/types';
import { useTranslations } from 'use-intl';

/** As long as a label can be. Past this it stops naming and starts describing. */
const LABEL_MAX = 80;

type Door = 'link' | 'address';

export function InviteForm({
  members,
  onMinted,
}: {
  /** The signed-in team, for "Sam already has access". Null while it loads. */
  members: UserProfile[] | null;
  onMinted: (minted: MintedLink) => void;
}) {
  const t = useTranslations('Team');
  const tCommon = useTranslations('Common');
  const { profile, can } = useAuth();
  const { show } = useToast();
  const serverText = useServerText();
  const gatherings = useInvitableGatherings();
  const isAdmin = can('admin');

  const [door, setDoor] = useState<Door>('link');
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('counselor');
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * The person an address turned out to belong to.
   *
   * Kept as the profile rather than as a sentence, because the answer is a row
   * on the card beside this one and the useful next act is looking at it.
   */
  const [already, setAlready] = useState<UserProfile | null>(null);

  const toggle = (key: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_GATHERINGS) next.add(key);
      return next;
    });
  };

  const clear = () => {
    setChosen(new Set());
    setRefusal(null);
    setAlready(null);
  };

  const createLink = async () => {
    const named = label.trim();
    if (!named) return;
    setBusy(true);
    setRefusal(null);
    try {
      const { data } = await createInvitationLink({
        label: named,
        gatherings: [...chosen],
        life: 'link',
      });
      setLabel('');
      clear();
      onMinted({ ...data, label: named, life: 'link' });
    } catch (cause) {
      // Inline rather than a toast: "there are already twenty links waiting"
      // is answered by withdrawing one on the list below, which takes longer
      // than a toast lives.
      setRefusal(serverText(cause, t('createLinkFailed')));
    } finally {
      setBusy(false);
    }
  };

  const inviteAddress = async () => {
    const address = email.trim();
    if (!address || !profile) return;

    /*
     * An address that already has a profile is written nowhere.
     *
     * `inviteToTally` would happily create the invitation, and it would do
     * nothing at all: `provisionAccess` returns on the profile before it ever
     * reads an invitation. So the row would sit on this card forever claiming
     * somebody had not arrived who had. Saying whose account it is answers the
     * question actually being asked, which is "why can't Sam get in?".
     */
    const match = members?.find(
      (member) => canonicalEmail(member.email) === canonicalEmail(address),
    );
    if (match) {
      setAlready(match);
      return;
    }

    setBusy(true);
    setRefusal(null);
    try {
      await inviteToTally(address, role, profile.id, note.trim() || undefined, [...chosen]);
      setEmail('');
      setNote('');
      clear();
      show(t('canNowSignIn', { address }), { tone: 'success' });
    } catch (cause) {
      setRefusal(serverText(cause, t('saveInviteFailed')));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    void (door === 'link' ? createLink() : inviteAddress());
  };

  const atCap = chosen.size >= MAX_GATHERINGS;

  return (
    <form className="flex flex-col gap-3 border-b border-ink-800 px-4 py-3" onSubmit={submit}>
      <TabBar
        label={t('doorLabel')}
        options={[
          { id: 'link', label: t('doorLink') },
          { id: 'address', label: t('doorAddress') },
        ]}
        selected={door}
        onSelect={(next) => {
          setDoor(next as Door);
          setRefusal(null);
          setAlready(null);
        }}
      />

      {door === 'link' ? (
        <TextField
          label={t('linkFor')}
          value={label}
          maxLength={LABEL_MAX}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t('linkForPlaceholder')}
          hint={t('linkForHint')}
          required
        />
      ) : (
        <>
          <TextField
            label={t('googleAddress')}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="volunteer@example.org"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            hint={t('googleAddressHint')}
          />
          {isAdmin ? (
            <SelectField
              label={tCommon('role')}
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(ROLE_LABEL[option])}
                </option>
              ))}
            </SelectField>
          ) : (
            <p className="text-xs text-ink-400">{t('roleFixedToCounselor')}</p>
          )}
          <TextAreaField
            label={t('noteLabel')}
            value={note}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('notePlaceholder')}
          />
        </>
      )}

      {/* Under both doors, because "what is this person for" is the same
          question whichever way they were let in. */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink-200">{t('putThemOn')}</legend>
        {gatherings.length === 0 ? (
          <p className="text-xs leading-snug text-ink-400">{t('nothingNarrowed')}</p>
        ) : (
          <>
            {gatherings.map((gathering) => (
              <CheckboxField
                key={gathering.key}
                label={gathering.title}
                checked={chosen.has(gathering.key)}
                disabled={atCap && !chosen.has(gathering.key)}
                onChange={() => toggle(gathering.key)}
              />
            ))}
            {atCap ? <p className="text-xs text-warn-400">{t('gatheringsCapped')}</p> : null}
            {/*
              * What an untouched fieldset means, said before the press rather
              * than discovered on Sunday.
              *
              * This is a one-field form with a submit button, so the keyboard's
              * Go key mints the link — and on a phone the ticks sit at the
              * keyboard line with Create link underneath it. Pressing Go was
              * silent, and the volunteer found out the next weekend, standing
              * in front of a door reading "Nothing you're on today".
              */}
            {chosen.size === 0 ? (
              <p className="text-xs leading-snug text-ink-500">{t('nothingTicked')}</p>
            ) : null}
          </>
        )}
      </fieldset>

      {refusal ? <ErrorBanner message={refusal} /> : null}

      {already ? (
        <p role="status" className="text-sm leading-snug text-ink-300">
          {t('alreadyHasAccess', {
            name: already.displayName || already.email,
            role: t(ROLE_LABEL[already.role]),
          })}{' '}
          {/* The row itself, rather than a repeat of what it says: the next
              act is usually reading the rest of it — is the account even
              active? — and that is one card over. */}
          <a
            href={`#member-${already.id}`}
            className="font-semibold text-brand-300 underline underline-offset-4"
          >
            {t('showTheirRow')}
          </a>
        </p>
      ) : null}

      <Button
        type="submit"
        loading={busy}
        disabled={door === 'link' ? !label.trim() : !email.trim()}
      >
        {door === 'link' ? t('createLink') : t('invite')}
      </Button>
    </form>
  );
}
