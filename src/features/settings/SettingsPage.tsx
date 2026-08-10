/**
 * The core team's control panel: prediction thresholds, appearance and the
 * people-backend connections.
 *
 * Two things have left this page for screens of their own, for the same reason
 * both times — a card here is read after every card above it. Who is on the
 * team is `TeamPage`; the lobby kiosk is `KioskPage`, and that one was worse
 * than buried, because this page is core-team only and pairing a kiosk is not.
 *
 * The thresholds are the only genuinely dangerous controls here — they silently
 * reshape what every counselor sees at the door — so each one is followed by a
 * plain-language sentence that restates the setting as the behaviour it causes.
 * Nobody should have to reason about "minAttended of ofLastN" at 6:55pm.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  CardHeader,
  ErrorBanner,
  LoadingScreen,
  NumberStepperField,
} from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { BackendsSection } from '@/features/settings/BackendsSection';
import { PlanningCenterCard } from '@/features/settings/PlanningCenterCard';
import { ThemeCard } from '@/features/settings/ThemeCard';
import { ThresholdPreview } from '@/features/settings/ThresholdPreview';
import { formatRelative } from '@/lib/time';
import { saveSettings } from '@/services/events';
import type { AppSettings } from '@/types';

/** Widest sensible window; matches the clamp in `toSettings`. */
const MAX_WINDOW = 12;

const DAY_PLURALS = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

type ThresholdForm = Pick<
  AppSettings,
  'predictiveMinAttended' | 'predictiveOfLastN' | 'miaConsecutiveMisses' | 'newVisitorWindowDays'
>;

function toForm(settings: AppSettings): ThresholdForm {
  return {
    predictiveMinAttended: settings.predictiveMinAttended,
    predictiveOfLastN: settings.predictiveOfLastN,
    miaConsecutiveMisses: settings.miaConsecutiveMisses,
    newVisitorWindowDays: settings.newVisitorWindowDays,
  };
}

