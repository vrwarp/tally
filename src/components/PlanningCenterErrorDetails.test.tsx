import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanningCenterErrorDetails } from '@/components/PlanningCenterErrorDetails';
import type { PcoErrorReport } from '@/types';

const REPORT: PcoErrorReport = {
  message: 'Could not reach Planning Center to load your Planning Center lists.',
  code: 'functions/unavailable',
  reportedAt: '2026-02-13T19:30:00.000Z',
  debug: {
    kind: 'api',
    operation: 'load your Planning Center lists',
    occurredAt: '2026-02-13T19:29:58.000Z',
    message: 'Planning Center 500 for https://api.planningcenteronline.com/people/v2/lists',
    request: {
      method: 'GET',
      url: 'https://api.planningcenteronline.com/people/v2/lists?per_page=100',
      headers: { Authorization: '[redacted]', Accept: 'application/json' },
      attempts: 5,
    },
    response: {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json' },
      body: '{"errors":[{"title":"Server error"}]}',
      bodyTruncated: false,
      durationMs: 412,
    },
    errors: ['Server error'],
  },
};

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('PlanningCenterErrorDetails', () => {
  it('starts collapsed, because the banner is the whole message for most people', () => {
    const { container } = render(<PlanningCenterErrorDetails report={REPORT} />);

    expect(container.querySelector('details')?.open).toBe(false);
    expect(screen.getByText('Show details')).toBeInTheDocument();
  });

  it('shows the request, the response and what Planning Center said', () => {
    render(<PlanningCenterErrorDetails report={REPORT} />);

    // Twice over: the URL is in the request block and in the error line above it.
    expect(screen.getAllByText(/api\.planningcenteronline\.com\/people\/v2\/lists/).length)
      .toBeGreaterThan(0);
    expect(screen.getByText(/HTTP 500 Internal Server Error/)).toBeInTheDocument();
    expect(screen.getByText(/412 ms/)).toBeInTheDocument();
    expect(screen.getByText(/Sent 5 times/)).toBeInTheDocument();
    expect(screen.getByText('Server error')).toBeInTheDocument();
    expect(screen.getByText('functions/unavailable')).toBeInTheDocument();
  });

  it('puts the whole failure on the clipboard as markdown', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    stubClipboard(writeText);

    render(<PlanningCenterErrorDetails report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy debug details' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('## Planning Center error');
    expect(copied).toContain('GET https://api.planningcenteronline.com/people/v2/lists?per_page=100');
    expect(copied).toContain('HTTP 500 Internal Server Error');
    expect(copied).not.toMatch(/Authorization: (?!\[redacted])/);

    await screen.findByRole('button', { name: 'Copied' });
  });

  it('says so when the device will not allow a copy', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));

    render(<PlanningCenterErrorDetails report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy debug details' }));

    expect(await screen.findByText(/Copying is blocked on this device/)).toBeInTheDocument();
  });

  it('explains a failure that never reached Planning Center', () => {
    render(
      <PlanningCenterErrorDetails
        report={{
          message: 'Only the core team can do that.',
          code: 'functions/permission-denied',
          reportedAt: '2026-02-13T19:30:00.000Z',
          debug: null,
        }}
      />,
    );

    expect(screen.getByText(/failed before Tally asked Planning Center anything/)).toBeInTheDocument();
    expect(screen.queryByText(/HTTP/)).not.toBeInTheDocument();
  });
});
