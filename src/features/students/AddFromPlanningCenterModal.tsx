/**
 * Putting somebody from Planning Center onto the roster.
 *
 * This is what replaced pointing Tally at a Planning Center List. A List is
 * generated from filter rules, so a hand-picked roster could only be expressed
 * by inventing a custom field on every person in the church and filtering on
 * it — and the two students who make that necessary are exactly the ones a
 * grade filter gets wrong: the 5th grader who comes every week with an older
 * sibling, and the senior who graduated in May and still leads worship.
 *
 * So the search here is deliberately unfiltered. It shows what Planning Center
 * thinks — the grade, whether the person is flagged as a child — and lets the
 * leader decide, because they are the one who knows.
 *
 * Nothing about the person is stored. Adding writes a membership document whose
 * id says which Planning Center person it refers to; the name on this screen is
 * read live and thrown away.
 */
import { useEffect, useRef, useState } from 'react';
import { PlanningCenterErrorDetails } from '@/components/PlanningCenterErrorDetails';
import { Badge, Button, ErrorBanner, Modal, SkeletonRows, TextField } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { addRosterMember, importPlanningCenterList, searchPlanningCenterPeople } from '@/services/functions';
import { fetchPlanningCenterLists } from '@/services/planningCenter';
import { pcoErrorReport } from '@/lib/pcoErrors';
import { gradeDescription } from '@/lib/grades';
import { cn } from '@/lib/utils';
import {
  BACKEND_LABELS,
  parseStudentId,
  type BackendId,
  type PcoErrorReport,
  type PcoList,
  type PcoPersonSearchResult,
} from '@/types';
import { useTranslations } from 'use-intl';
import { useGrades } from '@/hooks/usePureStrings';

/** Which backend a search row came from; every row can say. */
function backendOf(person: PcoPersonSearchResult): BackendId {
  return person.backendId ?? parseStudentId(person.id)?.backendId ?? 'pco';
}

/** Long enough that a typed name is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

export interface AddFromPlanningCenterModalProps {
  open: boolean;
  onClose: () => void;
  /** Student ids already on the roster, so the list can say so. */
  onRoster: ReadonlySet<string>;
}

