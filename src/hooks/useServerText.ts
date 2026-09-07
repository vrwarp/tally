/**
 * What the server said, in the reader's language.
 *
 * A callable answers in two ways and both reach a screen: it throws an
 * `HttpsError`, or it returns `{ status, message }`. Either way the sentence
 * was written in `functions/`, which has no catalogue — so it names the
 * sentence with a `ServerCode` and this says it. See `lib/serverCodes.ts`.
 *
 * The English the server sent is the fallback, not a mistake to hide: a client
 * older than a deploy meets a code it has never heard of, and one English
 * sentence is better than a key or a blank. `fallback` is the last resort under
 * that — for a network failure that never reached a function at all, and so
 * carries no sentence of its own.
 */
import { useCallback } from 'react';
import { useTranslations } from 'use-intl';
import { isServerText, type ServerText } from '@/lib/serverCodes';

/** The `details` of a thrown `HttpsError`, or the body of a returned outcome. */
function textOf(source: unknown): ServerText | null {
  if (isServerText(source)) return source;
  const details = (source as { details?: unknown } | null)?.details;
  return isServerText(details) ? details : null;
}

/** The English the server sent with it, if it sent any. */
function saidBy(source: unknown): string | null {
  const message = (source as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() !== '' ? message : null;
}

export function useServerText(): (source: unknown, fallback?: string) => string {
  const t = useTranslations('Errors');
  return useCallback(
    (source, fallback = '') => {
      const named = textOf(source);
      // The cast is where a bare string union meets a catalogue typed against
      // en.json; `tests/serverCodes.test.ts` is what keeps the two in step.
      if (named) return t(named.code as never, named.args as never);
      return saidBy(source) ?? fallback;
    },
    [t],
  );
}
