/**
 * "Planning Center could not be reached" — said out loud, on the screens that
 * would otherwise not say it.
 *
 * The roster is the one read whose failure is invisible. Every other call in
 * Tally is something a person pressed, so a failure lands under their thumb;
 * the roster is fetched by the provider, and when it fails the screens simply
 * draw the students that came back — none — behind the cheerful empty state
 * they use for a church that has not added anybody yet.
 *
 * That is what happened when Planning Center's paginated `links.next` stopped
 * being followed: several hundred students were on the roster, `getRoster`
 * failed on every call, and the Students screen said "No students on the roster
 * yet." The person reading it had no reason to look at a console.
 *
 * So the banner states the failure, offers the one action that might fix it,
 * and carries the request and response for whoever it gets forwarded to.
 */
import { PlanningCenterErrorDetails } from '@/components/PlanningCenterErrorDetails';
import { Button, ErrorBanner } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { cn } from '@/lib/utils';

export interface RosterErrorBannerProps {
  className?: string;
}

export function RosterErrorBanner({ className }: RosterErrorBannerProps) {
  const { students, rosterError, rosterBackends, rosterLoading, refreshRoster } = useData();

  if (!rosterError) {
    /*
     * The read as a whole landed, but one backend did not answer. A smaller
     * thing than the failure below — the rest of the roster is fresh, and the
     * missing backend's students are still drawn from this device's saved
     * copy — so it gets a warning, not the red banner. With one backend
     * connected this can never render: its failure is the whole read's.
     */
    const down = (rosterBackends ?? []).filter((entry) => !entry.ok);
    if (down.length === 0) return null;

    const names = down.map((entry) => entry.displayName).join(' and ');
    return (
      <div
        role="status"
        className={cn(
          'flex flex-col gap-2 rounded-xl bg-warn-500/10 px-4 py-3 text-sm text-warn-400 ring-1 ring-warn-500/25',
          className,
        )}
      >
        <p>
          {names} could not be reached. Students from there may be missing or out of date until it
          answers again; everything else on this roster is current.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={rosterLoading}
            onClick={() => void refreshRoster(true)}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // Whether anything is on screen changes what this banner *is*: a warning that
  // the names being tapped may be out of date, or the explanation for a screen
  // with nothing on it. Saying the wrong one is worse than saying neither.
  const showingSomething = students.length > 0;

  return (
    <ErrorBanner
      className={cn('flex flex-col gap-2', className)}
      message={rosterError.message}
      details={
        <>
          <p className="text-ink-400">
            {showingSomething
              ? 'These names are the roster this device saved earlier. Check-in still works, and anyone added since will be missing until the connection comes back.'
              : 'Nobody can be shown until the roster source answers. Students already on the roster have not been lost — Tally simply cannot read their names right now.'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={rosterLoading}
              onClick={() => void refreshRoster(true)}
            >
              Try again
            </Button>
          </div>
          <PlanningCenterErrorDetails report={rosterError} />
        </>
      }
    />
  );
}
