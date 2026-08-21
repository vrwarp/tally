/**
 * The shape of the settings screen above `lg`.
 *
 * `PageFrame` widens to `max-w-7xl` beside the rail, and until this the four
 * cards took all of it one under the other — so three of the four spent the
 * recovered width on line length rather than on columns, and a leader who came
 * to check one thing and confirm three others scrolled for the other three.
 *
 * The cards themselves are covered by their own suites; what is asserted here
 * is only the arrangement, which is the thing no card can see for itself.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { DEFAULT_SETTINGS } from '@/types';

vi.mock('@/context/dataContext', () => ({
  useData: () => ({ settings: DEFAULT_SETTINGS, series: [], loading: false }),
}));
vi.mock('@/context/authContext', () => ({ useAuth: () => ({ user: { uid: 'leader-1' } }) }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/context/themeContext', () => ({
  useTheme: () => ({ preference: 'system', theme: 'dark', setPreference: vi.fn() }),
}));
vi.mock('@/services/events', () => ({ saveSettings: vi.fn() }));
// Owned elsewhere, and not what this suite is about.
vi.mock('@/features/settings/ThresholdPreview', () => ({ ThresholdPreview: () => null }));
vi.mock('@/features/settings/PlanningCenterCard', () => ({
  PlanningCenterCard: () => <section data-testid="planning-center" />,
}));
// The real one is a fragment of one or two cards; both have to land in the grid
// rather than inside a wrapper of their own.
vi.mock('@/features/settings/BackendsSection', () => ({
  BackendsSection: () => (
    <>
      <section data-testid="attendees" />
      <section data-testid="new-students" />
    </>
  ),
}));

function mount() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

const card = (heading: string) =>
  screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement;

describe('the settings screen above lg', () => {
  it('lays the cards out in two columns rather than one tall stack', () => {
    mount();

    const grid = card('Predictive roster').parentElement as HTMLElement;
    expect(grid).toHaveClass('lg:grid', 'lg:grid-cols-2', 'lg:items-start', 'lg:gap-6');
    // The phone keeps exactly what it had: one column, one gap.
    expect(grid).toHaveClass('flex', 'flex-col', 'gap-4');
  });

  it('spans the two cards that already split themselves, and pairs the rest', () => {
    mount();

    // Thresholds beside their preview, and the theme picker beside the sentence
    // that describes it — both are already two columns wide inside.
    expect(card('Predictive roster')).toHaveClass('lg:col-span-2');
    expect(card('Appearance')).toHaveClass('lg:col-span-2');

    const grid = card('Predictive roster').parentElement;
    // The connection cards are siblings in the same grid, so they take one
    // column each and stand side by side.
    expect(screen.getByTestId('planning-center').parentElement).toBe(grid);
    expect(screen.getByTestId('attendees').parentElement).toBe(grid);
    expect(screen.getByTestId('new-students').parentElement).toBe(grid);
  });

  it('keeps the page heading out of the grid', () => {
    mount();

    const heading = screen.getByRole('heading', { name: 'Settings', level: 1 });
    expect(heading.closest('header')?.parentElement).not.toBe(card('Appearance').parentElement);
  });
});
