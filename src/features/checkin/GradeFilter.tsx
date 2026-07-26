/**
 * Grade narrowing, in the width of one chip.
 *
 * Seven grades laid out as seven chips ate most of the scope bar and pushed the
 * filters people actually reach for off the right-hand edge of a phone. A
 * single chip that opens a checklist costs one extra tap and buys back the
 * room — and it can express "8th and 9th", which a row of one-at-a-time chips
 * never could.
 *
 * The panel is a plain absolutely-positioned div rather than a modal: picking
 * two grades is a two-tap job, and a full-screen sheet for it would be heavier
 * than the roster underneath it.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn, ordinalGrade } from '@/lib/utils';
import { GRADES, type Grade } from '@/types';

/** Breathing room between the bottom of the panel and the bottom of the screen. */
const PANEL_MARGIN = 12;

/** Below this the panel scrolls rather than shrinking to a slot or two. */
const PANEL_MIN = 160;

export interface GradeFilterProps {
  /** Selected grades. Empty means every grade — the default. */
  grades: readonly Grade[];
  onChange: (grades: readonly Grade[]) => void;
}

function summarise(grades: readonly Grade[]): string {
  if (grades.length === 0) return 'All grades';
  if (grades.length === 1) return `${ordinalGrade(grades[0]!)} grade`;
  // Past two, the ordinals are longer than the chip and get truncated to
  // something unreadable ("6th, 7th, 9…"), so the count carries it instead.
  if (grades.length === 2) return grades.map((grade) => ordinalGrade(grade)).join(', ');
  return `${grades.length} grades`;
}

export function GradeFilter({ grades, onChange }: GradeFilterProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /**
   * How much room there actually is under the chip.
   *
   * A panel that runs past the bottom of the window puts grades where nothing on
   * screen says they are: it is absolutely positioned, so it does not lengthen
   * the page, and the bottom tab bar sits over the last of it besides. A CSS
   * `dvh` cap cannot do this: what matters is the distance from *this chip* to
   * the bottom edge, and the chip's own position moves as the page scrolls.
   * Measured before paint, so the panel never renders at the wrong size.
   */
  const [maxHeight, setMaxHeight] = useState<number>();

  useLayoutEffect(() => {
    if (!open) return;

    const measure = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      setMaxHeight(Math.max(PANEL_MIN, window.innerHeight - rect.bottom - PANEL_MARGIN));
    };

    measure();
    window.addEventListener('resize', measure);
    // The chip rides the page now, so how much room is under it changes as the
    // roster scrolls — remeasuring lets the panel grow into the space instead of
    // holding whatever was true when it opened.
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [open]);

  // Closing on an outside press keeps the panel from covering the first student
  // in the list once the counselor has moved on from filtering.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = (grade: Grade) => {
    onChange(
      grades.includes(grade)
        ? grades.filter((value) => value !== grade)
        : [...GRADES].filter((value) => value === grade || grades.includes(value)),
    );
  };

  const active = grades.length > 0;

  return (
    <div ref={container} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Filter by grade, ${summarise(grades).toLowerCase()}`}
        className={cn(
          'flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold ring-1 transition-colors',
          active
            ? 'bg-brand-500/20 text-brand-200 ring-brand-500/40'
            : 'bg-ink-900 text-ink-400 ring-ink-800 active:bg-ink-800',
        )}
      >
        {summarise(grades)}
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-3.5">
          <path
            d="m5 8 5 5 5-5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label="Grades"
          style={{ maxHeight }}
          /* Anchored right: the chip is pinned to the right-hand end of the
             filter row, and a left-anchored panel would hang off a phone and
             give the whole page a horizontal scrollbar. `overscroll-contain`
             keeps a flick inside the checklist from scrolling the roster
             underneath it. */
          className="scroll-touch absolute right-0 top-full z-40 mt-1.5 w-44 overflow-y-auto overscroll-contain rounded-xl bg-ink-900 py-1 shadow-lg shadow-black/50 ring-1 ring-ink-700"
        >
          <Option
            checked={grades.length === 0}
            label="All grades"
            onToggle={() => onChange([])}
          />
          <span aria-hidden="true" className="my-1 block h-px bg-ink-800" />
          {GRADES.map((grade) => (
            <Option
              key={grade}
              checked={grades.includes(grade)}
              label={`${ordinalGrade(grade)} grade`}
              onToggle={() => toggle(grade)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Option({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 text-sm text-ink-200 active:bg-ink-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 shrink-0 rounded border-ink-600 bg-ink-950 accent-brand-500"
      />
      {label}
    </label>
  );
}
