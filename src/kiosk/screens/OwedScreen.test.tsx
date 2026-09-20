/**
 * The one press that puts a stack of name tags on the tape.
 *
 * Nothing else in this kiosk prints more than one sticker at a time, and
 * nobody stands over this one while it runs: a volunteer who has just
 * reloaded a roll ticks a list, presses once, and walks away. So what is
 * pinned here is the honesty of the press — that the face says how many are
 * coming, that the line above it says what happens to the rest, and that a
 * group heading governs exactly the column drawn under it. A button reading
 * "Print 9 name tags" over a list where only six are ticked is a roll on the
 * floor and three children's names on it.
 */
import { fireEvent, render, screen } from '@/test/rtl';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  OwedScreen,
  rowsThatFit,
  type OwedConfirmRow,
  type OwedGroup,
} from '@/kiosk/screens/OwedScreen';

/*
 * A track with room in it.
 *
 * jsdom lays nothing out, so every element measures zero and the screen would
 * clamp to the one row it always shows (see `atLeastOne`). A tablet's own
 * track is a little over a thousand pixels tall; this is that, so the cases
 * below are about the list's reasoning rather than about a layout engine that
 * is not here.
 */
const TRACK_HEIGHT = 2_000;
let clientHeight: PropertyDescriptor | undefined;

beforeAll(() => {
  clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => TRACK_HEIGHT,
  });
});

afterAll(() => {
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
});

function row(studentId: string, overrides: Partial<OwedConfirmRow> = {}): OwedConfirmRow {
  return {
    studentId,
    name: `Child ${studentId}`,
    gradeLabel: '2nd grade',
    atLabel: '9:12',
    isNew: false,
    ...overrides,
  };
}

/** The screen with its ticks held by the test, the way `KioskApp` holds them. */
function mount(groups: readonly OwedGroup[], initial: readonly string[]) {
  const committed: { printing: readonly string[]; skipping: readonly string[] }[] = [];
  function Harness() {
    const [ticked, setTicked] = useState(() => new Set(initial));
    return (
      <OwedScreen
        groups={groups}
        ticked={ticked}
        onToggleRow={(studentId) =>
          setTicked((on) => {
            const next = new Set(on);
            if (!next.delete(studentId)) next.add(studentId);
            return next;
          })
        }
        onToggleGroup={(key) =>
          setTicked((on) => {
            const rows = groups.find((group) => group.key === key)?.rows ?? [];
            const next = new Set(on);
            const all = rows.every((one) => next.has(one.studentId));
            for (const one of rows) {
              if (all) next.delete(one.studentId);
              else next.add(one.studentId);
            }
            return next;
          })
        }
        onCommit={(printing, skipping) => committed.push({ printing, skipping })}
        onBack={vi.fn()}
      />
    );
  }
  render(<Harness />);
  return committed;
}

/** The press, which acts on the lift like every other button in the kiosk. */
function press(element: HTMLElement) {
  fireEvent.pointerDown(element);
  fireEvent.pointerUp(element);
}

const RECENT: OwedGroup = { key: 'recent', rows: [row('a'), row('b'), row('c')] };
const EARLIER: OwedGroup = { key: 'earlier', rows: [row('d'), row('e')] };

describe('the offer’s commit', () => {
  it('says how many tags the press will print', () => {
    mount([RECENT, EARLIER], ['a', 'b', 'c']);

    expect(screen.getByText('Print 3 name tags')).toBeInTheDocument();
  });

  it('says what happens to the rows nobody ticked', () => {
    // The half of a one-press settlement nobody would otherwise expect: the
    // unticked are not asked about again.
    mount([RECENT, EARLIER], ['a', 'b', 'c']);

    expect(screen.getByText('The 2 unticked are skipped.')).toBeInTheDocument();
  });

  it('offers to let the whole list go when nothing is ticked', () => {
    /* A volunteer who unticks everything has answered the question — the
       button must still be the way out, or the only way off this screen is
       Back, which settles nothing and asks again on the next recovery. */
    mount([RECENT, EARLIER], []);

    expect(screen.getByText('Skip 5 name tags')).toBeInTheDocument();
    expect(screen.queryByText(/unticked are skipped/)).not.toBeInTheDocument();
  });

  it('hands over both halves, so one press answers every row', () => {
    const committed = mount([RECENT, EARLIER], ['a', 'c']);

    press(screen.getByText('Print 2 name tags'));

    expect(committed).toHaveLength(1);
    expect(committed[0].printing).toEqual(['a', 'c']);
    expect(committed[0].skipping).toEqual(['b', 'd', 'e']);
  });
});

