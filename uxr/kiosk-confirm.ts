/**
 * The kiosk confirm screen, as a static prototype the critique loop can shoot.
 *
 * The rest of `uxr/prototype` is frozen HTML lifted out of the running app.
 * That does not work for the kiosk: it is a separate entry with its own
 * stylesheet, and the screen under review only exists after a search and a tap.
 * So this generates it instead, from the same token values `src/index.css`
 * defines and the same Tailwind measurements `ConfirmScreen.tsx` uses — the
 * critics are judging pixels, and these are the pixels.
 *
 * Two scenes, because the change under review must not break the one that
 * already works:
 *
 *   - **alone** — the kiosk found no brothers or sisters. This is the frame in
 *     the bug report: one name, one button, and the way to a sibling reduced to
 *     a line of grey text under the commit.
 *   - **family** — the kiosk found one, ticked. The "who else" question is
 *     already loud here, which is exactly why its absence in the other scene is
 *     the defect.
 *
 *   npx tsx uxr/kiosk-confirm.ts [variant]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Its own directory: `uxr/shoot.ts` takes a folder, and the app prototypes
 * there are hand-edited by the ideator rather than generated. */
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'prototype-kiosk');

/** Straight from `src/index.css`, dark theme — the kiosk pins it. */
const TOKENS = `
  --ink-50:#f8fafc; --ink-100:#f1f5f9; --ink-200:#e2e8f0; --ink-300:#cbd5e1;
  --ink-400:#94a3b8; --ink-500:#64748b; --ink-600:#475569; --ink-700:#334155;
  --ink-800:#1e293b; --ink-900:#0f172a; --ink-950:#020617;
  --brand-300:#7dd3fc; --brand-400:#38bdf8; --brand-500:#0ea5e9; --brand-600:#0284c7;
  --present-400:#4ade80; --present-500:#22c55e; --present-600:#16a34a;
`;

const CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  :root { ${TOKENS} }
  html, body { height: 100%; margin: 0; }
  /* The band has to be centred by something that can centre it — "margin: auto"
     on a block-level box in normal flow computes its vertical margins to zero,
     so r3's 820px band was pinned to the top of a 1280px kiosk and the commit
     landed at 49% of the glass rather than the 72% its own note claimed. */
  body { display: flex; align-items: center; }
  body {
    background: var(--ink-950);
    color: var(--ink-100);
    -webkit-font-smoothing: antialiased;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
  }
  button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; }

  /* The frame ConfirmScreen renders: centred column, 2rem gaps, 2rem padding. */
  .screen {
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 2rem; padding: 2rem; text-align: center;
  }
  .who { flex-shrink: 0; }
  .who .name { font-size: 3rem; line-height: 1; font-weight: 700; color: var(--ink-50); }
  .who .grade { padding-top: 0.75rem; font-size: 1.5rem; line-height: 2rem; color: var(--ink-400); }

  /* The ticked-sibling list. */
  .family { display: flex; min-height: 0; width: 100%; max-width: 28rem; flex-direction: column; }
  .family .ask { flex-shrink: 0; padding-bottom: 0.75rem; font-size: 1.125rem; line-height: 1.75rem; color: var(--ink-400); }
  .family .rows { display: flex; min-height: 0; flex-direction: column; gap: 0.5rem; }
  .row {
    display: flex; height: 4rem; flex-shrink: 0; align-items: center;
    justify-content: space-between; border-radius: 0.75rem; padding: 0 1.25rem;
    text-align: left; background: var(--ink-800);
  }
  .row .rname { font-size: 1.25rem; line-height: 1.75rem; font-weight: 600; color: var(--ink-100); }
  .row .tick {
    margin-left: 0.75rem; display: flex; height: 2.25rem; width: 2.25rem; flex-shrink: 0;
    align-items: center; justify-content: center; border-radius: 0.5rem;
    font-size: 1.25rem; background: var(--present-600); color: #fff;
  }

  /* The commit. */
  .commit {
    width: 100%; max-width: 28rem; flex-shrink: 0; border-radius: 1rem;
    padding: 1.75rem; font-size: 1.875rem; line-height: 2.25rem; font-weight: 700;
    background: var(--present-600); color: #fff;
  }

  /* What the loop is arguing about. */
  .sibling-link {
    flex-shrink: 0; border-radius: 0.75rem; padding: 1rem 2rem;
    font-size: 1.25rem; line-height: 1.75rem; color: var(--ink-400);
  }
  .sibling-btn {
    display: flex; width: 100%; max-width: 28rem; flex-shrink: 0;
    align-items: center; justify-content: center; gap: 0.625rem;
    border-radius: 1rem; padding: 1.25rem; font-size: 1.5rem; line-height: 2rem;
    font-weight: 600; background: var(--ink-800); color: var(--ink-100);
  }
  .sibling-btn.tinted {
    background: color-mix(in oklab, var(--brand-600) 15%, transparent);
    color: var(--brand-300);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--brand-500) 40%, transparent);
  }
  .sibling-btn .plus { font-size: 1.75rem; line-height: 1; font-weight: 400; }

  .back { flex-shrink: 0; border-radius: 0.75rem; padding: 1rem 2rem; font-size: 1.25rem; color: var(--ink-400); }

  /* ---- r1: one slot for the question, above the commit -------------------- */

  /*
   * The screen stops composing by a uniform box gap. Both critics measured the
   * same thing: a uniform box gap plus each element's own padding produced 14/35/54/75px
   * of *visible* air down the column, a ramp that grouped nothing and put the
   * biggest void around the least important control. These are ink gaps, set
   * per boundary, budgeting for the line-box slack the box gap was hiding.
   */
  .screen.r1 { gap: 0; justify-content: center; }
  .screen.r1 .who { margin-bottom: 2.5rem; }
  /* 48px of clear page either side of the commit. The expensive mis-tap is
     always *toward* green — it commits a child and the kiosk has no undo — so
     the boundary that needs the clearance is the one above it, not the one
     below. The region holds together on its own internal tightness instead. */
  .screen.r1 .whoelse { margin-bottom: 3rem; }
  .screen.r1 .commit { margin-bottom: 3.5rem; }

  .whoelse { display: flex; width: 100%; max-width: 28rem; flex-direction: column; gap: 0.5rem; }
  /* Left, at the rows' own text inset — a caption centred 90px inside the list
     it heads is the one alignment on the screen that is neither deliberate
     centring nor deliberate alignment. */
  .whoelse .ask {
    padding: 0 1.25rem 0.25rem; text-align: left;
    font-size: 1.125rem; line-height: 1.75rem; color: var(--ink-400);
  }

  /*
   * The affordance, as the last row of the list rather than a caption under
   * the button. Same 448x64 geometry as a sibling row, so the region reads as
   * "the people you can add, ending with the way to add one more".
   *
   * Brand tint rather than ink-800: the sibling rows are already ink-800 at
   * this width, so an ink fill here would be a second identical slab, and
   * brand is already this app's colour for the other door.
   */
  .addrow {
    display: flex; height: 4rem; flex-shrink: 0; align-items: center;
    gap: 0.625rem; border-radius: 0.75rem; padding: 0 1.25rem; text-align: left;
    font-size: 1.25rem; line-height: 1.75rem; font-weight: 600;
    background: color-mix(in oklab, var(--brand-600) 32%, transparent);
    color: var(--brand-300);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--brand-500) 40%, transparent);
  }
  /* Inline and the same size as the words: a 36px badge would collide with the
     tick chips that mark row *state* on the opposite edge. */
  .addrow .plus { font-weight: 400; }

  /* ---- r2 ---------------------------------------------------------------- */

  /*
   * 32px from the identity to the region, measured ink to ink rather than box
   * to box. r1 asked for 40 and rendered 43-49 once the ask's line-box slack
   * and the grade's descender had been paid, which put the region equidistant
   * between the name and the commit and therefore in neither group -- leaving
   * "another" with no visible antecedent. The column now ramps 14 / 32 / 48 /
   * 76, and the 76 before the exit is a decision rather than an accident.
   */
  .screen.r2 { gap: 0; justify-content: center; }
  .screen.r2 .who { margin-bottom: 2rem; }
  .screen.r2 .whoelse { margin-bottom: 3rem; }
  .screen.r2 .commit { margin-bottom: 2.25rem; }

  /*
   * The scroller, restored. r1 flattened the region and deleted the
   * "min-h-0 overflow-y-auto" the real component carries -- whose own comment
   * says it "is what lets it shrink instead of pushing the button off a short
   * screen". Without it, five siblings on the landscape kiosk push the child's
   * name off the top of the glass, which is the one thing on this screen the
   * parent is being asked to check. The names scroll; the way to add one does
   * not, so it is reachable however long the list gets.
   */
  /* "min-height: 0" on the region as well as the list: a flex item defaults to
     "min-height: auto", which refuses to shrink below its content, so a
     scroller nested inside one that has not been told otherwise never
     engages — the column simply overflows the glass instead. */
  .whoelse { min-height: 0; }
  /*
   * The list is the only element allowed to absorb variation, so it is the only
   * one that may shrink: the question and the way to add a child hold their
   * intrinsic height, and the names scroll. Without that the region overflowed
   * its track and rode the add-row down *under* the commit — two doors to
   * different places fused into one band of ink, in the one scene where the
   * commit is most expensive.
   */
  .rows {
    display: flex; flex-direction: column; gap: 0.5rem;
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
  }
  .whoelse .ask, .whoelse .addrow { flex-shrink: 0; }
  .ask { font-size: 1.25rem; line-height: 1.75rem; }

  /*
   * A heavier wash. r1 borrowed the search screen's standing-offer recipe,
   * which was tuned for a pill about a sixth of this area: at 15% the fill read
   * 1.14:1 against the page -- fainter than the ink-800 sibling row it is meant
   * to stand beside as an equal -- so the box existed on its 1px ring alone. At
   * 32% it clears the sibling row and is still four times quieter than the
   * commit, which is the ordering this screen wants.
   */
  .addrow { justify-content: flex-start; gap: 0; }
  /*
   * A gutter the whole region shares, rather than a glyph hung off the front of
   * one row.
   *
   * Inline, a 13px light plus could not hold an edge against a 20px semibold
   * cap, so the label read as indented from its own list. Hung outside the
   * padding it sat flush against the box edge and read as cramped. Given a
   * column of its own -- empty on the rows that name a person, occupied on the
   * row that adds one -- every line in the region starts on the same x, and
   * the plus is a mark in a gutter instead of a word competing with words.
   */
  .row, .addrow { padding-left: 3rem; }
  .addrow .plus {
    width: 1.75rem; margin-left: -1.75rem; flex-shrink: 0; text-align: left;
  }
  .addrow .go { margin-left: auto; font-weight: 400; opacity: 0.8; }
  /* ---- r3 ---------------------------------------------------------------- */

  /*
   * The commit stops moving.
   *
   * Across the one transition this feature exists to produce -- alone, out to
   * the sibling screen, back with the child -- the name rose 60px and the
   * commit fell 60px. A 120px scissor around a centre line that is not an
   * element: nothing on the screen was fixed. So the bottom is anchored, which
   * is the right end to anchor. The commit is the irreversible one on a device
   * with no undo and the one a thumb travels toward; the name floats, and the
   * name is read rather than tapped, and it now moves half as far as either did
   * before. Anchored to a band at about 72% of the glass rather than to the
   * bezel, so the controls stay in the reachable middle of a screen somebody is
   * standing at.
   */
  .screen.r3 {
    display: grid; grid-template-rows: minmax(0, 1fr) auto auto;
    width: 100%; grid-template-columns: minmax(0, 28rem); justify-content: center;
    justify-items: center; gap: 0;
    /* A band rather than the whole glass: the controls stay in the reachable
       middle of a screen somebody is standing at, and the band itself is a
       constant, so the identity sits at its top and the commit at its bottom
       whatever the guess returned. */
    /* Centring is the flex parent's job now that there is one. The band is
       820px in a 1280px portrait glass, which puts the commit's centre at about
       68% — below the middle, where a standing adult's hands are, and clear of
       the bezel that bottom-anchoring had it touching. */
    height: min(100%, 51.25rem);
  }
  /*
   * The bottom is what is anchored, and only the bottom.
   *
   * Pinning the identity as well left a 300px hole in the scene with no list —
   * and the name is read rather than tapped, so it is the element that can
   * afford to move. Identity and region ride one flexible track together,
   * bottom-aligned against the commit, so the child's name is always directly
   * above the question that asks who is with her however long the list gets.
   */
  .screen.r3 .upper {
    display: flex; flex-direction: column; align-items: center;
    justify-content: flex-end; align-self: stretch; min-height: 0; width: 100%;
  }
  .screen.r3 .whoelse { min-height: 0; }
  /* Measured in a scene that HAS an ask -- three of the four do, and the ask's
     line box hides ~5px of slack the box gap knows nothing about, which is why
     r2 rendered 35 here in one scene and 41 in the others for one intent. */
  .screen.r3 .who { margin-bottom: 1.75rem; }
  .screen.r3 .whoelse { min-height: 0; margin-bottom: 3rem; }
  /* 76px again, and this time the CSS agrees with the note. r2 claimed the
     exit's isolation as the top of the ramp and cut it to 56 in the same round,
     which a reader cannot tell from the 48 above it. */
  .screen.r3 .commit { margin-bottom: 3.25rem; }

  /*
   * One question, both scenes, and short enough to be a question rather than a
   * heading. Suppressing it in "alone" left a bare noun phrase whose nearest
   * noun was the child's name, which reads as "not this child, show me a
   * different one" -- to precisely the parent this change exists for.
   *
   * On the region's box edge, not the rows' text edge: it labels the blocks
   * rather than their contents, and the 20px inset that read as alignment
   * became a 48px indent that read as floating once the gutter arrived.
   */
  .screen.r3 .ask { padding: 0 0 0.25rem; }

  /* One mechanism owns this gap. r2 stacked a list margin on top of the
     region's flex gap and got 16px by accident -- double the row pitch, so the
     add-row spaced as a separate control while its gutter, height, radius and
     text edge all said it was the list's last row. */


  /*
   * What the scroller is hiding, said where it is hidden.
   *
   * Both critics found the same blocker independently: on the landscape kiosk
   * the list clips mid-row and a *pre-ticked* child can be entirely off the
   * glass, so the parent commits a name they never saw, on a screen with no
   * undo. The count in the commit cannot carry this -- nothing below a terminal
   * button is read before the decision, which this loop settled in round 1.
   */
  .rows.overflowing { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 2rem), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 2rem), transparent); }
  .screen.r3 .more {
    padding: 0.5rem 0 0; font-size: 1.25rem; line-height: 1.75rem;
    color: var(--brand-300); text-align: left;
  }

  /* Full opacity and the label's optical size. A 6x9px mark at 80% under a
     36x36 filled chip was four per cent of its weight -- the right inset read
     as empty with a speck in it. */
  .screen.r3 .addrow .go { opacity: 1; font-size: 1.5rem; }

  /* The tick is state; the commit is the action. Both were present-600 at the
     same value, so at five rows the chip column resolved before the names it
     belongs to and the screen's loudest accent was spent on its least varying
     bit. */
  .screen.r3 .tick { background: color-mix(in oklab, var(--present-600) 55%, transparent); color: var(--ink-50); }

  /* The wide kiosk stops being the tall one with more page around it -- it was
     hiding a row on the axis it is short of while two-thirds of its width sat
     empty. */
  .screen.r3.wide { grid-template-columns: minmax(0, 36rem); }
  .screen.r3 .who { max-width: 100%; }
  .screen.r3 .whoelse, .screen.r3 .commit, .screen.r3 .upper { max-width: 100%; }

