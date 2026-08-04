/**
 * The one normalization the kiosk's phone search rests on.
 *
 * Shared verbatim with the Cloud Functions (see scripts/sync-functions-shared.mjs):
 * the server builds the last-4 index with this, and the kiosk matches typed
 * digits against it. Two copies free to disagree would mean a parent typing
 * exactly the digits on file and matching nobody.
 *
 * Imports nothing, on purpose — that is the price of being shareable.
 */

/**
 * The last four digits of a phone number, or null when the value is not one.
 *
 * Anything with fewer than seven digits is refused rather than padded: an
 * extension, a "call the office" note, or a typo short of a real number would
 * otherwise index a student under four digits no parent would think to type.
 * A leading `1` on an eleven-digit number is the US country code and is
 * dropped before the length check only in the sense that it never changes the
 * last four anyway — the check exists to reject garbage, not to parse regions.
 */
export function phoneLast4(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length < 7) return null;
  return digits.slice(-4);
}

/** Every distinct last-4 among `values`, in first-seen order. */
export function phoneLast4Set(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const last4 = phoneLast4(value);
    if (last4) seen.add(last4);
  }
  return [...seen];
}

/** True when the search buffer is something the phone index can answer. */
export function isPhoneQuery(query: string): boolean {
  return /^\d+$/.test(query);
}
