/**
 * The walkthrough: prose beside the real screen, one journey at a time.
 *
 * Same argument as `../review-live/main.tsx` — the component renders from
 * `src/`, so what a reader clicks cannot drift from what ships. What this adds
 * is the frame around it: a journey list, the before/after either side of each
 * card, and the approve payload printed underneath.
 *
 * The payload is the part that could not be a screenshot. Half of what this
 * change did is invisible on a still image — a chooser nobody touched still
 * names an id; "none of them" reaches the server as a decision rather than as
 * an omission — and the only honest way to show it is to let somebody press the
 * button and read what went.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@/index.css';
import { ReviewPage } from '@/features/review/ReviewPage';
import { JOURNEYS, type Journey } from './fixtures';
import { showJourney, useDemoState } from './stubs';

const QUESTIONS: Record<Journey['question'], string> = {
  adult: 'Who is the adult?',
  child: 'Who is each child?',
  household: 'Which family do they join?',
  together: 'All three at once',
  corrections: 'Corrections',
};

const ORDER: Journey['question'][] = ['adult', 'child', 'household', 'together', 'corrections'];

/**
 * `**emphasis**` in the fixture prose, rendered.
 *
 * The journey copy is written as prose and reads as prose, and the one thing it
 * needs is to be able to lean on a word — "**Invisible.**", "**held**". Pulling
 * in a markdown renderer to bold three words would be a dependency the page has
 * to carry into a sandbox that permits no requests; splitting on the delimiter
 * is four lines and cannot fail in any way that matters.
 */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-ink-100">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Payload({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return null;
  return (
    <div className="mt-4 rounded-xl border border-ink-800 bg-ink-950 p-4">
      <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
        What the press actually sent
      </p>
      <pre className="mt-2 overflow-x-auto text-xs leading-relaxed text-brand-300">
        {JSON.stringify(value, null, 2)}
      </pre>
      <p className="mt-2 text-xs text-ink-500">
        Every field here is one somebody chose, or one the card pre-selected on their behalf and
        said so. An absent field means nobody was asked and the backend keeps its own judgement.
      </p>
    </div>
  );
}

function Walkthrough() {
  const { journeyId, lastApprove } = useDemoState();
  const journey = JOURNEYS.find((entry) => entry.id === journeyId)!;

  return (
    <div className="min-h-dvh bg-ink-950 text-ink-100">
      <header className="border-b border-ink-800 px-5 py-6 lg:px-10">
        <p className="text-sm font-bold tracking-widest text-brand-400 uppercase">Tally</p>
        <h1 className="mt-2 max-w-3xl text-2xl font-semibold text-ink-50 lg:text-3xl">
          Every identity decision, on one card
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-300">
          The Review screen is where a person, and not a Cloud Function, decides what reaches the
          church’s permanent database. It asks three questions about every family — who the adult
          is, who each child is, and which family they all join — and until recently only the first
          was asked out loud. The other two were settled by rules, elsewhere, after the button was
          pressed.
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-300">
          Everything below is the real screen: the same component the app routes to, the same
          stylesheet, the same markup. Firestore and the backend are the only things faked, and the
          fakes follow the server’s rules. <strong className="text-ink-100">Click anything.</strong>
        </p>
      </header>

      <div className="lg:flex">
        <nav className="border-b border-ink-800 px-5 py-4 lg:w-72 lg:shrink-0 lg:border-r lg:border-b-0 lg:px-6 lg:py-8">
          {ORDER.map((question) => (
            <div key={question} className="mb-5 last:mb-0">
              <p className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                {QUESTIONS[question]}
              </p>
              <ul className="flex flex-col gap-1">
                {JOURNEYS.filter((entry) => entry.question === question).map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => showJourney(entry.id)}
                      aria-current={entry.id === journeyId}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        entry.id === journeyId
                          ? 'bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/40'
                          : 'text-ink-300 hover:bg-ink-900'
                      }`}
                    >
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1 px-5 py-6 lg:px-10 lg:py-8">
          <h2 className="text-xl font-semibold text-ink-50">{journey.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-300">
            <Prose text={journey.situation} />
          </p>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-4">
              <p className="text-xs font-semibold tracking-wide text-warn-400 uppercase">Before</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-300">
                <Prose text={journey.before} />
              </p>
            </div>
            <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4">
              <p className="text-xs font-semibold tracking-wide text-brand-400 uppercase">Now</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-200">
                <Prose text={journey.now} />
              </p>
            </div>
          </div>

          {journey.tryIt ? (
            <p className="mt-4 rounded-xl border border-ink-800 bg-ink-950 px-4 py-3 text-sm text-ink-300">
              <span className="font-semibold text-ink-100">Try it — </span>
              <Prose text={journey.tryIt} />
            </p>
          ) : null}

          {/*
            The screen itself, keyed on the journey so switching cards remounts
            rather than reconciling. A reviewer's un-pressed choices are React
            state inside the card; carrying them across two different families
            would show an answer nobody gave.
          */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-ink-800 bg-ink-950">
            <MemoryRouter key={journey.id}>
              <ReviewPage />
            </MemoryRouter>
          </div>

          <Payload value={lastApprove} />
        </main>
      </div>

      <footer className="border-t border-ink-800 px-5 py-6 text-xs leading-relaxed text-ink-500 lg:px-10">
        Journeys that depend on a backend being unreachable or on write-back being switched off are
        deliberately not here: in every one of them the card draws no control and claims nothing,
        which is correct and not much to look at.
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Walkthrough />);
