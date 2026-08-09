import { useToastSnapshot } from './stubs';

/**
 * The app's toast, restated.
 *
 * Not decoration either: the sentence a correction answers with is half the
 * change — "and one student on the roster now shares Michael's name" is how a
 * reviewer learns the button they were reaching for is held again — and a
 * walkthrough that never showed one would be leaving out the half that does the
 * explaining.
 */
export function Toast() {
  const toast = useToastSnapshot();
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6">
      <p className="max-w-lg rounded-xl bg-ink-800 px-4 py-3 text-sm text-ink-100 shadow-lg ring-1 ring-ink-700">
        {toast.message}
      </p>
    </div>
  );
}
