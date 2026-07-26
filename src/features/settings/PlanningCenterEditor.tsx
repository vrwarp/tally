/**
 * Changing where Tally reads its people from, without a deploy.
 *
 * These settings used to be deploy-time parameters, which made the most
 * commonly changed thing in the whole integration — *which list is the roster*
 * — the hardest one to change: a youth pastor who reorganised their lists in
 * September had to find whoever runs `firebase deploy`. Worse, the setting was
 * an id copied out of a browser address bar, so the failure mode was a roster
 * that silently described some other group of children.
 *
 * So the list is chosen from the lists themselves, with the two facts that
 * distinguish the right one from a plausible wrong one: how many people it
 * holds, and whether Planning Center has refreshed it this decade.
 *
 * Creating a list is not offered because Planning Center's API cannot do it —
 * `/lists` is read-only, and there is no way to add a person to one either.
 * Lists are built in People, which is where they should be built; this links
 * out and re-reads when the leader comes back.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  ErrorBanner,
  Modal,
  NumberStepperField,
  SelectField,
  SkeletonRows,
  TextField,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  fetchPlanningCenterLists,
  savePlanningCenterConfig,
  type PcoConfigDraft,
} from '@/services/planningCenter';
import type { PcoEffectiveSettings, PcoList, PcoRosterSource, PcoWriteBackMode } from '@/types';

/** Where a leader goes to build a list, since Tally cannot. */
const PCO_LISTS_URL = 'https://people.planningcenteronline.com/lists';

const SOURCE_HINT: Record<PcoRosterSource, string> = {
  list: 'Tally shows exactly who is on the list — including the 5th grader who comes with an older sibling, and the senior whose grade nobody filled in.',
  grade: 'Tally sweeps everyone marked as a child whose grade falls in the band below. Anybody with no grade at all is left out, and nothing says so.',
};

