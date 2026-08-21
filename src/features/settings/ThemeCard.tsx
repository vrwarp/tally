/**
 * Choosing a theme.
 *
 * Three buttons rather than a dropdown: there are exactly three answers, they
 * are all short, and a counselor changing this is doing it once. A segmented
 * control shows all three at a glance and costs one tap; a `<select>` costs
 * two and hides the options behind the first.
 *
 * This is the one setting that is *not* shared with the team. Everything else on
 * this screen changes what every counselor sees; a theme is about the phone in
 * your hand and the room you are standing in, so it lives in local storage and
 * never touches Firestore.
 */
import { Card, CardHeader } from '@/components/ui';
import { useTheme } from '@/context/themeContext';
import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const LABEL: Record<ThemePreference, string> = {
  system: 'Match device',
  light: 'Light',
  dark: 'Dark',
};

const HINT: Record<ThemePreference, string> = {
  system: 'Follows your phone, including when it switches at sunset.',
  light: 'Always light, whatever the device is doing.',
  dark: 'Always dark. Easier on the eyes in a dim room.',
};

/** A sun, a moon, and a device that cannot make its mind up. */
function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === 'light') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (preference === 'dark') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
        <path
          d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6.5v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ThemeCard({ className }: { className?: string }) {
  const { preference, theme, setPreference } = useTheme();

  return (
    <Card className={className}>
      <CardHeader
        title="Appearance"
        description="Just for this device — it is not shared with the rest of the team."
      />

      {/*
       * The picker keeps a phone's width and no more.
       *
       * Three options in a `grid-cols-3` with nothing capping it stretched to
       * whatever the card was — inside a widened page frame that is ~340px per
       * option, and a segmented control that wide stops reading as one control
       * and starts reading as three cards. Capped at `w-80` above `lg` it is a
       * control again, and the sentence that says what the choice *does* moves
       * up beside it instead of sitting under a mostly-empty row.
       *
       * The options themselves are untouched: `min-h-20` is the same 80px
       * target under a thumb that it always was, at every width.
       */}
      <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-3 gap-2 lg:w-80 lg:max-w-md lg:shrink-0"
        >
          {THEME_PREFERENCES.map((option) => {
            const selected = preference === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPreference(option)}
                className={cn(
                  'flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-medium ring-1',
                  selected
                    ? 'bg-brand-500/15 text-brand-300 ring-brand-500/40'
                    : 'bg-ink-950 text-ink-400 ring-ink-800 hover:text-ink-200',
                )}
              >
                <ThemeIcon preference={option} />
                {LABEL[option]}
              </button>
            );
          })}
        </div>

        <p aria-live="polite" className="text-xs text-ink-500">
          {HINT[preference]}
          {preference === 'system' ? ` Right now that is ${theme}.` : ''}
        </p>
      </div>
    </Card>
  );
}
