import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui';

interface Props {
  children: ReactNode;
  /**
   * Whether this boundary wraps one screen rather than the whole app.
   *
   * A `what` string used to be interpolated into the heading. Two headings that
   * differ by a noun cannot be translated as one — Chinese puts the noun
   * somewhere else in the clause — so each is its own whole sentence now, and
   * this picks between them. There has only ever been one caller.
   */
  scoped?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * The fallback, as a function component so it can read the catalogue.
 *
 * A class cannot call a hook, and this is deliberately the only class in the
 * codebase — React offers no other way to catch a render error. The boundary
 * sits below `TallyIntlProvider`, so the messages are there even when the
 * subtree under it has thrown.
 */
function ErrorFallback({
  error,
  scoped,
  isChunkFailure,
  onReset,
}: {
  error: Error;
  scoped: boolean;
  isChunkFailure: boolean;
  onReset: () => void;
}) {
  const t = useTranslations('Errors');
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
          {scoped ? t('boundaryTitleScreen') : t('boundaryTitle')}
        </h1>
        <p className="mt-1 max-w-sm text-sm text-ink-400">
          {isChunkFailure ? t('boundaryChunk') : t('boundaryCarryOn')}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {!isChunkFailure ? (
          <Button variant="secondary" onClick={onReset}>
            {t('tryAgain')}
          </Button>
        ) : null}
        <Button onClick={() => window.location.reload()}>{t('reload')}</Button>
      </div>

      <details className="mt-2 max-w-full text-left">
        <summary className="cursor-pointer text-xs text-ink-500">{t('technicalDetails')}</summary>
        <pre className="mt-2 max-w-sm select-text overflow-x-auto rounded-lg bg-ink-900 p-3 text-left text-xs text-ink-400">
          {error.message}
        </pre>
      </details>
    </div>
  );
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
      <ErrorFallback
        error={error}
        scoped={Boolean(this.props.scoped)}
        isChunkFailure={isChunkFailure}
        onReset={this.reset}
      />
    );
  }
}
