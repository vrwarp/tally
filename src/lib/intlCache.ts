/**
 * Cached `Intl` formatters, shared by everything that renders a date.
 *
 * `Intl.DateTimeFormat` is not cheap to construct and these run per row.
 *
 * Keyed on the locale and the option set, which between them are the whole of
 * a formatter's identity. Bounded by the handful of shapes the callers ask for
 * times the four locales, so there is no eviction to think about.
 *
 * Its own module, and a leaf one: it imports nothing from the app, on purpose.
 * The cache used to live in `time.ts`, which also needs `@/lib/materialize` and
 * `@/types`; `birthday.ts` wants the same cache and is itself a leaf whose only
 * import is one date-fns function. Exporting this from `time.ts` would have
 * dragged materialize into the import graph of every birthday consumer —
 * `birthdayField.ts`, `StudentsPage`, `StudentDetailPage`, `RowBadgeModal` —
 * and that weight lands on the check-in path, which is the last place to spend
 * bytes.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const hit = formatters.get(key);
  if (hit) return hit;
  const made = new Intl.DateTimeFormat(locale, options);
  formatters.set(key, made);
  return made;
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

/**
 * The same bargain for `Intl.RelativeTimeFormat`, keyed on the bare locale.
 *
 * There is no option set in the key because there is only one option set in the
 * app: `formatRelative` in `time.ts` is the sole place in the repo that asks for
 * a `RelativeTimeFormat`, and it always asks for `{ numeric: 'always' }`. So the
 * locale really is the whole of the identity here, and hashing a constant would
 * only cost a `JSON.stringify` on every row of the dashboard.
 *
 * If a second option set is ever introduced, the key must become
 * `${locale}|${JSON.stringify(options)}` to match `dateFormat` above. Leaving it
 * as the bare locale would hand the newcomer whichever formatter got there first
 * and quietly print the wrong words.
 */
export function relativeFormat(locale: string): Intl.RelativeTimeFormat {
  const hit = relativeFormatters.get(locale);
  if (hit) return hit;
  // Stryker disable next-line ObjectLiteral: `always` is also `Intl`'s own
  // default, so an emptied options object formats identically and no test can
  // tell the two apart. It is spelled out because the words depend on it — the
  // other value, `auto`, says "yesterday" where this says "1 day ago" — not
  // because it changes an answer today.
  const made = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  relativeFormatters.set(locale, made);
  return made;
}