const WRITE_BACK_HINT: Record<PcoWriteBackMode, string> = {
  off: 'Tally never writes to Planning Center. Visitors added at the door stay queued until this is turned on.',
  create: 'Tally creates people it has not seen before, after searching for a match. It never edits an existing person.',
  full: 'Tally creates people, and updates first name, last name, grade and medical notes on the people it created or linked.',
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
    rosterSource: settings.rosterSource,
    studentListId: settings.studentListId ?? '',
    counselorListId: settings.counselorListId ?? '',
    minGrade: settings.minGrade,
    maxGrade: settings.maxGrade,
    writeBack: settings.writeBack,
    smallGroupField: settings.smallGroupField ?? '',
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

  const listMissing = draft.rosterSource === 'list' && draft.studentListId.trim() === '';
  const valid = !listMissing;

  const set = <K extends keyof PcoConfigDraft>(key: K, value: PcoConfigDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!user || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await savePlanningCenterConfig(
        {
          ...draft,
          // A band that crossed over would be clamped server-side anyway;
          // fixing it here means the number a leader sees is the number saved.
          maxGrade: Math.max(draft.minGrade, draft.maxGrade),
          studentListId: draft.studentListId.trim(),
          counselorListId: draft.counselorListId.trim(),
          smallGroupField: draft.smallGroupField.trim(),
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
      variant="centered"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} loading={saving} disabled={!valid}>
            Save settings
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? <ErrorBanner message={error} /> : null}

        <SelectField
          label="Where students come from"
          value={draft.rosterSource}
          onChange={(event) => set('rosterSource', event.target.value as PcoRosterSource)}
          hint={SOURCE_HINT[draft.rosterSource]}
        >
          <option value="list">A Planning Center list</option>
          <option value="grade">Grade fields on each person</option>
        </SelectField>

        {draft.rosterSource === 'list' ? (
          <ListPicker
            label="Student list"
            open={open}
            value={draft.studentListId}
            onChange={(id) => set('studentListId', id)}
            error={listMissing ? 'Choose the list that holds your students.' : null}
          />
        ) : null}

        <ListPicker
          label="Counselor list"
          description="Everyone on it with an email address may sign in to Tally. Leave it empty and Tally falls back to your Planning Center administrators."
          open={open}
          value={draft.counselorListId}
          onChange={(id) => set('counselorListId', id)}
          allowNone
        />

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
            {draft.rosterSource === 'list'
              ? 'In list mode the list decides who is on the roster. The band only says where a student with no grade of their own lands.'
              : 'Only students inside this band are read at all.'}
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

        <TextField
          label="Small-group custom field"
          value={draft.smallGroupField}
          onChange={(event) => set('smallGroupField', event.target.value)}
          placeholder="Small Group"
          hint="Name or slug of a Planning Center custom field holding a counselor's small group. Set it and Sunday School opens straight to their own group."
        />

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

/* -------------------------------------------------------------------------- */
/* The picker                                                                  */
/* -------------------------------------------------------------------------- */

interface ListPickerProps {
  label: string;
  description?: string;
  /** The modal's open state, so a closed editor holds no stale results. */
  open: boolean;
  value: string;
  error?: string | null;
  allowNone?: boolean;
  onChange: (listId: string) => void;
}

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * A list of lists, with the two facts that tell them apart.
 *
 * A dropdown of names would be prettier and would reintroduce the exact problem
 * this replaces: "Footprints Students" and "Footprints Camp 2019" are equally
 * plausible until you can see that one holds 47 people and refreshes itself,
 * and the other holds 12 and last ran in 2019.
 *
 * Searching goes to Planning Center rather than filtering what is already here.
 * A church that has used People for a decade can have hundreds of lists, and
 * filtering a truncated first page is the kind of search that quietly fails to
 * find the thing you are looking for.
 */
function ListPicker({
  label,
  description,
  open,
  value,
  error,
  allowNone,
  onChange,
}: ListPickerProps) {
  const [query, setQuery] = useState('');
  const [lists, setLists] = useState<PcoList[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const search = query.trim();
    const timer = setTimeout(
      () => {
        setFailure(null);
        fetchPlanningCenterLists(search || undefined)
          .then((result) => {
            if (!cancelled) setLists(result);
          })
          .catch((cause: unknown) => {
            if (cancelled) return;
            setLists([]);
            setFailure(
              cause instanceof Error ? cause.message : 'Could not read your Planning Center lists.',
            );
          });
      },
      // The first load should not sit behind a debounce nobody typed into.
      search ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, reloads]);

  const missing = value !== '' && query === '' && lists !== null && !lists.some((l) => l.id === value);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink-200">{label}</legend>
      {description ? <p className="-mt-1 text-xs text-ink-500">{description}</p> : null}

      <TextField
        label={`Search ${label.toLowerCase()}s`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search lists by name…"
      />

      {lists === null ? (
        <SkeletonRows count={3} />
      ) : (
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-xl bg-ink-900/60 p-1.5 ring-1 ring-ink-800">
          {allowNone && query === '' ? (
            <ListOption
              selected={value === ''}
              onSelect={() => onChange('')}
              name="No list"
              detail="Fall back to your Planning Center administrators."
            />
          ) : null}

          {lists.map((list) => (
            <ListOption
              key={list.id}
              selected={value === list.id}
              onSelect={() => onChange(list.id)}
              name={list.name}
              detail={describeList(list)}
              warn={list.invalid || isStale(list)}
            />
          ))}

          {lists.length === 0 ? (
            <p className="px-2 py-3 text-sm text-ink-400">
              {query
                ? `No list matches “${query}”.`
                : 'Planning Center returned no lists for this token.'}
            </p>
          ) : null}
        </div>
      )}

      {missing ? (
        <p className="text-xs text-warn-400">
          The list currently configured ({value}) was not among these. It may have been deleted, or
          this token may not be allowed to read it.
        </p>
      ) : null}

      {error ? <p className="text-xs text-danger-400">{error}</p> : null}
      {failure ? <p className="text-xs text-danger-400">{failure}</p> : null}

      <p className="text-xs text-ink-500">
        Lists are built in Planning Center — Tally can only choose among them.{' '}
        <a
          href={PCO_LISTS_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand-300 underline"
        >
          Open Lists ↗
        </a>{' '}
        <button
          type="button"
          onClick={() => setReloads((count) => count + 1)}
          className="font-medium text-brand-300 underline"
        >
          Reload
        </button>
      </p>
    </fieldset>
  );
}

interface ListOptionProps {
  selected: boolean;
  onSelect: () => void;
  name: string;
  detail: string;
  warn?: boolean;
}

function ListOption({ selected, onSelect, name, detail, warn }: ListOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left',
        selected ? 'bg-brand-500/15 ring-1 ring-brand-400' : 'hover:bg-ink-800/60',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink-100">{name}</span>
        <span className="block text-xs text-ink-500">{detail}</span>
      </span>
      {warn ? <Badge tone="warn">Check this</Badge> : null}
    </button>
  );
}

/** Six months without a refresh, on a list nobody has automated. */
const STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 180;

function isStale(list: PcoList): boolean {
  if (list.autoRefresh || !list.refreshedAt) return false;
  return Date.now() - list.refreshedAt.getTime() > STALE_AFTER_MS;
}

function describeList(list: PcoList): string {
  const parts: string[] = [];

  if (list.totalPeople !== null) {
    parts.push(`${list.totalPeople} ${list.totalPeople === 1 ? 'person' : 'people'}`);
  }
  if (list.invalid) {
    parts.push('Planning Center says its rules no longer work');
  } else if (list.autoRefresh) {
    parts.push('refreshes itself');
  } else if (list.refreshedAt) {
    parts.push(`last refreshed ${formatRelative(list.refreshedAt)}`);
  }

  return parts.join(' · ') || 'No details from Planning Center.';
}