describe('the ticks', () => {
  it('turns a row off and back on, and counts what it says', () => {
    mount([RECENT], ['a', 'b', 'c']);

    press(screen.getByText('Child b'));
    expect(screen.getByText('Print 2 name tags')).toBeInTheDocument();

    press(screen.getByText('Child b'));
    expect(screen.getByText('Print 3 name tags')).toBeInTheDocument();
  });

  it('takes a whole group with its heading', () => {
    // The leader back from the walk ticks five rows with one press, which is
    // the whole reason the heading is a control at all.
    mount([RECENT, EARLIER], ['a', 'b', 'c']);

    press(screen.getByText('Earlier'));

    expect(screen.getByText('Print 5 name tags')).toBeInTheDocument();
  });

  it('empties a group that is already full', () => {
    mount([RECENT, EARLIER], ['a', 'b', 'c']);

    press(screen.getByText('Last 10 minutes'));

    expect(screen.getByText('Skip 5 name tags')).toBeInTheDocument();
  });

  it('shows a half-ticked group as neither on nor off', () => {
    /* A full mark over a column that contradicts it is the kiosk telling a
       volunteer something untrue about what the press will do. */
    mount([RECENT], ['a']);

    const heading = screen.getByText('Last 10 minutes').closest('button');
    expect(heading).toHaveAttribute('aria-pressed', 'false');
    expect(heading?.textContent).toContain('–');
  });

  it('gives a group of one no heading control of its own', () => {
    // Its row's tick already is the all-or-none control; a second target
    // twelve pixels away for the same decision is a second way to miss.
    mount([{ key: 'earlier', rows: [row('d')] }], []);

    expect(screen.getByText('Earlier').closest('button')).not.toHaveAttribute('aria-pressed');
  });
});

describe('what the list says about itself', () => {
  it('counts the tags in the question', () => {
    mount([RECENT, EARLIER], ['a']);

    expect(screen.getByText('5 name tags did not print')).toBeInTheDocument();
  });

  it('marks the child the room has never met', () => {
    mount([{ key: 'recent', rows: [row('a'), row('b', { isNew: true })] }], ['a', 'b']);

    expect(screen.getByText('New tonight')).toBeInTheDocument();
  });

  it('says the arrival time rather than the time of the press', () => {
    // `{{time}}` on the sticker will say the same thing, and the row is how a
    // volunteer checks that before spending the tape.
    mount([{ key: 'recent', rows: [row('a', { atLabel: '9:12' })] }], ['a']);

    expect(screen.getByText(/9:12/)).toBeInTheDocument();
  });
});

describe('how much of the list is on the glass', () => {
  /*
   * Quantised to the row pitch, like `ConfirmScreen`'s sibling list: a row is
   * either printed or hidden, and half a child at half value is the one state
   * this screen cannot render. Measured rather than counted so a heading
   * appearing or a group emptying cannot drift it.
   */
  it('pays for a heading before it draws the rows under it', () => {
    const one = rowsThatFit(1000, [RECENT]);
    const two = rowsThatFit(1000, [RECENT, EARLIER]);

    // The same five rows cost more across two groups than across one.
    expect(rowsThatFit(1000, [{ key: 'recent', rows: [...RECENT.rows, ...EARLIER.rows] }])).toBe(5);
    expect(two).toBeLessThanOrEqual(one + EARLIER.rows.length);
  });

  it('keeps a row whole rather than tearing the one below it', () => {
    // A heading and two rows' worth of track, plus most of a third: the third
    // is not drawn at half value, it is counted in the line that says how many
    // are below.
    expect(rowsThatFit(56 + 72 + 72 + 50, [RECENT])).toBe(2);
  });

  it('shows one row even on a track that measured nothing', () => {
    /* A measurement can come back zero — a track not laid out yet, a tablet
       mid-rotation — and a screen saying "5 name tags did not print" above
       nothing at all is a batch nobody can check before pressing. */
    expect(rowsThatFit(0, [RECENT])).toBe(1);
    expect(rowsThatFit(0, [])).toBe(0);
  });

  it('never claims more rows than it was given', () => {
    expect(rowsThatFit(10_000, [RECENT, EARLIER])).toBe(5);
  });
});
