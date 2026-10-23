/**
 * The confirmation in front of a partial roster export.
 *
 * What is pinned here is that a saved copy with an unusable timestamp still
 * renders: the date is a courtesy beside the count, and formatting an invalid
 * Date throws, which would otherwise take the whole dialog down with it.
 */
import { render, screen } from '@/test/rtl';
import { describe, expect, it, vi } from 'vitest';
import { PartialRosterDialog } from '@/features/students/PartialRosterDialog';
import type { RosterBackendStatus } from '@/services/functions';

function backend(fetchedAt: string): RosterBackendStatus {
  return {
    backendId: 'a32',
    displayName: 'Attendees',
    ok: false,
    error: 'offline',
    people: 12,
    unresolved: 0,
    missing: 0,
    cached: true,
    fetchedAt,
  };
}

function renderDialog(fetchedAt: string) {
  render(
    <PartialRosterDialog
      open
      down={[backend(fetchedAt)]}
      unresolved={0}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
}

describe('PartialRosterDialog', () => {
  it('dates the saved copy when the timestamp parses', () => {
    renderDialog('2026-01-09T19:00:00Z');

    expect(screen.getByText(/12 students from this device’s saved copy, last read/)).toBeInTheDocument();
  });

  it('falls back to the undated wording when the timestamp does not parse', () => {
    renderDialog('not-a-date');

    expect(screen.getByText('12 students from this device’s saved copy.')).toBeInTheDocument();
  });

  it('falls back to the undated wording when there is no timestamp', () => {
    renderDialog('');

    expect(screen.getByText('12 students from this device’s saved copy.')).toBeInTheDocument();
  });
});
