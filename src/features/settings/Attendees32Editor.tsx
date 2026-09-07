/**
 * The Attendees connection, as settings a leader can change.
 *
 * The `PlanningCenterEditor` pattern with Attendees' own vocabulary: instead
 * of "which list", the questions are which division, meet and character a
 * student belongs to — the coordinates every read and write in the adapter is
 * scoped by. The DRF token is not here; it lives in Secret Manager with the
 * other credentials.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  CheckboxField,
  ErrorBanner,
  Modal,
  NumberStepperField,
  SelectField,
  TextField,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { gradeDescription } from '@/lib/grades';
import {
  saveAttendees32Config,
  type A32ConfigDraft,
  type A32EffectiveSettings,
} from '@/services/backends';
import { GRADES, type PcoWriteBackMode } from '@/types';
import { useTranslations } from 'use-intl';
import { useGrades } from '@/hooks/usePureStrings';

const WRITE_BACK_HINT = {
  off: 'a32WriteHintOff',
  create: 'a32WriteHintCreate',
  full: 'a32WriteHintFull',
} as const satisfies Record<PcoWriteBackMode, string>;

/** Same ceiling as the Planning Center editor, for the same reason. */
const MAX_CACHE_TTL = 300;

/**
 * Every field is filled from the configuration in force — except the API
 * address, which is filled from what is *stored*. Same load-bearing
 * distinction as the Planning Center editor: only an admin may introduce an
 * address, so a core-team form carrying the effective one would submit a
 * field its owner never typed and be refused for it.
 */
function toDraft(settings: A32EffectiveSettings, storedBaseUrl: string): A32ConfigDraft {
  return {
    enabled: settings.enabled,
    baseUrl: storedBaseUrl,
    divisionId: settings.divisionId,
    meetSlug: settings.meetSlug,
    characterSlug: settings.characterSlug,
    assemblySlug: settings.assemblySlug,
    minGrade: settings.minGrade,
    maxGrade: settings.maxGrade,
    writeBack: settings.writeBack,
    cacheTtlSeconds: settings.cacheTtlSeconds,
  };
}

export interface Attendees32EditorProps {
  open: boolean;
  settings: A32EffectiveSettings;
  /** The saved API-root override — empty when the deploy still decides it. */
  storedBaseUrl: string;
  onClose: () => void;
  /** Called after a successful save, so the card can re-check the connection. */
  onSaved: () => void | Promise<void>;
}

export function Attendees32Editor({
  open,
  settings,
  storedBaseUrl,
  onClose,
  onSaved,
}: Attendees32EditorProps) {
  const t = useTranslations('Backends');
  const tCommon = useTranslations('Common');
  const grades = useGrades();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [draft, setDraft] = useState<A32ConfigDraft>(() => toDraft(settings, storedBaseUrl));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on opening only, exactly as the Planning Center editor does and for
  // the same two reasons: reopening must show what is in force now, and the
  // card's background re-checks must not wipe half-made edits.
  const latest = useRef({ settings, storedBaseUrl });
  latest.current = { settings, storedBaseUrl };

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(latest.current.settings, latest.current.storedBaseUrl));
    setError(null);
  }, [open]);

  const set = <K extends keyof A32ConfigDraft>(key: K, value: A32ConfigDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!user || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveAttendees32Config(
        {
          ...draft,
          divisionId: draft.divisionId.trim(),
          meetSlug: draft.meetSlug.trim(),
          characterSlug: draft.characterSlug.trim(),
          assemblySlug: draft.assemblySlug.trim(),
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
      title={t('a32EditorTitle')}
      description="Everything except the token. Changes apply to every counselor's next read."
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

        <CheckboxField
          label={t('connected')}
          checked={draft.enabled}
          onChange={(event) => set('enabled', event.target.checked)}
          hint={
            draft.enabled
              ? t('a32ConnectedHint')
              : t('a32DisconnectedHint')
          }
        />

        <div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('a32DivisionId')}
              value={draft.divisionId}
              onChange={(event) => set('divisionId', event.target.value)}
            />
            <TextField
              label={t('a32MeetSlug')}
              value={draft.meetSlug}
              onChange={(event) => set('meetSlug', event.target.value)}
            />
            <TextField
              label={t('a32CharacterSlug')}
              value={draft.characterSlug}
              onChange={(event) => set('characterSlug', event.target.value)}
            />
            <TextField
              label={t('a32AssemblySlug')}
              value={draft.assemblySlug}
              onChange={(event) => set('assemblySlug', event.target.value)}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            {t('a32SlugsNote')}
          </p>
        </div>

        <div>
          <div className="grid grid-cols-2 gap-3">
            {/* Named rather than numbered, for the reason the same pair of
                fields gives in PlanningCenterEditor: Pre-K is `-1`. */}
            <SelectField
              label={t('lowestGrade')}
              value={String(draft.minGrade)}
              onChange={(event) => set('minGrade', Number(event.target.value))}
            >
              {GRADES.map((value) => (
                <option key={value} value={value}>
                  {gradeDescription(grades, value)}
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
                  {gradeDescription(grades, value)}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            {t('a32GradeBandNote')}
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
              ? t('a32CacheHintOff')
              : t('a32CacheHintOn', { seconds: draft.cacheTtlSeconds })
          }
        />

        {isAdmin ? (
          <TextField
            label={t('apiAddress')}
            value={draft.baseUrl}
            onChange={(event) => set('baseUrl', event.target.value)}
            placeholder={settings.baseUrl || 'https://attendees.example.org'}
            hint={t('a32ApiAddressHint')}
          />
        ) : null}
      </div>
    </Modal>
  );
}
