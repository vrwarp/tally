/**
 * A gathering's name, wearing its icon.
 *
 * One component rather than a glyph and a caller, because the mark and the name
 * are one object: the whole rule this feature settled on is *wherever the kiosk
 * names a gathering, the name wears its mark* — the lobby header, a chooser row,
 * the hold button, the staff menu and the question asked before unbinding.
 *
 * The path arrives on the chooser row already looked up and is persisted into
 * the binding, so this is handed a string and asked to draw it. See
 * `src/kiosk/icon.ts` for why the lookup is the server's job.
 *
 * **The mark is set in the line, not beside it.** It shipped as a 48px filled,
 * ringed tile and the first round of critique took that apart from four
 * directions at once. The fill was `ink-800` and the ring `ink-700`, which are
 * the exact tokens a result card, a keyboard key and a selected chooser row are
 * painted in: on a screen whose whole instruction is "tap the thing", the icon
 * was the one plate on the glass that did nothing. It was also the largest
 * object in the header, so an empty grey box out-ranked the gathering it was
 * decorating. It cost the header twenty pixels, which the landscape kiosk pays
 * for out of a results track already under three hundred — enough to push the
 * third name in the list into the fade. And when the title wrapped, the flex row
 * it sat in pushed it against the left padding while the name receded to the
 * middle of the screen, so the one thing an icon exists to say — *this mark
 * belongs to this gathering* — was what the layout stopped saying exactly when
 * the name got long. In the chooser the same tile billed sixty pixels of a
 * 390px phone to the *meta* line, which is the only line that tells two sittings
 * of one gathering apart.
 *
 * All of it is the same mistake: an icon laid out beside the text rather than
 * set in it. Inline and in `em` answers them together. It travels with the
 * title, is cap-height so it costs a header no height at all, scales with
 * whatever type it is dropped into so a `text-3xl` header and a `text-xl` row
 * need no separate sizes, and with no fill and no ring it is in nothing like
 * the material this device presses.
 *
 * **It does not hang, and that was argued for two rounds.** In a centred line
 * the mark's advance is all on one side of the words, so centring the line puts
 * the name about seven tenths of an em right of the axis the hours line under it
 * keeps. Hanging the mark in the margin fixes that exactly and costs more than
 * it fixes: a hung mark needs somewhere to hang, a centred block can only
 * reserve that room by giving up twice as much measure, and the measure comes
 * off *every* line of the title. Reserved, the longest name a church types went
 * from two lines to three on a phone and broke across "Middle School";
 * unreserved, the same name balanced onto one full-measure line and the mark
 * went off the glass and was sliced by the bezel. Both are worse than being off
 * centre. So a marked screen is the unmarked screen with a glyph in front of the
 * name — same height, same measure, same wrap.
 *
 * **The mark and the first word are one box.** An SVG is an atomic inline and a
 * line may break between an atomic inline and the text after it, so inside a
 * sentence the glyph wrapped to the end of one line and left the name opening
 * the next, unmarked — the tile's own failure, arrived at from the other
 * direction. A word joiner is the tidy answer and does not work: Chrome breaks
 * after the atomic inline regardless (measured, not assumed). `white-space:
 * nowrap` over the mark and the name's *first word* does, and it is deliberately
 * only the first word: a long gathering name inside a sentence still has to
 * wrap somewhere.
 *
 * Renders the name alone when a gathering has no icon, which is most of them.
 * That is the opposite of the main app's `EventIcon`, which draws a muted
 * calendar glyph so a list of rows keeps one left edge — the right answer for a
 * column of tiles, and the wrong one for a mark inside a line of text, where
 * absence is simply a line that starts with its first letter.
 *
 * The glyph is `aria-hidden`: the gathering is named in the very next word, so
 * a screen reader that announced it would read the same fact twice.
 */

export function EventName({
  path,
  title,
  tone = 'quiet',
}: {
  /** Path data on the `0 -960 960 960` viewBox, or nothing. */
  path: string | null | undefined;
  title: string;
  /**
   * `quiet` is a mark on a title, a step down from the words it begins.
   * `inherit` takes the colour of whatever it is set in, which is what a mark
   * inside a brand-filled button needs — there the surrounding ink is white and
   * a grey drawn on blue is neither.
   */
  tone?: 'quiet' | 'inherit';
}) {
  if (!path) return <>{title}</>;

  // The first word, and everything after it with its own leading space intact.
  const cut = title.indexOf(' ');
  const head = cut === -1 ? title : title.slice(0, cut);
  const tail = cut === -1 ? '' : title.slice(cut);

  return (
    <>
      <span className="whitespace-nowrap">
        <svg
          viewBox="0 -960 960 960"
          fill="currentColor"
          aria-hidden="true"
          /*
           * `1.05em` against a `-0.14em` baseline shift: Material draws these to
           * fill their box, so a glyph set at the font's own size reads a shade
           * larger than the capitals beside it and has to be dropped slightly to
           * share their baseline. `me-[0.4em]` is the word-space that follows —
           * both in `em` for the same reason the size is, so a mark dropped into
           * a `text-3xl` header and one dropped into a `text-xl` row are the
           * same design at two sizes rather than two designs.
           *
           * `ink-300` rather than the `ink-400` it wore for a round: a lobby
           * screen is read standing at arm's length, where a Material glyph's
           * one-pixel interior gaps are already at the limit of what an eye
           * resolves, and the one lever that buys legibility without buying
           * geometry is contrast. Still two steps below an `ink-100` title, so
           * it begins the name rather than competing with it.
           */
          className={`me-[0.4em] inline-block size-[1.05em] shrink-0 align-[-0.14em] ${
            tone === 'quiet' ? 'text-ink-300' : ''
          }`}
        >
          <path d={path} />
        </svg>
        {head}
      </span>
      {tail}
    </>
  );
}
