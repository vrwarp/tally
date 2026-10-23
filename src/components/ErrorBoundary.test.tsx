/**
 * What a render error turns into.
 *
 * The boundary is the last thing between a crash and a blank page, so these pin
 * the three things a person can rely on: the rest of the tree is replaced by an
 * alert rather than by nothing, a stale-chunk failure points at a reload rather
 * than a retry that cannot work, and "Try again" really does re-render.
 */
import { fireEvent, render, screen } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';

let failure: Error | null = null;

function Bomb() {
  if (failure) throw failure;
  return <p>all well</p>;
}

beforeEach(() => {
  failure = null;
  // React and the boundary both log the crash on purpose; keep the run quiet.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing has thrown', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText('all well')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('replaces a crashed tree with an alert that offers a retry and a reload', () => {
    failure = new Error('roster exploded');
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Something went wrong.' })).toBeInTheDocument();
    expect(screen.getByText('roster exploded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload Tally' })).toBeInTheDocument();
  });

  it('uses the screen-level heading when scoped to one screen', () => {
    failure = new Error('boom');
    render(
      <ErrorBoundary scoped>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole('heading', { name: 'Something went wrong loading this screen.' }),
    ).toBeInTheDocument();
  });

  it('sends a failed dynamic import to a reload, not a retry', () => {
    failure = new Error('Failed to fetch dynamically imported module: /assets/Dashboard.js');
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Tally was updated while this page was open/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload Tally' })).toBeInTheDocument();
  });

  it('re-renders the children on Try again once the fault has cleared', () => {
    failure = new Error('transient');
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    failure = null;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('all well')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
