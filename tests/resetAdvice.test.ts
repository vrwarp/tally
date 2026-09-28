/**
 * Nothing Tally says may send somebody to wipe a kiosk that is still holding
 * the morning.
 *
 * A lobby kiosk keeps every check-in and pickup on its own storage until it can
 * reach Tally (docs/kiosk-offline-recovery.md), which makes the tablet the only
 * copy of an outage's records — and a factory reset, a cleared site, a
 * reinstall or a re-enrolment the one act that can still lose them. Before the
 * journal existed, Tally itself recommended two of those: the Kiosk page's
 * footnote said to retire a kiosk by clearing its site data, and the tablet
 * guide put a laminated reset-and-scan card on the check-in desk.
 *
 * So the rule, as a sweep: a shipped string that mentions any of those acts
 * either forbids it or names the condition — the kiosk's own all-clear, quoted
 * — and the two pieces of old advice do not come back into the docs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { flatten, type Messages } from '@/lib/translationState';

const MESSAGES_DIR = path.join(process.cwd(), 'messages');
const DOCS_DIR = path.join(process.cwd(), 'docs');

const en = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, 'en.json'), 'utf8')) as Messages;
const enFlat = flatten(en);

/** The kiosk's all-clear — the words a person is told to wait for. */
const ALL_CLEAR = enFlat.get('Staff.checkInsAllIn')!;

const DESTRUCTIVE = /factory reset|\breset\b|\bwip(e|ing)\b|re-?install|uninstall|site data|re-?enrol/i;
const FORBIDDING = /\b(don[’']t|do not|never)\b/i;

describe('advice about wiping a kiosk', () => {
  it('knows the all-clear it quotes', () => {
    expect(ALL_CLEAR).toBe('All check-ins are in Tally');
  });

  it('is only ever a prohibition, or waits for the all-clear', () => {
    const unsafe = [...enFlat].filter(
      ([, value]) =>
        DESTRUCTIVE.test(value) && !value.includes(ALL_CLEAR) && !FORBIDDING.test(value),
    );
    expect(unsafe.map(([key, value]) => `${key}: ${value}`)).toEqual([]);
  });

  it('does not come back into the docs as the old advice', () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(DOCS_DIR).filter((name) => name.endsWith('.md'))) {
      // The proposal quotes the old advice in order to retire it.
      if (file === 'kiosk-offline-recovery.md') continue;
      const text = fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
      if (/clear the browser[’']s site data/i.test(text)) offenders.push(`${file}: clear the site data`);
      if (/laminated copy\s+at the check-in desk/i.test(text)) {
        offenders.push(`${file}: the reset card at the desk`);
      }
      if (/kiosk tablet holds nothing(?!\s+once\s+it\s+says)/i.test(text)) {
        offenders.push(`${file}: "a kiosk tablet holds nothing" without its condition`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
