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
import { ordinalGrade } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { PcoErrorReport, PcoList, PcoPersonSearchResult } from '@/types';

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
  const { show } = useToast();
  const { refreshRoster } = useData();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PcoPersonSearchResult[] | null>(null);
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
          }
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setResults([]);
          setError(pcoErrorReport(cause, 'Could not search Planning Center.'));
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const add = async (person: PcoPersonSearchResult) => {
    setAddingId(person.pcoPersonId);
    setError(null);
    try {
      const response = await addRosterMember({ pcoPersonId: person.pcoPersonId });
      setAdded((current) => new Set(current).add(person.id));
      show(
        response.data.status === 'restored'
          ? `${person.firstName} ${person.lastName} is back on the roster`
          : `${person.firstName} ${person.lastName} added`,
        { tone: 'success' },
      );
      // The roster's cache key is the membership, so this comes back changed.
      await refreshRoster(true);
    } catch (cause) {
      setError(pcoErrorReport(cause, 'Could not add that student.'));
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
      setError(pcoErrorReport(cause, 'Could not read your Planning Center lists.'));
    }
  };

  const runImport = async (list: PcoList) => {
    setImportingId(list.id);
    setError(null);
    try {
      const { data } = await importPlanningCenterList({ listId: list.id });
      show(
        data.added + data.restored === 0
          ? `Everyone on “${list.name}” was already on the roster`
          : `${data.added + data.restored} of ${data.total} from “${list.name}” added`,
        { tone: 'success' },
      );
      await refreshRoster(true);
    } catch (cause) {
      setError(pcoErrorReport(cause, 'Could not import that list.'));
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add from Planning Center"
      description="Search your church directory. Tally records that they are on the roster and nothing else about them."
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
          label="Search Planning Center"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or email…"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        {!query.trim() ? (
          <p className="px-1 text-sm text-ink-500">
            Anyone in Planning Center can be added, whatever their grade says. The roster is yours —
            the 5th grader who comes with a sibling belongs on it if you say so.
          </p>
        ) : results === null ? (
          <SkeletonRows count={3} />
        ) : results.length === 0 ? (
          <p className="px-1 text-sm text-ink-400">Nobody in Planning Center matches “{query}”.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {results.map((person) => {
              const already = onRoster.has(person.id) || added.has(person.id);
              return (
                <li key={person.pcoPersonId}>
                  <div
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-xl px-3 py-2 ring-1',
                      already ? 'bg-brand-500/10 ring-brand-500/25' : 'bg-ink-900 ring-ink-800',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-100">
                        {person.firstName} {person.lastName}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {person.grade === null
                          ? 'No grade in Planning Center'
                          : ordinalGrade(person.grade)}
                        {person.child ? '' : ' · not marked as a child'}
                        {person.status === 'inactive' ? ' · inactive in Planning Center' : ''}
                      </span>
                    </span>

                    {already ? (
                      <Badge tone="success">On the roster</Badge>
                    ) : (
                      <Button
                        size="sm"
                        loading={addingId === person.pcoPersonId}
                        onClick={() => void add(person)}
                      >
                        Add
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
              Adding a whole group? Import a Planning Center list →
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
                <p className="text-sm text-ink-400">Planning Center returned no lists.</p>
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
                          {list.totalPeople === null ? 'No count' : `${list.totalPeople} people`}
                          {list.invalid ? ' · rules no longer work' : ''}
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
