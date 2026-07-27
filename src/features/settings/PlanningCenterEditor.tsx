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
import { savePlanningCenterConfig, type PcoConfigDraft } from '@/services/planningCenter';
import type { PcoEffectiveSettings, PcoWriteBackMode } from '@/types';

const WRITE_BACK_HINT: Record<PcoWriteBackMode, string> = {
  off: 'Tally never writes to Planning Center. Visitors added at the door stay queued until this is turned on.',
  create: 'Tally creates people it has not seen before, after searching for a match. It never edits an existing person.',
  full: 'Tally creates people, updates first name, last name, grade and medical notes on the people it created or linked, and lets a leader add a parent contact to an adult already in the household. It never creates a parent or a household, and never overwrites a number on file.',
};

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
      setError(cause instanceof Error ? cause.message : 'Could not save these settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Planning Center settings"
      description="Everything except the credentials. Changes apply to every counselor's next read."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? <ErrorBanner message={error} /> : null}

        <div>
          <div className="grid grid-cols-2 gap-3">
            <NumberStepperField
              label="Lowest grade"
              min={6}
              max={12}
              value={draft.minGrade}
              onValueChange={(value) => set('minGrade', value)}
            />
            <NumberStepperField
              label="Highest grade"
              min={6}
              max={12}
              value={draft.maxGrade}
              onValueChange={(value) => set('maxGrade', value)}
              error={draft.maxGrade < draft.minGrade ? 'Cannot end below where it starts.' : null}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            Who is on the roster is decided on the Students screen, one student at a time. This band
            only says where a student Planning Center has no grade for lands, and it is the range the
            app understands at all.
          </p>
        </div>

        <SelectField
          label="Write-back"
          value={draft.writeBack}
          onChange={(event) => set('writeBack', event.target.value as PcoWriteBackMode)}
          hint={WRITE_BACK_HINT[draft.writeBack]}
        >
          <option value="off">Off — never change anything</option>
          <option value="create">Create new people only</option>
          <option value="full">Create and update managed fields</option>
        </SelectField>

        <NumberStepperField
          label="Reuse an answer for (seconds)"
          min={0}
          max={MAX_CACHE_TTL}
          value={draft.cacheTtlSeconds}
          onValueChange={(value) => set('cacheTtlSeconds', value)}
          hint={
            draft.cacheTtlSeconds === 0
              ? 'Off. Every screen asks Planning Center directly — slower, and always current.'
              : `Eight counselors opening Tally in the same minute cost one read instead of eight. A name corrected in Planning Center appears within ${draft.cacheTtlSeconds} seconds.`
          }
        />

        {isAdmin ? (
          <TextField
            label="API address"
            value={draft.baseUrl}
            onChange={(event) => set('baseUrl', event.target.value)}
            placeholder={settings.baseUrl}
            hint={`Leave empty to use whatever the deploy configured — currently ${settings.baseUrl}. Every request carries this church's credentials, so any other address sends them somewhere else: set this only for a proxy you run, or a test rig.`}
          />
        ) : null}
      </div>
    </Modal>
  );
}
