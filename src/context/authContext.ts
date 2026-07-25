import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import type { Role, UserProfile } from '@/types';

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
  /** True between requesting a magic link and the user leaving for their inbox. */
  magicLinkSentTo: string | null;

  sendMagicLink: (email: string) => Promise<void>;
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
  /** True when the signed-in user's role meets `required`. */
  can: (required: Role) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
