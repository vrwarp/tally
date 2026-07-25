import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui';

interface Props {
  children: ReactNode;
  /** Shown above the message, e.g. "the dashboard". */
  what?: string;
}

interface State {
  error: Error | null;
}

/**
 * The last line of defence between a render error and a blank white screen.
 *
 * A counselor with a queue at the door cannot debug anything and cannot afford
 * to lose their place. So a crash keeps the page, names what broke, and offers
 * the two things that actually help: try the screen again without losing the
 * session, or reload. React gives no other way to catch a render error, which is
 * why this is the one class component in the codebase.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing swallows this: without a console record, a crash that only happens
    // on one volunteer's phone is undiagnosable.
    console.error('[tally] render error', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    /*
     * A failed dynamic import is the common case in the field — a stale service
     * worker pointing at a chunk that no longer exists after a deploy — and the
     * fix is a reload, not a retry. Saying so beats a generic apology.
     */
    const isChunkFailure = /dynamically imported module|Importing a module script|Loading chunk/i.test(
      error.message,
    );

    return (
      <div
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <p className="text-3xl" aria-hidden="true">
          ⚠
        </p>
        <div>
          <h1 className="text-lg font-semibold text-ink-100">
            {this.props.what ? `Something went wrong loading ${this.props.what}.` : 'Something went wrong.'}
          </h1>
          <p className="mt-1 max-w-sm text-sm text-ink-400">
            {isChunkFailure
              ? 'Tally was updated while this page was open. Reloading will pick up the new version.'
              : 'The rest of Tally is still working — you can go back and carry on.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {!isChunkFailure ? (
            <Button variant="secondary" onClick={this.reset}>
              Try again
            </Button>
          ) : null}
          <Button onClick={() => window.location.reload()}>Reload Tally</Button>
        </div>

        <details className="mt-2 max-w-full text-left">
          <summary className="cursor-pointer text-xs text-ink-500">Technical details</summary>
          <pre className="mt-2 max-w-sm overflow-x-auto rounded-lg bg-ink-900 p-3 text-left text-xs text-ink-400">
            {error.message}
          </pre>
        </details>
      </div>
    );
  }
}
