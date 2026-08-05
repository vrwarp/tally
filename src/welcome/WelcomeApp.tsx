/**
 * Registering the family from a parent's own phone.
 *
 * The same three questions per child the kiosk wizard asks, on the device the
 * parent is already holding — their keyboard, their autocorrect, and the queue
 * behind them does not have to watch somebody hunt for a hyphen. It is reached
 * by scanning the QR on the kiosk, and it can only be reached that way: the
 * code in the URL is minted by a kiosk, lives twenty minutes, and carries a cap
 * on how many families may come through it.
 *
 * Two differences from the wizard, both deliberate:
 *
 *   - **It checks nobody in.** A form on a phone cannot know the family walked
 *     into the room. They register here and tap their own children through at
 *     the kiosk, which is the same act every other family performs — and the
 *     last screen says so, because the kiosk holds its roster in local storage
 *     and needs the "I've registered" tap to go and look again.
 *   - **It may ask about allergies.** Only where there is an upstream record to
 *     put a medical note on, and it is never stored in Tally or shown on any
 *     lobby screen — it goes to the church's own database and stays there.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, PhoneField, SelectField, TextField } from '@/components/ui';
import { gradeDescription, NO_GRADE } from '@/lib/utils';
import { GRADES, type Grade, type RegisterFamilyResult } from '@/types';
import { registerFamily, validateCode, type CodeCheck } from './services';

/** Mirrors the server's cap, so the button disappears before a refusal does. */
const MAX_CHILDREN = 6;

interface ChildDraft {
  firstName: string;
  lastName: string;
  grade: Grade | null;
  allergies: string;
}

function emptyChild(lastName = ''): ChildDraft {
  return { firstName: '', lastName, grade: null, allergies: '' };
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'no-code' }
  | { kind: 'dead'; message: string }
  | { kind: 'form' }
  | { kind: 'saving' }
  | { kind: 'done'; last4: string; names: string[] }
  | { kind: 'refused'; message: string };

/**
 * Minted once for the life of the page, so a double-tap on a slow connection
 * cannot register the family twice — the callable recognises the second call as
 * a retry of the first.
 */
function newRegistrationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function WelcomeApp() {
  const code = useMemo(() => new URLSearchParams(window.location.search).get('c')?.trim() ?? '', []);
  const registrationId = useMemo(newRegistrationId, []);

  const [phase, setPhase] = useState<Phase>(() => (code ? { kind: 'checking' } : { kind: 'no-code' }));
  const [check, setCheck] = useState<CodeCheck>({ valid: false, allergiesSupported: false });
  const [children, setChildren] = useState<ChildDraft[]>([emptyChild()]);
  const [guardian, setGuardian] = useState({ firstName: '', lastName: '', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    void validateCode(code).then((result) => {
      if (cancelled) return;
      setCheck(result);
      setPhase(
        result.valid
          ? { kind: 'form' }
          : {
              kind: 'dead',
              message:
                result.reason === 'exhausted'
                  ? 'That code has been used too many times.'
                  : 'That code has expired.',
            },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const updateChild = (index: number, patch: Partial<ChildDraft>) => {
    setChildren((held) => held.map((child, at) => (at === index ? { ...child, ...patch } : child)));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found: Record<string, string> = {};
    children.forEach((child, index) => {
      if (!child.firstName.trim()) found[`child-${index}-first`] = 'Required';
      if (!child.lastName.trim()) found[`child-${index}-last`] = 'Required';
    });
    if (!guardian.firstName.trim()) found['guardian-first'] = 'Required';
    if (!guardian.lastName.trim()) found['guardian-last'] = 'Required';
    if (guardian.phone.replace(/\D/g, '').length !== 10) {
      found['guardian-phone'] = 'Enter a 10-digit number';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPhase({ kind: 'saving' });
    void registerFamily({
      registrationId,
      code,
      children: children.map((child) => ({
        firstName: child.firstName.trim(),
        lastName: child.lastName.trim(),
        grade: child.grade,
      })),
      guardian: {
        firstName: guardian.firstName.trim(),
        lastName: guardian.lastName.trim(),
        phone: guardian.phone.replace(/\D/g, ''),
      },
      // Only where the field was offered; the server refuses it otherwise.
      ...(check.allergiesSupported
        ? { allergies: children.map((child) => child.allergies.trim() || null) }
        : {}),
    })
      .then((result: RegisterFamilyResult) => {
        if (result.status === 'duplicate') {
          setPhase({ kind: 'refused', message: result.message });
          return;
        }
        setPhase({
          kind: 'done',
          last4: result.last4,
          names: result.children.map((child) => child.firstName),
        });
      })
      .catch((error: { message?: string }) => {
        setPhase({
          kind: 'refused',
          message:
            error?.message?.replace(/^[a-z-]+: /i, '') ??
            'We could not save that. Please see a leader at the kiosk.',
        });
      });
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 px-5 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-ink-900">Welcome!</h1>
        <p className="pt-1 text-base text-ink-600">
          Tell us who is with you today and we will have them ready at the check-in screen.
        </p>
      </header>

      {phase.kind === 'checking' && <p className="text-center text-ink-500">One moment…</p>}

      {phase.kind === 'no-code' && (
        <Notice
          title="Scan the code at the kiosk"
          body="This page is opened by scanning the QR code on the check-in screen in the lobby."
        />
      )}

      {phase.kind === 'dead' && (
        <Notice
          title={phase.message}
          body="Codes are short-lived on purpose. Scan the one showing on the kiosk now, or register right there — it takes about a minute."
        />
      )}

      {phase.kind === 'refused' && (
        <Notice title="We could not finish that" body={phase.message} />
      )}

      {phase.kind === 'done' && (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-present-50 p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-present-100 text-3xl">
            ✓
          </div>
          <p className="text-xl font-semibold text-ink-900">
            {phase.names.join(' and ')} {phase.names.length === 1 ? 'is' : 'are'} registered.
          </p>
          {/*
            * The two-step ending, and the order matters.
            *
            * The kiosk searches a copy of the roster it keeps on the device and
            * refreshes on its own slow schedule, so it does not know about this
            * family yet. The button on its screen is what makes it go and look.
            * Telling somebody to type their digits without that first is telling
            * them to watch a screen say "no match".
            */}
          <p className="text-lg text-ink-700">
            At the kiosk, tap <strong>&ldquo;I&rsquo;ve registered&rdquo;</strong>, then type the
            last 4 digits of your phone:
          </p>
          <p className="text-4xl font-semibold tracking-[0.3em] text-ink-900">{phase.last4}</p>
          <p className="text-base text-ink-600">
            That is how you will check in every week from now on.
          </p>
        </div>
      )}

      {(phase.kind === 'form' || phase.kind === 'saving') && (
        <form className="flex flex-col gap-6" onSubmit={submit}>
          {children.map((child, index) => (
            <fieldset key={index} className="flex flex-col gap-3 rounded-2xl border border-ink-200 p-4">
              <legend className="px-1 text-sm font-semibold text-ink-600">
                {children.length === 1 ? 'Your child' : `Child ${index + 1}`}
              </legend>
              <TextField
                label="First name"
                required
                autoComplete="off"
                value={child.firstName}
                error={errors[`child-${index}-first`]}
                onChange={(event) => updateChild(index, { firstName: event.target.value })}
              />
              <TextField
                label="Last name"
                required
                autoComplete="off"
                value={child.lastName}
                error={errors[`child-${index}-last`]}
                onChange={(event) => updateChild(index, { lastName: event.target.value })}
              />
              <SelectField
                label="Grade"
                value={child.grade === null ? '' : String(child.grade)}
                onChange={(event) =>
                  updateChild(index, {
                    grade: event.target.value === '' ? null : (Number(event.target.value) as Grade),
                  })
                }
              >
                {/* Not a blank waiting to be filled in: a child too young for a
                    grade genuinely has none, and that is an answer. */}
                <option value="">{NO_GRADE}</option>
                {GRADES.map((grade) => (
                  <option key={grade} value={grade}>
                    {gradeDescription(grade)}
                  </option>
                ))}
              </SelectField>
              {check.allergiesSupported && (
                <TextField
                  label="Allergies"
                  hint="Optional. Goes to the church office, and is never shown on the lobby screen."
                  maxLength={200}
                  value={child.allergies}
                  onChange={(event) => updateChild(index, { allergies: event.target.value })}
                />
              )}
            </fieldset>
          ))}

          {children.length < MAX_CHILDREN && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                // The surname carried forward, which is right far more often
                // than not and one edit away when it is not.
                setChildren((held) => [...held, emptyChild(held[held.length - 1]?.lastName ?? '')])
              }
            >
              Add another child
            </Button>
          )}

          <fieldset className="flex flex-col gap-3 rounded-2xl border border-ink-200 p-4">
            <legend className="px-1 text-sm font-semibold text-ink-600">And you</legend>
            <TextField
              label="Your first name"
              required
              autoComplete="given-name"
              value={guardian.firstName}
              error={errors['guardian-first']}
              onChange={(event) => setGuardian((held) => ({ ...held, firstName: event.target.value }))}
            />
            <TextField
              label="Your last name"
              required
              autoComplete="family-name"
              value={guardian.lastName}
              error={errors['guardian-last']}
              onChange={(event) => setGuardian((held) => ({ ...held, lastName: event.target.value }))}
            />
            <PhoneField
              label="Your phone number"
              required
              hint="This is how you check in at the kiosk from now on."
              autoComplete="tel"
              value={guardian.phone}
              error={errors['guardian-phone']}
              onValueChange={(value) => setGuardian((held) => ({ ...held, phone: value }))}
            />
          </fieldset>

          <Button type="submit" disabled={phase.kind === 'saving'}>
            {phase.kind === 'saving' ? 'Saving…' : 'Register'}
          </Button>
        </form>
      )}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-ink-100 p-5 text-center">
      <p className="text-lg font-semibold text-ink-900">{title}</p>
      <p className="text-base text-ink-600">{body}</p>
    </div>
  );
}