`;

/*
 * CSS lives in a template literal, so a backtick in one of its comments closes
 * the string and the failure surfaces a hundred lines away as "Expected ;".
 * Three rounds, three times. Quote CSS identifiers instead.
 */
if (CSS.includes('`')) throw new Error('A backtick in the CSS block will close the template literal.');

type Scene = 'alone' | 'family' | 'many' | 'added';

/**
 * Four scenes now, and the last two exist because round 2 caught what one
 * sibling was hiding.
 *
 *   - **many** — five siblings. `MAX_FAMILY_OFFER` is 7, so eight children is
 *     a supported case, and on the landscape kiosk a centred column that
 *     cannot scroll pushes the student's *name* off the top of the glass at
 *     five. No frame in either round had tested more than one.
 *   - **added** — the parent came back from the sibling screen with the child
 *     the guess missed, ticked. This is the outcome the whole change exists to
 *     produce and neither round had photographed it.
 */

/**
 * What a round may change.
 *
 * `above` is the whole region between the name and the commit — the "who else?"
 * question, whatever form it takes that round. `below` is what sits between the
 * commit and Back. A variant owns both, because the argument this loop is
 * having is precisely about which of the two the sibling affordance belongs in.
 */
interface Variant {
  above?: string;
  below?: string;
}

