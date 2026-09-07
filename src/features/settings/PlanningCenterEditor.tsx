/**
 * The Planning Center connection, as settings a leader can change.
 *
 * Much smaller than it was, because most of what used to be here was about
 * *which list is the roster* — and a Planning Center List turned out to be the
 * wrong tool for the job. A List is generated from filter rules, so a
 * hand-picked roster was only expressible by inventing a custom field on every
 * person in the church and filtering on it. The roster now lives in Tally,
 * where somebody can just put a student on it, and this screen is left with the
 * things that genuinely are Planning Center's business: how much Tally may
 * write back, how long a read may be reused, and where the API lives.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  ErrorBanner,
  Modal,
  NumberStepperField,
  SelectField,
  TextField,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { gradeDescription } from '@/lib/utils';
import { savePlanningCenterConfig, type PcoConfigDraft } from '@/services/planningCenter';
import { GRADES, type PcoEffectiveSettings, type PcoWriteBackMode } from '@/types';
import { useTranslations } from 'use-intl';

const WRITE_BACK_HINT = {
  off: 'pcoWriteHintOff',
  create: 'pcoWriteHintCreate',
  full: 'pcoWriteHintFull',
} as const satisfies Record<PcoWriteBackMode, string>;

/** A cache measured in minutes stops being a cache and starts being a mirror. */
const MAX_CACHE_TTL = 300;

/**
 * Every field is filled from the configuration in force — except the API
 * address, which is filled from what is *stored*.
 *
 * For the others, saving the effective value is exactly right: it pins what is
 * already happening, and a leader who opens the editor and presses Save changes
 * nothing. The address cannot work that way. Only an admin may introduce one,
 * so a core-team member whose form carried the effective address — a deployed
 * proxy, say — would be submitting an address they never typed, and every save
 * they made would be refused for a field they cannot even see.
 */
function toDraft(settings: PcoEffectiveSettings, storedBaseUrl: string): PcoConfigDraft {
  return {
    minGrade: settings.minGrade,
    maxGrade: settings.maxGrade,
    writeBack: settings.writeBack,
    cacheTtlSeconds: settings.cacheTtlSeconds,
    baseUrl: storedBaseUrl,
  };
}

export interface PlanningCenterEditorProps {
  open: boolean;
  settings: PcoEffectiveSettings;
  /** The saved API-root override — empty when the deploy still decides it. */
  storedBaseUrl: string;
  onClose: () => void;
  /** Called after a successful save, so the card can re-check the connection. */
  onSaved: () => void | Promise<void>;
}

export function PlanningCenterEditor({
  open,
  settings,
  storedBaseUrl,
  onClose,
  onSaved,
}: PlanningCenterEditorProps) {
  const t = useTranslations('Backends');
  const tCommon = useTranslations('Common');
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [draft, setDraft] = useState<PcoConfigDraft>(() => toDraft(settings, storedBaseUrl));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Reopening has to show what is in force *now* — a leader who cancelled, went
   * and fixed something in Planning Center, and came back would otherwise be
   * editing the draft they abandoned.
   *
   * Only on *opening*, though. The card re-checks the connection in the
   * background, which hands down a new settings object each time; resetting on
   * that would wipe half-made edits under the person making them.
   */
  const latest = useRef({ settings, storedBaseUrl });
  latest.current = { settings, storedBaseUrl };

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(latest.current.settings, latest.current.storedBaseUrl));
    setError(null);
  }, [open]);

  const set = <K extends keyof PcoConfigDraft>(key: K, value: PcoConfigDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!user || saving) return;
    setSaving(true);
    setError(null);
    try {
      await savePlanningCenterConfig(
        {
          ...draft,
          // A band that crossed over would be clamped server-side anyway;
          // fixing it here means the number a leader sees is the number saved.
          maxGrade: Math.max(draft.minGrade, draft.maxGrade),
          baseUrl: draft.baseUrl.trim(),
        },
        user.uid,
      );
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('editorSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pcoEditorTitle')}
      description="Everything except the credentials. Changes apply to every counselor's next read."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {t('saveSettings')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? <ErrorBanner message={error} /> : null}

        <div>
          <div className="grid grid-cols-2 gap-3">
            {/*
              Named, not numbered. The two grades at the bottom of the scale are
              `0` and `-1`, and a stepper showing "-1" for Pre-K is the same
              thing the kiosk was doing wrong — a number standing where a name
              belongs. A select also refuses a value off the scale by
              construction, which the stepper's free-typed box did not.
            */}
            <SelectField
              label={t('lowestGrade')}
              value={String(draft.minGrade)}
              onChange={(event) => set('minGrade', Number(event.target.value))}
            >
              {GRADES.map((value) => (
                <option key={value} value={value}>
                  {gradeDescription(value)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t('highestGrade')}
              value={String(draft.maxGrade)}
              onChange={(event) => set('maxGrade', Number(event.target.value))}
              error={draft.maxGrade < draft.minGrade ? t('gradeRangeError') : null}
            >
              {GRADES.map((value) => (
                <option key={value} value={value}>
                  {gradeDescription(value)}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            {t('pcoGradeBandNote')}
          </p>
        </div>

        <SelectField
          label={t('headingWriteBack')}
          value={draft.writeBack}
          onChange={(event) => set('writeBack', event.target.value as PcoWriteBackMode)}
          hint={t(WRITE_BACK_HINT[draft.writeBack])}
        >
          <option value="off">{t('writeBackOff')}</option>
          <option value="create">{t('writeBackCreatePeople')}</option>
          <option value="full">{t('writeBackFull')}</option>
        </SelectField>

        <NumberStepperField
          label={t('cacheLabel')}
          min={0}
          max={MAX_CACHE_TTL}
          value={draft.cacheTtlSeconds}
          onValueChange={(value) => set('cacheTtlSeconds', value)}
          hint={
            draft.cacheTtlSeconds === 0
              ? t('pcoCacheHintOff')
              : t('pcoCacheHintOn', { seconds: draft.cacheTtlSeconds })
          }
        />

        {isAdmin ? (
          <TextField
            label={t('apiAddress')}
            value={draft.baseUrl}
            onChange={(event) => set('baseUrl', event.target.value)}
            placeholder={settings.baseUrl}
            hint={t('pcoApiAddressHint', { url: settings.baseUrl })}
          />
        ) : null}
      </div>
    </Modal>
  );
}