export function SettingsPage() {
  const { settings, series, loading } = useData();
  const { user } = useAuth();
  const { show } = useToast();

  const [form, setForm] = useState<ThresholdForm>(() => toForm(settings));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Settings are live for everyone: if another leader saves while this form is
  // open, their values win rather than being silently overwritten on save.
  useEffect(() => setForm(toForm(settings)), [settings]);

  const errors = {
    predictiveOfLastN:
      form.predictiveOfLastN < 1 || form.predictiveOfLastN > MAX_WINDOW
        ? `Between 1 and ${MAX_WINDOW}.`
        : null,
    predictiveMinAttended:
      form.predictiveMinAttended < 1
        ? 'At least 1.'
        : form.predictiveMinAttended > form.predictiveOfLastN
          ? 'Cannot ask for more gatherings than the window holds.'
          : null,
    miaConsecutiveMisses: form.miaConsecutiveMisses < 1 ? 'At least 1.' : null,
    newVisitorWindowDays: form.newVisitorWindowDays < 1 ? 'At least 1.' : null,
  };
  const valid = Object.values(errors).every((error) => error === null);
  const dirty = (Object.keys(form) as (keyof ThresholdForm)[]).some(
    (key) => form[key] !== settings[key],
  );

  const setNumber = (field: keyof ThresholdForm) => (value: number) => {
    setForm((current) => ({ ...current, [field]: Number.isFinite(value) ? value : 0 }));
  };

  // A concrete day name beats "gatherings": the sentence should read the way a
  // leader would say it out loud.
  const anchor = series.find((candidate) => candidate.active) ?? series[0] ?? null;
  const cadence = anchor ? (DAY_PLURALS[anchor.dayOfWeek] ?? 'gatherings') : 'gatherings';

  const handleSave = async () => {
    if (!user || !valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveSettings(form, user.uid);
      show('Settings saved', { tone: 'success' });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save these settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen message="Loading settings…" />;

  return (
    <PageFrame>
      <header>
        <h1 className="text-xl font-bold text-ink-50">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Thresholds and connections apply to every counselor's phone immediately. Appearance is
          yours alone. Who may sign in lives on{' '}
          <Link
            to="/team"
            className="font-semibold text-brand-300 underline-offset-2 hover:underline"
          >
            Team
          </Link>
          , and the lobby screen on{' '}
          <Link
            to="/pair-kiosk"
            className="font-semibold text-brand-300 underline-offset-2 hover:underline"
          >
            Kiosk
          </Link>
          .
        </p>
      </header>

      <Card>
        <CardHeader
          title="Predictive roster"
          description="Who lands in the “Recent” block at the top of a check-in screen."
        />

        <div className="flex flex-col gap-4 px-4 py-3">
          {saveError ? <ErrorBanner message={saveError} /> : null}

          {/* Wide screens get the controls and their consequences side by side,
              so the count moves in the same glance as the number that changed.
              Stacked below `lg`, where a second column would squeeze both. */}
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-6">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <NumberStepperField
                  label="Attended at least"
                  min={1}
                  max={MAX_WINDOW}
                  value={form.predictiveMinAttended}
                  onValueChange={setNumber('predictiveMinAttended')}
                  error={errors.predictiveMinAttended}
                />
                <NumberStepperField
                  label="Of the last"
                  min={1}
                  max={MAX_WINDOW}
                  value={form.predictiveOfLastN}
                  onValueChange={setNumber('predictiveOfLastN')}
                  error={errors.predictiveOfLastN}
                />
              </div>

              <p
                aria-live="polite"
                className="rounded-xl bg-brand-500/10 px-3 py-2 text-sm text-brand-200 ring-1 ring-brand-500/25"
              >
                Show students who came to at least{' '}
                <span className="font-bold tabular-nums">{form.predictiveMinAttended}</span> of the
                last <span className="font-bold tabular-nums">{form.predictiveOfLastN}</span>{' '}
                {cadence}.
                <span className="mt-1 block text-xs text-brand-200/70">
                  Each series counts only its own history — Friday never predicts Sunday. A
                  brand-new series relaxes the threshold to whatever history exists, so the block is
                  never empty for the wrong reason.
                </span>
              </p>

              <div className="grid grid-cols-2 gap-3">
                <NumberStepperField
                  label="MIA after misses"
                  min={1}
                  max={99}
                  value={form.miaConsecutiveMisses}
                  onValueChange={setNumber('miaConsecutiveMisses')}
                  error={errors.miaConsecutiveMisses}
                  hint={`Flag a student after ${Math.max(1, form.miaConsecutiveMisses)} missed ${
                    form.miaConsecutiveMisses === 1 ? 'gathering' : 'gatherings'
                  } in a row.`}
                />
                <NumberStepperField
                  label="New visitor window (days)"
                  min={1}
                  max={365}
                  value={form.newVisitorWindowDays}
                  onValueChange={setNumber('newVisitorWindowDays')}
                  error={errors.newVisitorWindowDays}
                  hint={`A first-timer stays on the “New faces” list for ${Math.max(
                    1,
                    form.newVisitorWindowDays,
                  )} days.`}
                />
              </div>
            </div>

            <div className="lg:sticky lg:top-4">
              <ThresholdPreview draft={form} saved={settings} valid={valid} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void handleSave()} loading={saving} disabled={!dirty || !valid}>
              Save thresholds
            </Button>
            <span className="text-xs text-ink-500">
              {dirty
                ? 'Unsaved changes.'
                : settings.updatedAt
                  ? `Last changed ${formatRelative(settings.updatedAt)}.`
                  : 'Using the built-in defaults.'}
            </span>
          </div>
        </div>
      </Card>

      <ThemeCard />

      <PlanningCenterCard />

      <BackendsSection />
    </PageFrame>
  );
}