/** The ticked list as it stands: the guess, found and confirmed. */
const TICKED_LIST = `<div class="family">
      <div class="ask">Checking in anyone else?</div>
      <div class="rows">
        <div class="row"><span class="rname">Amara Washington</span><span class="tick">&#10003;</span></div>
      </div>
    </div>`;

const VARIANTS: Record<string, (scene: Scene) => Variant> = {
  /** What is on the glass today: a grey line, under the commit. */
  r0: (scene) => ({
    above: scene === 'family' ? TICKED_LIST : '',
    below: '<button class="sibling-link">Find a brother or sister</button>',
  }),

  /**
   * Round 1. Both critics landed on the same structural answer from opposite
   * directions, so this takes it whole.
   *
   *  - **One slot, both scenes.** The affordance is the last row of the
   *    who-else region, above the commit, in the same place whether the kiosk
   *    guessed a sibling or not. Nothing below a terminal button can be
   *    rescued by treatment: it is read after the decision is made.
   *  - **A filled box.** The frame teaches "fill means pressable, grey text
   *    means readable" on every other element and then broke its own rule on
   *    the one door out to a child who is not on the list.
   *  - **The label is not part of the slot.** "Checking in anyone else?" is a
   *    question about a list; with one button under it and no list, it is a
   *    heading over a heading. It renders only when there are siblings.
   *  - **Back becomes the only unboxed thing**, which is what makes it read as
   *    an exit rather than an offer. It no longer shares a class string with a
   *    control that adds a child.
   */
  r1: (scene) => ({
    above: `<div class="whoelse">
      ${scene === 'family' ? '<div class="ask">Checking in anyone else?</div>' : ''}
      ${
        scene === 'family'
          ? '<div class="row"><span class="rname">Amara Washington</span><span class="tick">&#10003;</span></div>'
          : ''
      }
      <button class="addrow"><span class="plus">+</span> Add another child</button>
    </div>`,
  }),

  /**
   * Round 2. Two majors, and the first is mine.
   *
   *  - **The label was the wizard's own button.** `RegistrationFlow.tsx` labels
   *    its next-child control "Add another child", word for word, and
   *    `SiblingScreen` carries "Not on the list? Add a new child" in the exact
   *    token trio r1 borrowed. A parent who pressed a blue tinted ringed pill
   *    saying "Add another child" and landed on a keyboard would press the one
   *    blue tinted ringed pill on the new screen and register a duplicate of a
   *    child already on the roster. `SiblingScreen`'s own header records that
   *    "+ Add a brother or sister" was removed from this screen for exactly
   *    this reason; r1 collapsed both distinctions that had been keeping them
   *    apart in one move. So: no verb at all. A noun phrase cannot collide with
   *    "Add" or fight "Find", and the heavier fill means the two pills no
   *    longer wear the same costume either.
   *  - **The scroller.** See the CSS note.
   *
   * And the smaller ones: the plus hangs so the words hold the list's left
   * edge, a chevron fills the right so the row stops reading as an *unticked*
   * sibling in its own list's grammar, the ask joins Back at one size so the
   * screen has four type sizes rather than five, and the commit says what it
   * will actually do.
   */
  /**
   * Round 3. Two majors from each critic, and they overlap on the first.
   *
   *  - **The scroller hides a ticked child.** Independently found by both. On
   *    the landscape kiosk it clips mid-row, through the card and through the
   *    tick chip, with no track, no fade and no count — and the row it hides is
   *    pre-ticked, so the parent commits a name they never saw on a screen with
   *    no undo. It does not degrade either: the viewport is fixed, so at seven
   *    siblings it shows three and a half and commits "all 8".
   *  - **The commit was moving 60px** while the name moved 60 the other way,
   *    around a centre line that is not an element. Anchored at the bottom now.
   *  - **The ramp did not exist**: 14/35/48/56, two steps of 17% that no reader
   *    parses as levels — and r2's own note claimed 76 before the exit while
   *    its CSS cut it to 56.
   *  - **The question is back in both scenes**, short. Suppressing it left a
   *    noun phrase attaching to the nearest noun, which was the child's name.
   */
  r3: (scene) => {
    const siblings =
      scene === 'family'
        ? ['Amara Washington']
        : scene === 'added'
          ? ['Amara Washington', 'Malia Washington']
          : scene === 'many'
            ? ['Amara Washington', 'Malia Washington', 'Zuri Washington', 'Ike Washington', 'Ada Washington']
            : [];
    const rows = siblings
      .map((name) => `<div class="row"><span class="rname">${name}</span><span class="tick">&#10003;</span></div>`)
      .join('\n        ');
    return {
      above: `<div class="whoelse">
      <div class="ask">Anyone else?</div>
      ${
        siblings.length > 0
          ? `<div class="rows${siblings.length > 4 ? ' overflowing' : ''}">\n        ${rows}\n      </div>`
          : ''
      }
      <button class="addrow"><span class="plus">+</span>Another child<span class="go">&rsaquo;</span></button>
    </div>`,
    };
  },

  r2: (scene) => {
    const siblings =
      scene === 'family'
        ? ['Amara Washington']
        : scene === 'added'
          ? ['Malia Washington']
          : scene === 'many'
            ? ['Amara Washington', 'Malia Washington', 'Zuri Washington', 'Ike Washington', 'Ada Washington']
            : [];
    const rows = siblings
      .map((name) => `<div class="row"><span class="rname">${name}</span><span class="tick">&#10003;</span></div>`)
      .join('\n        ');
    return {
      above: `<div class="whoelse">
      ${siblings.length > 0 ? '<div class="ask">Checking in anyone else?</div>' : ''}
      ${siblings.length > 0 ? `<div class="rows">\n        ${rows}\n      </div>` : ''}
      <button class="addrow"><span class="plus">+</span>Another child<span class="go">&rsaquo;</span></button>
    </div>`,
    };
  },
};

