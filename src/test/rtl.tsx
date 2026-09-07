/**
 * Testing Library, with the app's language wrapped around it.
 *
 * Every component that reads a string now needs an `IntlProvider` above it, and
 * there are ninety test files with a `render` helper of their own — so rather
 * than edit ninety helpers, they all import Testing Library from here instead
 * of from the package. `render` and `renderHook` gain the provider; everything
 * else (`screen`, `fireEvent`, `waitFor`, `act`, `within`) is re-exported
 * untouched.
 *
 * Pinned to English, and that is what keeps the suite honest: the ~1,900
 * assertions in this repo that match on visible text were written against the
 * English wording, and `en.json` holds that wording verbatim. A test that fails
 * after extraction is telling you the extraction changed a string, which is
 * exactly the signal wanted. The Chinese catalogues are exercised by their own
 * parity test and by `e2e/i18n.spec.ts`, not by re-running the whole suite in
 * three languages.
 *
 * A caller that needs a different locale passes one:
 * `render(<Thing />, { locale: 'zh-Hant' })`.
 */
import type { ReactElement, ReactNode } from 'react';
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { IntlProvider } from 'use-intl';
import { DEFAULT_LOCALE, type Locale } from '@/lib/locales';
import en from '../../messages/en.json';

export * from '@testing-library/react';

interface IntlOptions {
  locale?: Locale;
  /** Fixed so `useNow`-driven relative times do not drift between runs. */
  timeZone?: string;
}

function wrapper(locale: Locale, timeZone: string | undefined) {
  return function IntlWrapper({ children }: { children: ReactNode }) {
    /*
     * `onError` left at its default on purpose. A missing key or a broken ICU
     * argument logs loudly here, which is where somebody is looking — the
     * production provider swallows them because a leader mid-check-in is not.
     */
    return (
      <IntlProvider locale={locale} messages={en} timeZone={timeZone}>
        {children}
      </IntlProvider>
    );
  };
}

/**
 * `render`, with the provider.
 *
 * A caller passing its own `wrapper` still gets ours around it, so an existing
 * helper that supplies a router or a context provider keeps working unchanged —
 * which is the whole reason this indirection is cheaper than ninety edits.
 */
export function render(
  ui: ReactElement,
  options?: RenderOptions & IntlOptions,
): RenderResult {
  const { locale = DEFAULT_LOCALE, timeZone, wrapper: inner, ...rest } = options ?? {};
  const Intl = wrapper(locale, timeZone);
  const Wrapper = inner
    ? ({ children }: { children: ReactNode }) => {
        const Inner = inner;
        return (
          <Intl>
            <Inner>{children}</Inner>
          </Intl>
        );
      }
    : Intl;
  return rtlRender(ui, { ...rest, wrapper: Wrapper });
}

export function renderHook<Result, Props>(
  hook: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props> & IntlOptions,
): RenderHookResult<Result, Props> {
  const { locale = DEFAULT_LOCALE, timeZone, wrapper: inner, ...rest } = options ?? {};
  const Intl = wrapper(locale, timeZone);
  const Wrapper = inner
    ? ({ children }: { children: ReactNode }) => {
        const Inner = inner;
        return (
          <Intl>
            <Inner>{children}</Inner>
          </Intl>
        );
      }
    : Intl;
  return rtlRenderHook(hook, { ...rest, wrapper: Wrapper } as RenderHookOptions<Props>);
}
