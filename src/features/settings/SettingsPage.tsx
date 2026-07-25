/**
 * The core team's control panel: prediction thresholds, the Planning Center
 * connection, who is on the team, and which small group you are teaching.
 *
 * The thresholds are the only genuinely dangerous controls here — they silently
 * reshape what every counselor sees at the door — so each one is followed by a
 * plain-language sentence that restates the setting as the behaviour it causes.
 * Nobody should have to reason about "minAttended of ofLastN" at 6:55pm.
 */
import { useEffect, useState, type ChangeEvent } from 'react';
import {
  Button,
  Card,
  CardHeader,
  ErrorBanner,
  LoadingScreen,
  SelectField,
  TextField,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { PlanningCenterCard } from '@/features/settings/PlanningCenterCard';
import { TeamList } from '@/features/settings/TeamList';
import { formatRelative } from '@/lib/time';
import { saveSettings } from '@/services/events';
import { setAssignedGroup } from '@/services/users';
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
  const { settings, groups, series, loading } = useData();
  const { user, profile } = useAuth();
  const { show } = useToast();

  const [form, setForm] = useState<ThresholdForm>(() => toForm(settings));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);

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

  const setNumber = (field: keyof ThresholdForm) => (changed: ChangeEvent<HTMLInputElement>) => {
    const value = Number(changed.target.value);
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

  const handleGroupChange = async (groupId: string) => {
    if (!user) return;
    setGroupBusy(true);
    try {
      await setAssignedGroup(user.uid, groupId || null);
      const name = groups.find((group) => group.id === groupId)?.name;
      show(name ? `You are teaching ${name}` : 'Small group cleared', { tone: 'success' });
    } catch {
      show('Could not save your small group.', { tone: 'error' });
    } finally {
      setGroupBusy(false);
    }
  };

  if (loading) return <LoadingScreen message="Loading settings…" />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
      <header>
        <h1 className="text-xl font-bold text-ink-50">Settings &amp; team</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Changes here apply to every counselor's phone immediately.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Predictive roster"
          description="Who lands in the “Recent” block at the top of a check-in screen."
        />

        <div className="flex flex-col gap-4 px-4 py-3">
          {saveError ? <ErrorBanner message={saveError} /> : null}

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Attended at least"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_WINDOW}
              value={form.predictiveMinAttended}
              onChange={setNumber('predictiveMinAttended')}
              error={errors.predictiveMinAttended}
            />
            <TextField
              label="Of the last"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_WINDOW}
              value={form.predictiveOfLastN}
              onChange={setNumber('predictiveOfLastN')}
              error={errors.predictiveOfLastN}
            />
          </div>

          <p
            aria-live="polite"
            className="rounded-xl bg-brand-500/10 px-3 py-2 text-sm text-brand-200 ring-1 ring-brand-500/25"
          >
            Show students who came to at least{' '}
            <span className="font-bold tabular-nums">{form.predictiveMinAttended}</span> of the last{' '}
            <span className="font-bold tabular-nums">{form.predictiveOfLastN}</span> {cadence}.
            <span className="mt-1 block text-xs text-brand-200/70">
              Each series counts only its own history — Friday never predicts Sunday. A brand-new
              series relaxes the threshold to whatever history exists, so the block is never empty
              for the wrong reason.
            </span>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="MIA after misses"
              type="number"
              inputMode="numeric"
              min={1}
              value={form.miaConsecutiveMisses}
              onChange={setNumber('miaConsecutiveMisses')}
              error={errors.miaConsecutiveMisses}
              hint={`Flag a student after ${Math.max(1, form.miaConsecutiveMisses)} missed ${
                form.miaConsecutiveMisses === 1 ? 'gathering' : 'gatherings'
              } in a row.`}
            />
            <TextField
              label="New visitor window (days)"
              type="number"
              inputMode="numeric"
              min={1}
              value={form.newVisitorWindowDays}
              onChange={setNumber('newVisitorWindowDays')}
              error={errors.newVisitorWindowDays}
              hint={`A first-timer stays on the “New faces” list for ${Math.max(
                1,
                form.newVisitorWindowDays,
              )} days.`}
            />
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

      <PlanningCenterCard />

      <TeamList />

      <Card>
        <CardHeader
          title="Your assignment"
          description="Which small group you are teaching this term."
        />
        <div className="flex flex-col gap-2 px-4 py-3">
          <SelectField
            label="My small group"
            value={profile?.assignedGroupId ?? ''}
            onChange={(changed) => void handleGroupChange(changed.target.value)}
            disabled={groupBusy}
            hint="Sunday School opens straight to this group instead of the whole ministry."
          >
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </SelectField>
        </div>
      </Card>
    </div>
  );
}