export function AddFromPlanningCenterModal({
  open,
  onClose,
  onRoster,
}: AddFromPlanningCenterModalProps) {
  const t = useTranslations('AddStudent');
  const grades = useGrades();
  const { show } = useToast();
  const { refreshRoster, rosterBackends } = useData();

  /*
   * More than one backend serving the roster changes the words on this screen:
   * a row has to say where its person lives, and "Planning Center" stops being
   * the name for everything. The roster's own per-backend report is the source
   * — it lists exactly the enabled backends, and it is already here.
   */
  const multiBackend = rosterBackends.length >= 2;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PcoPersonSearchResult[] | null>(null);
  /** Backends the last search could not reach — a note, not a failure. */
  const [searchDown, setSearchDown] = useState<string[]>([]);
  /*
   * The failure itself rather than a sentence about it. Every one of these
   * four calls goes through a Cloud Function to Planning Center, so when one
   * breaks the useful question is which request got what back — and that only
   * survives if the whole report is kept. See src/lib/pcoErrors.ts.
   */
  const [error, setError] = useState<PcoErrorReport | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  /** Added in this session, so a row can say so before the roster catches up. */
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  const [showImport, setShowImport] = useState(false);
  const [lists, setLists] = useState<PcoList[] | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setSearchDown([]);
      setError(null);
      setAdded(new Set());
      setShowImport(false);
      setLists(null);
    }
  }, [open]);

  const latestQuery = useRef(query);
  latestQuery.current = query;

  useEffect(() => {
    if (!open) return;
    const search = query.trim();
    if (!search) {
      setResults(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setError(null);
      searchPlanningCenterPeople({ query: search })
        .then((response) => {
          // A slow answer to an old query must not overwrite a fast answer to
          // the current one.
          if (!cancelled && latestQuery.current.trim() === search) {
            setResults(response.data.people);
            // A backend that could not be searched is a note over real
            // results, not a failure: the other backends answered.
            setSearchDown(
              (response.data.perBackend ?? [])
                .filter((entry) => !entry.ok)
                .map((entry) => entry.displayName),
            );
          }
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setResults([]);
          setSearchDown([]);
          setError(pcoErrorReport(cause, t('searchFailed')));
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, t]);

  const add = async (person: PcoPersonSearchResult) => {
    setAddingId(person.pcoPersonId);
    setError(null);
    try {
      const response = await addRosterMember({
        pcoPersonId: person.pcoPersonId,
        backendId: backendOf(person),
      });
      setAdded((current) => new Set(current).add(person.id));
      show(
        response.data.status === 'restored'
          ? t('backOnRoster', { name: `${person.firstName} ${person.lastName}` })
          : t('added', { name: `${person.firstName} ${person.lastName}` }),
        { tone: 'success' },
      );
      // The roster's cache key is the membership, so this comes back changed.
      await refreshRoster(true);
    } catch (cause) {
      setError(pcoErrorReport(cause, t('addFailed')));
    } finally {
      setAddingId(null);
    }
  };

  const openImport = async () => {
    setShowImport(true);
    setError(null);
    try {
      setLists(await fetchPlanningCenterLists());
    } catch (cause) {
      setLists([]);
      setError(pcoErrorReport(cause, t('listsFailed')));
    }
  };

  const runImport = async (list: PcoList) => {
    setImportingId(list.id);
    setError(null);
    try {
      const { data } = await importPlanningCenterList({ listId: list.id });
      show(
        data.added + data.restored === 0
          ? t('allAlreadyOn', { list: list.name })
          : t('importedCount', {
              added: data.added + data.restored,
              total: data.total,
              list: list.name,
            }),
        { tone: 'success' },
      );
      await refreshRoster(true);
    } catch (cause) {
      setError(pcoErrorReport(cause, t('importFailed')));
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={multiBackend ? t('titleMulti') : t('titlePco')}
      description={
        multiBackend
          ? t('descriptionMulti')
          : t('descriptionPco')
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <ErrorBanner
            message={error.message}
            details={<PlanningCenterErrorDetails report={error} />}
          />
        ) : null}

        <TextField
          label={multiBackend ? t('searchLabelMulti') : t('searchLabelPco')}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        {searchDown.length > 0 && query.trim() ? (
          <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
            {searchDown.join(' and ')} could not be searched just now — these results are from the
            rest.
          </p>
        ) : null}

        {!query.trim() ? (
          <p className="px-1 text-sm text-ink-500">
            {multiBackend
              ? t('anyoneMulti')
              : t('anyonePco')}
          </p>
        ) : results === null ? (
          <SkeletonRows count={3} />
        ) : results.length === 0 ? (
          <p className="px-1 text-sm text-ink-400">
            {multiBackend
              ? t('noMatchMulti', { query })
              : t('noMatchPco', { query })}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {results.map((person) => {
              const already = onRoster.has(person.id) || added.has(person.id);
              const backendName = BACKEND_LABELS[backendOf(person)];
              return (
                <li key={person.id}>
                  <div
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-xl px-3 py-2 ring-1',
                      already ? 'bg-brand-500/10 ring-brand-500/25' : 'bg-ink-900 ring-ink-800',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-ink-100">
                        <span className="truncate">
                          {person.firstName} {person.lastName}
                        </span>
                        {/*
                          Which system holds them — shown only once there is
                          more than one it could be. The same person can exist
                          in both, and the row a leader picks decides which
                          record the roster follows.
                        */}
                        {multiBackend ? <Badge tone="neutral">{backendName}</Badge> : null}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {person.grade === null
                          ? t('noGradeIn', { backend: backendName })
                          : gradeDescription(grades, person.grade)}
                        {person.child ? '' : ' · not marked as a child'}
                        {person.status === 'inactive' ? t('inactiveIn', { backend: backendName }) : ''}
                      </span>
                    </span>

                    {already ? (
                      <Badge tone="success">{t('onTheRoster')}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        loading={addingId === person.pcoPersonId}
                        onClick={() => void add(person)}
                      >
                        {t('add')}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/*
          The way across for a church that was running Tally on a Planning
          Center list, and a shortcut for one that keeps a list for its own
          reasons. Deliberately a copy: a list is a saved *query*, so its
          membership moves whenever a grade rolls over or somebody edits a rule
          — which is exactly why it makes a poor roster and a fine starting
          point.
        */}
        <div className="border-t border-ink-800 pt-4">
          {!showImport ? (
            <button
              type="button"
              onClick={() => void openImport()}
              className="text-sm font-medium text-brand-300 underline underline-offset-4"
            >
              {t('importListLink')}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-300">
                Import a list, once. Everyone on it today joins the roster; nothing stays linked, so
                a rule change upstream will not quietly add or drop a student later.
              </p>

              {lists === null ? (
                <SkeletonRows count={2} />
              ) : lists.length === 0 ? (
                <p className="text-sm text-ink-400">{t('noLists')}</p>
              ) : (
                <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                  {lists.map((list) => (
                    <li
                      key={list.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-ink-900 px-3 py-2 ring-1 ring-ink-800"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink-100">
                          {list.name}
                        </span>
                        <span className="block text-xs text-ink-500">
                          {list.totalPeople === null
                            ? t('noCount')
                            : t('peopleCount', { count: list.totalPeople })}
                          {list.invalid ? t('rulesBroken') : ''}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={importingId === list.id}
                        onClick={() => void runImport(list)}
                      >
                        Import
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
