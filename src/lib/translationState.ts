/**
 * Shared helpers for the translation pipeline.
 *
 * `tests/messages.test.ts` and `scripts/translate-messages.ts` have to agree
 * exactly on how a catalogue is flattened and what counts as an ICU argument —
 * a disagreement there is a test that passes on a catalogue the script will
 * mangle. So both read the answers from here.
 *
 * Pure functions, no filesystem, no imports. The script runs under `tsx` with
 * no bundler and the test runs under vitest; this module has to work unchanged
 * in both.
 *
 * Ported from `vrwarp/numbers`, which solved this first.
 */

export type Messages = { [key: string]: string | Messages };

export type TranslationStatus = 'todo' | 'machine' | 'reviewed';

/**
 * One entry per key in `messages/translation-state.json`.
 *
 * `source` is the *verbatim English* the translations were made from, kept as
 * readable text rather than a hash so an entry is self-contained: the key, the
 * English, the translator's note and the per-locale review status all read
 * together in a diff. Staleness is then simply
 * `entry.source !== en.json's current value`, which is what makes "somebody
 * reworded an English string and forgot the Chinese" a test failure instead of
 * a bug report from a parent.
 */
export interface StateEntry {
  source: string;
  /**
   * A translator note: what the string is and where it appears.
   *
   * Fed verbatim into the drafting prompt, so the translator — model or human —
   * never has to guess. Required for anything short or ambiguous, which on this
   * app means most of it: "Held", "Clock", "One-off", "Core" and "Groups" are
   * all unresolvable from the word alone.
   */
  context?: string;
  'zh-Hans'?: TranslationStatus;
  'zh-Hant'?: TranslationStatus;
}

export type TranslationState = Record<string, StateEntry>;

/**
 * Cross-key wording dependencies, declared rather than remembered.
 *
 * Both kinds below are enforced by the parity test in *every* locale, and used
 * by the drafting script to order its work. Written down because the
 * alternative is a convention in somebody's head, and a convention in somebody's
 * head does not survive a translator drafting two keys in separate batches.
 */

/**
 * Keys that must render IDENTICALLY — the same UI element appearing in more
 * than one place.
 *
 * The first key in each group is canonical: it is the one actually translated,
 * and the script copies its value onto the rest. A group is the right tool when
 * the strings are the same *thing*, not merely the same words today.
 */
export const SAME_VALUE_GROUPS: readonly (readonly string[])[] = [
  /*
   * A nav label and the heading of the screen it opens are the same words about
   * the same thing, and a reader who taps 概覽 must land on a screen that says
   * 概覽. See docs/i18n.md Phase 2.
   */
  ['Dashboard.title', 'Nav.insights'],
  ['Team.title', 'Nav.team'],
  ['Settings.title', 'Nav.settings'],

  /*
   * The same thing said to the same reader from two places.
   *
   * Every group below already renders identically in all three catalogues —
   * pinning them costs no translation, it only stops them drifting apart. That
   * is worth doing because drift here is invisible: a reviewer editing a toast
   * on the dashboard has no way to know the student page raises the same toast,
   * and nothing goes red when only one of them moves. A copy audit found
   * fifty-two English strings living under two or three keys with nothing
   * holding them in step; these are the ones where that is a defect rather
   * than a coincidence.
   *
   * A control and the dialog it opens count as one thing for this purpose — a
   * button reading "Add a contact" must not open a sheet titled anything else.
   */
  ['Dashboard.releaseFailed', 'StudentDetail.releaseFailed'],
  ['Dashboard.undoFailed', 'StudentDetail.undoFailed'],
  ['Dashboard.historyError', 'StudentDetail.historyError'],
  ['ChooseEvent.ctaTakeAttendance', 'EventDetail.takeAttendance'],
  ['Errors.accessNotActive', 'Errors.auth.notActive'],
  ['Auth.installedAppDeadEnd', 'Login.googleUnavailable'],
  ['Access.hintRestricted', 'Events.lockedRestricted'],
  ['EventDetail.backOn', 'Events.backOn'],
  ['StudentDetail.backOnRoster', 'AddStudent.backOnRoster'],
  ['StudentDetail.noGradeIn', 'AddStudent.noGradeIn'],
  ['StudentDetail.changeItThere', 'StudentEditor.changeItThere'],
  ['QuickAdd.adultFirst', 'ParentContact.adultFirstName'],
  ['QuickAdd.addContact', 'ParentContact.addAContact'],
  ['CheckIn.searchPlaceholder', 'Rsvp.searchPlaceholder'],
  ['CheckIn.searchAria', 'Rsvp.searchAria'],
  ['CheckIn.emptyNoRsvp', 'Rsvp.emptyTitle'],
  ['CheckIn.announceAdded', 'QuickAdd.added'],
  ['Settings.saveFailed', 'Backends.editorSaveFailed'],
  ['Staff.reprint', 'Printer.reprint'],
  ['Staff.labelPrinter', 'Printer.title'],
  ['Search.opensWhen', 'Chooser.opensAt'],
  ['FollowUp.theContactOnFile', 'StudentDetail.theContactOnFile'],
  ['Mia.noLongerExpectedHere', 'StudentDetail.noLongerExpectedHere'],
  ['Warnings.incompleteLabel', 'NewVisitors.badgeIncompleteTitle', 'StudentDetail.noContactOnFile'],
  ['CheckIn.formerStudent', 'Rsvp.formerStudent', 'EventDetail.formerStudent'],
  ['EventDetail.badgeCheckInOpen', 'EventHero.checkInOpen', 'Chooser.checkInOpen'],
  ['Dashboard.noGatherings', 'Dashboard.emptyTitle', 'StudentDetail.noGatheringsTitle'],
  ['Incomplete.title', 'Students.incompleteProfiles'],
  ['AddStudent.titleMulti', 'StudentEditor.titleAdd'],
  ['Students.addFromPco', 'AddStudent.titlePco'],
  ['FollowUp.addContact', 'ParentContact.modalTitle'],
];

