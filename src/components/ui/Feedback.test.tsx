/**
 * What a loading skeleton says, and what a failure offers.
 *
 * Both are the same kind of defect: a component that draws the situation
 * without stating it. `SkeletonRows` is `aria-hidden` by design — there is
 * nothing to read out in a grey rectangle — but for a long time nothing was
 * said in its place, so a leader who cannot see the screen got silence and then
 * a list, with no way to tell a slow Planning Center read from an empty result.
 * `ErrorBanner` named the fault and offered nothing to do about it.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorBanner, SkeletonRows } from '@/components/ui/Feedback';

describe('SkeletonRows', () => {
  it('says nothing until a caller gives it a sentence', () => {
    render(<SkeletonRows count={2} />);

    // Announcing by default put a second `role="status"` inside `<main>` on
    // every screen with a skeleton, next to live regions those screens already
    // keep — the sync strip on a student's record among them. Two live regions
    // describing different things is the failure this component was meant to
    // fix, not one to introduce, so the announcement is asked for.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('takes a better sentence from a caller that has one', () => {
    render(<SkeletonRows label="Loading the roster" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the roster');
  });

  it('stays silent for a caller that announces for itself', () => {
    // Otherwise the two speak over each other on the screens whose own status
    // is the more specific of the pair.
    render(<SkeletonRows label={null} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the pulsing rows themselves out of the accessibility tree', () => {
    const { container } = render(<SkeletonRows count={3} />);

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });
});

describe('ErrorBanner', () => {
  it('carries its recovery inside the alert', () => {
    render(
      <ErrorBanner
        message="Could not load events"
        action={<button type="button">Reload</button>}
      />,
    );

    // Inside, so that the control and the sentence explaining it are one thing
    // rather than a button somebody has to connect to a message above it.
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('is the element it always was for a failure with no way out', () => {
    render(<ErrorBanner message="Could not load events" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load events');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
