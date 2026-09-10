/**
 * One mailbox, one key.
 *
 * Tally decides who may sign in by Google address, and every place it asks
 * "is this address already on the team" — the invitation's document id, the
 * sign-in lookup, the Team screen's pending filter, the pinned-admin match —
 * used to compare the address exactly, lowercased. Gmail does not: it ignores
 * dots in the local part, treats `+tag` as an alias of the same mailbox, and
 * answers to `googlemail.com` as well as `gmail.com`. Google's token carries
 * the address the way the account registered it, so `josmith@gmail.com` typed
 * on Tuesday failed `jo.smith@gmail.com` signing in on Sunday, and the screen
 * that refused them said the address was not on the team.
 *
 * That is a documented property of consumer Gmail and of nothing else. For
 * every other domain — Google Workspace included — dots are significant, and
 * a rule that merged them would merge two real staff. So the canonical form
 * touches only the two Gmail domains, and everywhere else is lowercased and
 * left alone.
 *
 * Shared with the functions through `scripts/sync-functions-shared.mjs`, so
 * the invitation an admin writes in the app is the one a sign-in looks up on
 * the server — `functions/src/pco/mapping.ts` re-exports the generated copy.
 */

/** The domains whose mailboxes ignore dots and `+tags`. Nothing else does. */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The address as the mailbox it names — readable, comparable, and the same for
 * every spelling Gmail accepts. `Jo.Smith+tally@googlemail.com` becomes
 * `josmith@gmail.com`; `Jo.Smith@church.org` becomes `jo.smith@church.org`.
 */
export function canonicalEmail(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf('@');
  if (at === -1) return lowered;

  const local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return lowered;

  const plus = local.indexOf('+');
  const mailbox = (plus === -1 ? local : local.slice(0, plus)).replace(/\./g, '');
  return `${mailbox}@gmail.com`;
}

/**
 * The `invitations/{emailKey}` document id.
 *
 * The canonical address, with dots turned to commas because the address is
 * the key and the key is a path segment.
 */
export function emailKey(email: string): string {
  return canonicalEmail(email).replace(/\./g, ',');
}

/** Whether two spellings name the same mailbox. */
export function sameAccount(a: string, b: string): boolean {
  return canonicalEmail(a) === canonicalEmail(b);
}