function page(scene: Scene, variant: string, tall: boolean): string {
  const build = VARIANTS[variant] ?? VARIANTS.r0!;
  const { above = '', below = '' } = build(scene);
  /*
   * The real component renders `Check in all ${n}` whenever a sibling is
   * ticked, and the count in the green slab is the only place on the screen
   * that reports how many children the tap covers — which makes it the safety
   * net for an accidental untick and the confirmation that an add worked. Two
   * rounds judged this screen without it.
   */
  const ticked =
    scene === 'family' ? 2 : scene === 'added' ? 3 : scene === 'many' ? 6 : 1;
  const commitLabel = ticked > 1 ? `Check in all ${ticked}` : 'Check in';

  return `<!doctype html>
<html lang="en" class="h-full" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kiosk confirm — ${scene} — ${variant}</title>
<style>${CSS}</style>
</head>
<body style="width:${tall ? 800 : 1280}px;height:${tall ? 1280 : 800}px">
  <div class="screen${variant === 'r0' ? '' : ' ' + variant}${tall ? '' : ' wide'}">
    ${variant === 'r3' ? '<div class="upper">' : ''}
    <div class="who">
      <div class="name">Nia Washington</div>
      <div class="grade">8th grade</div>
    </div>
    ${above}
    ${variant === 'r3' ? '</div>' : ''}
    <button class="commit">${commitLabel}</button>
    ${below}
    <button class="back">&larr; Back</button>
  </div>
</body>
</html>`;
}

const variant = process.argv[2] ?? 'r0';
await mkdir(OUT, { recursive: true });
for (const scene of ['alone', 'family', 'many', 'added'] as Scene[]) {
  for (const [suffix, tall] of [
    ['kiosktall', true],
    ['kioskwide', false],
  ] as [string, boolean][]) {
    const file = join(OUT, `kiosk-confirm-${scene}--${suffix}.html`);
    await writeFile(file, page(scene, variant, tall), 'utf8');
    console.log(`wrote ${file}`);
  }
}
