/**
 * A printer note, in words.
 *
 * `printing/index.ts` runs outside React — it is imported by the label queue
 * and by the worker boundary — so it reports *which* sentence rather than the
 * sentence itself. See `PrinterNote` there for why, and for the two notes that
 * genuinely arrive as somebody else's words rather than as a key of ours.
 *
 * Its own module rather than a member of `hooks/usePureStrings.ts`: that file
 * is imported by the whole app, and a printer type has no business travelling
 * into a screen that has never heard of USB.
 */
import { useCallback } from 'react';
import { useTranslations } from 'use-intl';
import type { PrinterNote } from './printing';

export function usePrinterNote(): (note: PrinterNote | null | undefined) => string {
  const t = useTranslations('Printer');
  return useCallback((note) => (!note ? '' : 'key' in note ? t(note.key) : note.text), [t]);
}
