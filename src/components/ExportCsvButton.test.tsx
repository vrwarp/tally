/**
 * The states the export control can settle on.
 *
 * A download has no visible result, so everything a person learns about whether
 * it worked comes from this component: the count in the toast, the disable at
 * zero, and the named refusal when the roster underneath is not trustworthy.
 */
import { render, screen } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportCsvButton } from '@/components/ExportCsvButton';

const show = vi.hoisted(() => vi.fn());
const downloadCsv = vi.hoisted(() => vi.fn());
const downloadOpensInViewer = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show }) }));
// Mocked at the module boundary so jsdom never navigates a `blob:` href. The
// real helper is driven by `src/lib/download.test.ts`.
vi.mock('@/lib/download', () => ({ downloadCsv, downloadOpensInViewer }));

const build = vi.fn(() => ({ filename: 'tally-roster-2026-08-09.csv', contents: 'a\r\n' }));

beforeEach(() => {
  show.mockReset();
  downloadCsv.mockReset();
  downloadOpensInViewer.mockReset().mockReturnValue(false);
  build.mockClear();
});

describe('ExportCsvButton', () => {
  it('builds once and downloads, then names the count', async () => {
    render(<ExportCsvButton build={build} count={22} noun="students" />);
    await userEvent.click(screen.getByRole('button'));

    expect(build).toHaveBeenCalledOnce();
    expect(downloadCsv).toHaveBeenCalledWith('tally-roster-2026-08-09.csv', 'a\r\n');
    expect(show).toHaveBeenCalledWith('Downloaded 22 students', { tone: 'success' });
  });

  it('does not say "1 students"', async () => {
    render(<ExportCsvButton build={build} count={1} noun="students" />);
    await userEvent.click(screen.getByRole('button'));
    expect(show).toHaveBeenCalledWith('Downloaded 1 student', { tone: 'success' });
  });

  it('is disabled with nothing to export, and never builds an empty file', async () => {
    render(<ExportCsvButton build={build} count={0} noun="students" />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(build).not.toHaveBeenCalled();
  });

  it('is disabled and carries the reason when the data underneath is not trustworthy', () => {
    render(
      <ExportCsvButton
        build={build}
        count={40}
        noun="students"
        blockedReason="The roster could not be read."
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    // The sentence has to be reachable: a disabled control with nothing beside
    // it reads as a broken one.
    expect(button).toHaveAttribute('title', 'The roster could not be read.');
  });

  it('aborts without downloading when the confirmation is declined', async () => {
    const confirm = vi.fn(async () => false);
    render(<ExportCsvButton build={build} count={3} noun="students" confirm={confirm} />);
    await userEvent.click(screen.getByRole('button'));

    expect(confirm).toHaveBeenCalledOnce();
    expect(build).not.toHaveBeenCalled();
    expect(downloadCsv).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('reports a device that cannot save rather than claiming success', async () => {
    downloadCsv.mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ExportCsvButton build={build} count={3} noun="students" />);
    await userEvent.click(screen.getByRole('button'));

    expect(show).toHaveBeenCalledWith('Could not save the file on this device.', { tone: 'error' });
  });

  it('hedges in a browser that will show the file instead of saving it', async () => {
    downloadOpensInViewer.mockReturnValue(true);
    render(<ExportCsvButton build={build} count={3} noun="students" />);
    await userEvent.click(screen.getByRole('button'));

    expect(downloadCsv).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(
      'Exported — this browser may show the file instead of saving it.',
      { tone: 'info' },
    );
  });
});