/**
 * Identical in English on purpose, and deliberately NOT pinned.
 *
 * Written down because the list above invites a tidying instinct, and these are
 * exactly the pairs that instinct would ruin. Two kinds:
 *
 * **Different readers.** `Auth.errorTitle` is read by a counselor and
 * `Register.titleError` by a family at the lobby kiosk, and both are "Something
 * went wrong" today — but the kiosk addresses a parent as 您 and the staff app
 * says 你, so pinning them would force one register on both audiences. Same for
 * `Confirm.anotherChild` / `Register.titleAnotherChild`.
 *
 * **Coincidence.** `Recurrence.monthlyOn` is a summary sentence and
 * `monthlyOnWeekdayOption` is a `<select>` option; Chinese may reasonably want
 * a shorter form inside a dropdown. Likewise `Incomplete.metaWithGrade` /
 * `OneOff.metaWithGrade`, `DangerZone.consequenceCheckIns` /
 * `Import.checkInCount`, `Staff.nameCount` / `Search.matchCount`,
 * `LabelTemplate.sampleEvent` / `KioskTheme.previewTitle` (both sample data),
 * and the bare format strings `Events.when` / `EventHero.whenDayWindow` /
 * `PastGatherings.when`.
 */
export const DELIBERATELY_UNPINNED = [
  ['Auth.errorTitle', 'Register.titleError'],
  ['Confirm.anotherChild', 'Register.titleAnotherChild'],
  ['Recurrence.monthlyOn', 'Recurrence.monthlyOnWeekdayOption'],
  ['Incomplete.metaWithGrade', 'OneOff.metaWithGrade'],
  ['DangerZone.consequenceCheckIns', 'Import.checkInCount'],
  ['Staff.nameCount', 'Search.matchCount'],
  ['LabelTemplate.sampleEvent', 'KioskTheme.previewTitle'],
] as const;

/**
 * Messages that quote another UI element's wording inside a sentence.
 *
 * The quoted key's value — minus `strip`, for a leading emoji or icon that the
 * prose does not speak — must appear verbatim inside the message, in every
 * locale. An empty-state that says *Use "New event" above* has to keep saying
 * whatever that button currently says, in whatever language it says it.
 */
export const QUOTED_IN: readonly { message: string; quotes: string; strip?: string }[] = [
  // The events empty state tells a leader to press a button by name, so it has
  // to keep saying whatever that button currently says.
  { message: 'Events.emptyBody', quotes: 'Events.newEvent' },
];

