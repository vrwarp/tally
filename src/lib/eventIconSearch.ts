/**
 * Finding an icon in the picker, in whichever language the leader is reading.
 *
 * Its own module rather than a function in `eventIcons.ts`, because that file is
 * copied verbatim into the functions package by
 * `scripts/sync-functions-shared.mjs` — the server looks an icon up by name to
 * put its path data on a kiosk chooser row — and every module in that set must
 * import nothing. The Chinese search terms are an import, and the server has
 * never searched anything: it is handed a name and asked for a path.
 *
 * So the catalogue stays shared and import-free, and the searching lives here,
 * where only the app can reach it.
 */
import { EVENT_ICONS, type EventIconDef } from './eventIcons';
import { EVENT_ICON_TERMS } from './eventIconTerms';

/**
 * The catalogue, filtered by what somebody has typed.
 *
 * Matches on the label, the Material name and the keyword list, so "fire",
 * "campfire" and "local_fire_department" all reach the same icon. An empty
 * query is the whole catalogue in its curated order — grouped by the kind of
 * gathering it belongs to, which is more use than alphabetical when you are
 * browsing rather than searching.
 *
 * Five things are in the haystack and each is there for its own reason.
 *
 * The **reader's label** is the obvious one, and the reason this takes a
 * translator at all: a leader reading Chinese types the word they can see.
 * The **English label and keywords** stay in unconditionally — nothing gets
 * *worse* than it was, and a Chinese-speaking leader may well type "camp".
 * The **Chinese terms** (`eventIconTerms.ts`) and their pinyin come in for
 * everybody rather than only for a Chinese reader: an English screen costs
 * nothing to search in Chinese, and the branch that would save those bytes is
 * a branch that can be wrong. And the **Material name** is the paste path —
 * somebody arriving with `local_fire_department` from Google's own docs has to
 * find the icon it names, so it is never translated and never dropped.
 */
export function searchEventIcons(
  query: string,
  /**
   * The reader's word for an icon. Defaults to the English label, which is what
   * a test and the English screen both want, and what keeps this a pure
   * function of its arguments — see the pure-module pattern in
   * docs/agent/CONVENTIONS.md.
   */
  label: (icon: EventIconDef) => string = (icon) => icon.label,
): readonly EventIconDef[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return EVENT_ICONS;

  // Underscores are worth nothing to a search and everything to a paste: an
  // icon's Material name is the one string somebody might arrive with from
  // elsewhere, and `local_fire_department` has to find the icon it names.
  const words = needle.replace(/_/g, ' ').split(/\s+/);
  return EVENT_ICONS.filter((icon) => {
    const haystack = (
      `${label(icon)} ${icon.label} ${icon.name.replace(/_/g, ' ')} ` +
      `${icon.keywords} ${EVENT_ICON_TERMS[icon.name] ?? ''}`
    ).toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
