/**
 * Which language this browser opens in, and where that answer is kept.
 *
 * `localStorage` is the runtime source of truth, exactly as the kiosk's roster
 * cache is: it is synchronous, so the first render already knows the answer and
 * nothing flashes English on its way to Chinese. `users/{uid}.locale` is the
 * durable copy — it is what makes the choice follow a counselor to a new phone
 * — and the two are reconciled once at sign-in.
 *
 * Reads never throw. A browser in private mode, or one with site data blocked,
 * answers `null` and gets the negotiated default; a language preference is not
 * worth a white screen.
 */
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, detectLocale, isLocale, type Locale } from '@/lib/locales';

export function readStoredLocale(key: string = LOCALE_STORAGE_KEY): Locale | null {
  try {
    const raw = localStorage.getItem(key);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale, key: string = LOCALE_STORAGE_KEY): void {
  try {
    localStorage.setItem(key, locale);
  } catch {
    // A preference that cannot be remembered is still worth honouring for this
    // session — the caller has already applied it to the running app.
  }
}

/** The language to open in: an explicit choice, else the browser's, else English. */
export function initialLocale(key: string = LOCALE_STORAGE_KEY): Locale {
  return readStoredLocale(key) ?? detectLocale();
}

/**
 * Sign-in reconciliation, mirroring Numbers' `syncLocalePreference`.
 *
 * A language explicitly chosen on *this* device wins and is pushed to the
 * account; otherwise the account's stored preference is copied down, so signing
 * in on a new phone restores the language you picked on the old one. Returns
 * what the caller should do, rather than doing it, so the Firestore write stays
 * with the code that owns the user document.
 */
export function reconcileLocale(
  stored: string | null | undefined,
): { apply: Locale; persistToAccount: Locale | null } {
  const local = readStoredLocale();
  if (local) {
    return { apply: local, persistToAccount: local === stored ? null : local };
  }
  if (isLocale(stored)) {
    writeStoredLocale(stored);
    return { apply: stored, persistToAccount: null };
  }
  return { apply: initialLocale(), persistToAccount: null };
}

export { DEFAULT_LOCALE };
