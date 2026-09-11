/**
 * `/join/<token>` — what an invite link opens on.
 *
 * The one screen in Tally that a person with no account, no profile and no
 * business here yet is expected to reach, so it is built backwards from what
 * they are holding: a link somebody they know sent them, and a phone.
 *
 * Three decisions shape the whole file, and all three are P2's:
 *
 *  - **It says who and what for before it asks for anything.** `readInvitation`
 *    is unauthenticated on purpose. Being asked to sign in before being told
 *    what for is how a volunteer decides a link is phishing, and they are right
 *    to.
 *  - **It names the account before it spends the token.** A phone's chooser
 *    leads with whichever Google account it defaults to, and that is not always
 *    the one its owner meant. Without this step the link does not remove the
 *    wrong-account failure — it converts a loud refusal fixed in ten seconds
 *    into a silent grant to the wrong identity that only an admin can undo. So
 *    `redeemInvitation`, which spends the link, is reached from exactly one
 *    place: the Join button below.
 *  - **A dead link says which kind of dead it is, and who to ask.** Used,
 *    expired and never-existed are three different problems with three
 *    different next acts, and the inviter's name is the one thing the person
 *    holding a spent link can act on.
 *
 * Rendered outside `AuthGate` (see `App.tsx`), because everything about it has
 * to work signed out.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLocale, useTranslations } from 'use-intl';
import { useAuth } from '@/context/authContext';
import {
  readInvitation,
  redeemInvitation,
  type InvitationPreview,
  type ProvisionAccessResult,
} from '@/services/functions';
import { useServerText } from '@/hooks/useServerText';
import { GoogleMark } from '@/components/GoogleMark';
import { Button, ErrorBanner, LoadingScreen, Spinner } from '@/components/ui';
import { PlacementNotes } from '@/features/auth/placement';
import { forgetJoinToken, rememberJoinToken, rememberedJoinToken } from '@/features/auth/joinToken';

/** What a token is worth right now. The server's word, either call. */
type LinkStatus = 'ok' | 'expired' | 'spent' | 'not-found';

/**
 * What the server said the link opens. The callable's own shape, so the two
 * cannot drift — see `InvitationPreview` in `@/services/functions`.
 */
type Invitation = InvitationPreview;

type RedeemResult = ProvisionAccessResult & { linkStatus: LinkStatus };

/** A token that opens nothing, for the two cases that never reach the server. */
const NOTHING: Invitation = { status: 'not-found', invitedByName: null, gatherings: [] };

type Phase =
  | { kind: 'reading' }
  | { kind: 'readFailed'; message: string }
  | { kind: 'invitation'; invitation: Invitation }
  | { kind: 'joined'; invitation: Invitation; result: RedeemResult }
  | { kind: 'joinFailed'; invitation: Invitation; message: string };

