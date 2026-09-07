/**
 * Every `t('…')` key, type-checked against the English catalogue.
 *
 * This is the single highest-value line in the i18n setup: a typo'd or deleted
 * key fails `npm run build` rather than rendering a key path on a leader's
 * screen. `en.json` is the source of truth for the key set, so the check is
 * automatically right — there is no second list to keep in step.
 */
import type en from '../../messages/en.json';
import type { LOCALES } from '@/lib/locales';

declare module 'use-intl' {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof en;
  }
}
