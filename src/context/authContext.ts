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

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  profile: UserProfile | null;
  /** Set when a sign-in attempt failed; cleared on the next attempt. */
  error: string | null;
  /** True between requesting a magic link and the user leaving for their inbox. */
  magicLinkSentTo: string | null;

  sendMagicLink: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
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
