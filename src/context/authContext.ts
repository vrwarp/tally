import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import { seesAsRole, type Role, type UserProfile } from '@/types';

/**
 * `status` is the single thing screens branch on:
 *  - `loading`   — Firebase has not told us yet.
 *  - `signedOut` — show the login screen.
 *  - `pending`   — signed in, but no active `users/{uid}` document. An admin
 *                  has to approve them; they get a holding screen, not the app.
 *  - `ready`     — authenticated and authorised.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'pending' | 'ready';

/**
 * Which half of a `loading` status is outstanding.
 *
 * "Signing you in" is two waits wearing one spinner: Firebase resolving whether
 * there is a session at all, and then Firestore delivering the `users/{uid}`
 * document that says what this person may do. They fail for completely
 * different reasons and want completely different advice, and until now a stuck
 * app could not tell you which one it was — including in a test report.
 */
export type AuthStage = 'session' | 'profile' | null;

export interface AuthContextValue {
  status: AuthStatus;
  stage: AuthStage;
  user: User | null;
  profile: UserProfile | null;
  /** Set when a sign-in attempt failed; cleared on the next attempt. */
  error: string | null;

  /**
   * The only way in.
   *
   * Tally used to accept an email magic link as well, and for a while that was
   * the *primary* path — most counselors are handed a phone at the door. It is
   * gone: authorisation is keyed on an address, so what matters is that a
   * provider Tally trusts has confirmed the address belongs to the person, and
   * one door is easier to watch than two.
   */
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Re-read `users/{uid}` from the server and restart the live listener.
   *
   * For the one case the listener cannot cover: something else has just written
   * the document it is waiting for, and waiting is no longer the right answer.
   */
  refreshProfile: () => Promise<void>;
  clearError: () => void;
  /**
   * True when the signed-in user's role meets `required` — may *do* what it
   * does. A viewer meets no bar but its own. For whether a screen opens at all,
   * see `useCanSee`.
   */
  can: (required: Role) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}

/**
 * Whether the reader may *see* what `required` sees.
 *
 * `can` for everybody but a viewer, who opens every screen a core member opens
 * and none of an admin's — see `seesAsRole`. Derived from `can` and the profile
 * rather than carried on the context, so the one role that bends the ladder is
 * answered in one place.
 */
export function useCanSee(): (required: Role) => boolean {
  const value = useContext(AuthContext);
  return (required: Role) =>
    value !== null &&
    (value.can(required) ||
      (value.profile?.active === true && seesAsRole(value.profile.role, required)));
}

/**
 * True for a viewer: every control that writes is withheld, not refused.
 *
 * Read from the context directly rather than through `useAuth`, which throws
 * outside a provider: this is asked by leaf components — a button on a list, a
 * panel in a modal — that were written, and are tested, without one. No
 * provider is nobody signed in, which is nobody a control could be withheld
 * from; the rules decide the rest.
 */
export function useReadOnly(): boolean {
  const profile = useContext(AuthContext)?.profile;
  return profile?.active === true && profile.role === 'viewer';
}