/**
 * Keys whose translation must carry a particular word, per locale.
 *
 * The third kind of cross-key dependency, and the odd one out: the other two
 * tie a key to another key, and this ties a key to a *fact about the device*.
 *
 * It exists for the registration wizard's name questions. The kiosk keyboard is
 * one static QWERTY layout and the kiosk never focuses a focusable element —
 * that is what lets it avoid the device's slow native keyboard — so there is no
 * IME on the glass, and a parent cannot type 蔡秉洲 into it however the question
 * is worded. English is not a preference there, it is the only thing the
 * keyboard can produce, so the Chinese question has to say 英文 and the English
 * one has nothing to warn about. Naming the constraint is also what answers it:
 * a field labelled 英文名字 is asking for exactly what the keys under it make.
 *
 * `text` constrains the *fact*, not the phrasing — 英文名字 and 英文名 both
 * satisfy it — and a locale left out is unconstrained. Enforced by the parity
 * test once a translation exists, and fed to the drafting script as a
 * `mustContain`, which rejects a draft that drops it rather than shipping one.
 */
export const REQUIRED_WORDING: readonly {
  key: string;
  text: Readonly<Record<string, string>>;
  why: string;
}[] = (
  [
    'Register.labelFirstName',
    'Register.labelLastName',
    'Register.placeholderChildFirst',
    'Register.placeholderChildLast',
    'Register.placeholderYourFirst',
    'Register.placeholderYourLast',
  ] as const
).map((key) => ({
  key,
  text: { 'zh-Hans': '英文', 'zh-Hant': '英文' },
  why: 'The kiosk keyboard is Latin-only, so this name can only be typed in English.',
}));

export function flatten(obj: Messages, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(full, value);
    else for (const [k, v] of flatten(value, full)) out.set(k, v);
  }
  return out;
}

/** Rebuild the nested catalogue shape from a flat map, following en's key order. */
export function unflatten(flat: Map<string, string>, order: readonly string[]): Messages {
  const out: Messages = {};
  for (const key of order) {
    const value = flat.get(key);
    if (value === undefined) continue;
    const parts = key.split('.');
    let node = out;
    for (const part of parts.slice(0, -1)) {
      node = (node[part] ??= {}) as Messages;
    }
    node[parts[parts.length - 1]!] = value;
  }
  return out;
}

/**
 * The ICU arguments and rich-text tags a message carries.
 *
 * `{count}`, `{count, plural, …}` and `<link>` all have to survive translation
 * intact — a dropped argument renders the raw placeholder on a screen, and a
 * dropped tag throws. Sorted so two messages can be compared by deep equality
 * regardless of the order the translator happened to write them in.
 *
 * A plural or select *branch body* is not an argument, and telling the two
 * apart is why this walks the string rather than matching it. `{count, plural,
 * one {gathering} other {gatherings}}` reads to a regexp as three arguments,
 * two of which are English words — which made every message shaped like that
 * untranslatable, because no correct Chinese carries a literal `{gatherings}`.
 * A branch body is still a message, though, so a real argument inside one is
 * found: `one {# of {total}}` carries `{total}`.
 */
const IDENTIFIER = /^[a-zA-Z0-9_]+$/;
const SUBMESSAGE = /(?:plural|selectordinal|select)\s*,/y;

/** The index just past the `}` matching the `{` at `open`, or -1. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * The branches of a `plural`/`select`, each of which is a message in its own
 * right — `one {…} other {…}` — read for the arguments inside them.
 */
function collectBranches(text: string, into: Set<string>): void {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue;
    const end = closingBrace(text, index);
    if (end === -1) return;
    collectArguments(text.slice(index + 1, end), into);
    index = end;
  }
}

function collectArguments(text: string, into: Set<string>): void {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue;
    const end = closingBrace(text, index);
    if (end === -1) return;

    const inner = text.slice(index + 1, end);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    if (IDENTIFIER.test(name)) {
      into.add(`{${name}}`);
      if (comma !== -1) {
        const rest = inner.slice(comma + 1);
        const offset = rest.length - rest.trimStart().length;
        SUBMESSAGE.lastIndex = offset;
        const kind = SUBMESSAGE.exec(rest);
        if (kind) collectBranches(rest.slice(SUBMESSAGE.lastIndex), into);
      }
    }
    index = end;
  }
}

export function messageArguments(message: string): string[] {
  const args = new Set<string>();
  collectArguments(message, args);
  for (const m of message.matchAll(/<([a-z][a-zA-Z0-9]*)>/g)) args.add(`<${m[1]}>`);
  return [...args].sort();
}