export function JoinPage() {
  const t = useTranslations('Join');
  const tAuth = useTranslations('Auth');
  const tLogin = useTranslations('Login');
  const tErrors = useTranslations('Errors');
  const tAccount = useTranslations('Account');
  const locale = useLocale();
  const serverText = useServerText();
  const navigate = useNavigate();
  const { status, user, error: signInError, signInWithGoogle, signOut, refreshProfile } = useAuth();

  const { token: fromUrl } = useParams<{ token: string }>();
  /*
   * The URL where there is one, and what this tab wrote down where there is
   * not — see `joinToken.ts` for the round trips that lose the path. Read once
   * per mount: a token does not change under a mounted screen, and re-reading
   * storage on every render would let a clear-down half-way through the flow
   * pull the invitation out from under it.
   */
  const [token] = useState(() => fromUrl?.trim() || rememberedJoinToken());

  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });
  const [joining, setJoining] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  /** Set by "Use a different account", so the screen says why it came back. */
  const [switching, setSwitching] = useState(false);
  /* Which token has been looked up, so a re-render does not ask twice.
     `undefined` rather than null to start, because null is a real answer here
     — "there is no token" — and a null sentinel would swallow it. */
  const asked = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (token) rememberJoinToken(token);
  }, [token]);

  const read = useCallback(async () => {
    // No token at all: `/join` reached with nothing after it, in a tab that
    // never wrote one down. The server answers an empty token the same way, so
    // this is the same sentence without the round trip.
    if (!token) {
      setPhase({ kind: 'invitation', invitation: NOTHING });
      return;
    }

    setPhase({ kind: 'reading' });
    try {
      const response = await readInvitation({ token });
      setPhase({ kind: 'invitation', invitation: response.data });
    } catch (cause) {
      setPhase({ kind: 'readFailed', message: serverText(cause, t('readFailed')) });
    }
  }, [token, serverText, t]);

  useEffect(() => {
    if (asked.current === token) return;
    asked.current = token;
    void read();
  }, [read, token]);

  /*
   * Off to Google, having written the token down first.
   *
   * `signInWithGoogle` is a redirect in an installed app and in most in-app
   * browsers, which means the line after it may never run in this document —
   * everything that has to survive the trip is already stored by the effect
   * above.
   */
  const startSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch {
      /* Already surfaced through the provider's `error`. */
    } finally {
      setSigningIn(false);
    }
  };

  /*
   * Out, and back to this same screen with the chooser open next time.
   *
   * The refusal screen's version of this leaves for `/login`, which is right
   * there and wrong here: the invitation is what this person is holding, and
   * sending them to a generic sign-in form strands the link. Signing out drops
   * the page back to its signed-out state, where the button is; the sign-out is
   * what makes Google honour the provider's `select_account` rather than
   * silently re-using the session it has.
   */
  const switchAccount = async () => {
    setSwitching(true);
    await signOut();
  };

  const join = async (invitation: Invitation) => {
    if (!token || joining) return;
    setJoining(true);
    try {
      const response = await redeemInvitation({ token });
      const result = response.data;

      // Spent, and never worth offering again — including when the answer is
      // that somebody else got there first.
      forgetJoinToken();

      if (result.linkStatus !== 'ok') {
        /*
         * The link died between the read and the press: its life ran out while
         * the screen sat open, or it was redeemed on another phone. Told as the
         * same three screens a dead link gets on arrival, keeping the inviter's
         * name this screen already knows.
         */
        setPhase({
          kind: 'invitation',
          invitation: { ...invitation, status: result.linkStatus, gatherings: [] },
        });
        return;
      }

      setPhase({ kind: 'joined', invitation, result });

      /*
       * The profile exists now, and the listener in `AuthProvider` will notice
       * on its own — eventually. Asking directly is what makes "Open Tally"
       * land in the app rather than on the holding screen that would then ask
       * the server the same question again.
       */
      if (result.status === 'granted') void refreshProfile();
    } catch (cause) {
      setPhase({ kind: 'joinFailed', invitation, message: serverText(cause, t('joinFailed')) });
    } finally {
      setJoining(false);
    }
  };

  /** The invitation in one sentence, however much of it Tally knows. */
  const invitationLine = (invitation: Invitation): string => {
    /*
     * A one-off says which evening. The invitation screen is where somebody
     * decides whether the link is for them, and "the retreat" reads as the
     * whole of a thing that repeats — see `PlacementNotes`, which names them
     * the same way after the fact.
     */
    const gatherings = new Intl.ListFormat(locale, {
      style: 'long',
      type: 'conjunction',
    }).format(
      invitation.gatherings.map((gathering) =>
        gathering.oneOffAt === null
          ? gathering.title
          : tAuth('oneOffOnly', {
              title: gathering.title,
              date: new Date(gathering.oneOffAt).toLocaleDateString(locale, {
                month: 'short',
                day: 'numeric',
              }),
            }),
      ),
    );
    const name = invitation.invitedByName;

    if (name) {
      return invitation.gatherings.length > 0
        ? t('invitedByFor', { name, gatherings })
        : t('invitedBy', { name });
    }
    return invitation.gatherings.length > 0 ? t('invitedFor', { gatherings }) : t('invited');
  };

  /** Who to ask about a link that opens nothing. */
  const askLine = (invitation: Invitation): string =>
    invitation.invitedByName ? t('askByName', { name: invitation.invitedByName }) : t('ask');

  if (phase.kind === 'reading') return <LoadingScreen message={t('reading')} />;

  let eyebrow: ReactNode = null;
  /* Left unassigned so the compiler is the one insisting every branch below
     ends in something a person can read. */
  let title: string;
  let body: ReactNode;

  if (phase.kind === 'readFailed' || phase.kind === 'joinFailed') {
    title = tAuth('errorTitle');
    body = (
      <>
        <ErrorBanner message={phase.message} />
        <Button
          fullWidth
          onClick={() =>
            phase.kind === 'joinFailed' ? void join(phase.invitation) : void read()
          }
        >
          {tErrors('tryAgain')}
        </Button>
      </>
    );
  } else if (phase.kind === 'joined') {
    const { result, invitation } = phase;

    if (result.status === 'granted') {
      title = tAuth('grantedTitle');
      body = (
        <>
          {/* The address, said back to them: a volunteer who signed in with
              whichever account the phone offered has no other way to find out
              which one Tally now knows them by. */}
          <p className="text-sm text-ink-300">
            {t('doneAccount', { email: user?.email ?? '' })}
          </p>
          <PlacementNotes
            placed={result.placed}
            skipped={result.skipped}
            invitedByName={invitation.invitedByName}
          />
          <Button fullWidth onClick={() => navigate('/', { replace: true })}>
            {t('openTally')}
          </Button>
        </>
      );
    } else {
      // Suspended, and redeeming a link does not undo that — the same screen
      // the refusal path shows, because it is the same fact and the same way
      // back in.
      title = tAuth('inactiveTitle');
      body = (
        <>
          <p className="text-sm text-ink-300">{tAuth('inactiveBody')}</p>
          <p className="text-sm text-ink-500">{tAuth('inactiveHelp')}</p>
          <Button variant="ghost" fullWidth onClick={() => void signOut()}>
            {tAccount('signOut')}
          </Button>
        </>
      );
    }
  } else if (phase.invitation.status === 'ok') {
    const { invitation } = phase;

    if (status === 'loading') {
      title = invitationLine(invitation);
      body = (
        <div className="flex items-center gap-3 text-sm text-ink-400">
          <Spinner label={tAuth('checkingAria')} />
          <span>{tAuth('signingIn')}</span>
        </div>
      );
    } else if (status === 'signedOut') {
      title = invitationLine(invitation);
      body = (
        <>
          {signInError ? <ErrorBanner message={signInError} /> : null}
          {/* The reassurance is load-bearing rather than decorative: a
              volunteer's Tally account is their personal Gmail, and most of
              them do not know that is allowed. */}
          <p className="text-sm text-ink-300">{t('anyAccountHelp')}</p>
          {/* Google's own mark, and here it is doing most of the work: an
              unmarked "continue with Google" on a page you arrived at from a
              text message is exactly what a phishing page looks like. */}
          <Button
            size="lg"
            fullWidth
            loading={signingIn}
            leading={<GoogleMark />}
            onClick={() => void startSignIn()}
          >
            {t('continueWithGoogle')}
          </Button>
          {switching ? (
            <p className="text-center text-xs leading-relaxed text-ink-300">
              {tLogin('pickOtherAccount')}
            </p>
          ) : null}
        </>
      );
    } else {
      /*
       * Signed in, nothing spent yet. The invitation drops to a line above the
       * heading and the account becomes the question, because this is the one
       * moment the wrong account is still free to fix — and somebody who was
       * already signed in when they opened the link has not read the sentence
       * above until now.
       */
      eyebrow = <p className="mt-3 text-sm text-ink-400">{invitationLine(invitation)}</p>;
      title = t('confirmTitle', { email: user?.email ?? '' });
      body = (
        <>
          {signInError ? <ErrorBanner message={signInError} /> : null}
          <p className="text-sm text-ink-300">{t('confirmBody')}</p>
          <Button fullWidth loading={joining} onClick={() => void join(invitation)}>
            {t('join')}
          </Button>
          <Button
            variant="secondary"
            fullWidth
            disabled={joining}
            onClick={() => void switchAccount()}
          >
            {t('useDifferentAccount')}
          </Button>
        </>
      );
    }
  } else {
    const { invitation } = phase;
    // Already on the team, holding a link that has nothing left to give. The
    // door is the useful thing to offer; being told to ask for a new link is
    // not.
    const alreadyIn = status === 'ready';

    if (invitation.status === 'spent') {
      title = t('spentTitle');
      body = alreadyIn ? (
        <>
          <p className="text-sm text-ink-300">{t('spentAlreadyIn')}</p>
          <Button fullWidth onClick={() => navigate('/', { replace: true })}>
            {t('openTally')}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-300">{t('spentBody')}</p>
          <p className="text-sm text-ink-500">{askLine(invitation)}</p>
        </>
      );
    } else if (invitation.status === 'expired') {
      title = t('expiredTitle');
      body = (
        <>
          <p className="text-sm text-ink-300">{t('expiredBody')}</p>
          <p className="text-sm text-ink-500">{askLine(invitation)}</p>
        </>
      );
    } else {
      title = t('notFoundTitle');
      body = (
        <>
          <p className="text-sm text-ink-300">{t('notFoundBody')}</p>
          <p className="text-sm text-ink-500">{askLine(invitation)}</p>
        </>
      );
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-950 px-6 py-12 pt-safe pb-safe">
      <div className="w-full max-w-sm">
        <p className="text-sm font-bold uppercase tracking-widest text-brand-400">Tally</p>
        {eyebrow}
        <h1 className="mt-2 text-xl font-semibold text-ink-50">{title}</h1>
        {/* One node across every phase, so the outcome is announced rather than
            silently swapped underneath somebody. */}
        <div className="mt-5 flex flex-col gap-3" aria-live="polite">
          {body}
        </div>
      </div>
    </div>
  );
}
