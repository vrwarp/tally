/**
 * The waiting shape of a call-list card, drawn inside the card it belongs to.
 *
 * The dashboard's lists cannot say who is on them until Planning Center
 * answers, but everything else about them — the card, its header, roughly what
 * a row costs — is known before any read starts. So a loading card keeps its
 * own header and swaps only its rows for these, and the answer landing swaps
 * them back *inside the same DOM*: nothing above or beside the card ever hears
 * about it. (The page used to swap whole skeleton cards for whole real ones,
 * which reads identically in JSX and very differently in a browser — a
 * different component type is a torn-down subtree, and the recompose moved
 * every card below it.)
 *
 * The rows here wear the real rows' skeleton: the same avatar size, the same
 * paddings, and the same reserved action line `FollowUpActions` keeps — so the
 * swap is a recolouring, give or take a few pixels, rather than a reflow.
 */
/** One line of a placeholder row: the real line's box, with a bar sitting in it. */
function PlaceholderLine({ box, bar, width }: { box: string; bar: string; width: string }) {
  return (
    <span className={`flex ${box} items-center`}>
      <span className={`${bar} ${width} max-w-full animate-pulse rounded bg-ink-800/60`} />
    </span>
  );
}

export function CallListLoadingRows({
  rows,
  /**
   * Lines of text the real row carries beside its avatar — two for a row that
   * says who and when, three where it also names the gathering somebody has
   * gone missing from. Passed rather than assumed because it is what decides
   * the row's height, and a placeholder row of the wrong height moves the card
   * below it by the difference × however many rows landed.
   */
  lines = 2,
}: {
  rows: number;
  lines?: 2 | 3;
}) {
  return (
    <ul aria-hidden="true" className="divide-y divide-ink-800">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="size-11 shrink-0 animate-pulse rounded-full bg-ink-800/60" />
            {/*
              Line boxes first, bars inside them.

              A row's height is the sum of its lines, and its lines are a
              `text-base` name over one or two of `text-xs` — 24px and 16px.
              Bars stacked with a gap came to the right *look* and the wrong
              height, and four pixels a row over eleven rows is half a card of
              drift in whatever sits underneath.
            */}
            <span className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
              <PlaceholderLine box="h-6" bar="h-3.5" width="w-40" />
              <PlaceholderLine box="h-4" bar="h-2.5" width="w-56" />
              {lines === 3 ? <PlaceholderLine box="h-4" bar="h-2.5" width="w-44" /> : null}
            </span>
          </div>
          {/* The line `FollowUpActions` reserves for itself, at the height its
              pills come to. See the note on its wrapper. */}
          <div className="mt-1 flex h-12 items-center pb-1 pl-14">
            <span className="h-5 w-44 max-w-full animate-pulse rounded bg-ink-800/60" />
          </div>
        </li>
      ))}
    </ul>
  );
}
