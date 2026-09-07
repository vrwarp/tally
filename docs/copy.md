# Copy standards for Tally's English strings

`messages/en.json` is the source of truth for every word a person reads, and it
is also the source text two Chinese catalogues are translated from. A sentence
written badly here is written badly three times.

This is the standard the strings are edited against. It is deliberately short:
a rule nobody can hold in their head is a rule nobody applies.

## Where the rules come from

The general rules are not invented here. They are the ones the field already
agrees on, cited so a disagreement can be settled by reading rather than by
seniority:

- **Nielsen Norman Group, [Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/)**
  and the [Error Messages Scoring Rubric](https://www.nngroup.com/articles/error-messages-scoring-rubric/) —
  twelve guidelines across visibility, communication and efficiency. The
  communication four are the ones that live in a string: human-readable
  language at a 7th–8th grade reading level, a concise and *precise* statement
  of what happened, constructive advice sufficient to fix it, and phrasing that
  "unambiguously place[s] accountability for the error on the system, not on
  the user".
- **[Microsoft Writing Style Guide — scannable content](https://learn.microsoft.com/en-us/style-guide/scannable-content/)** —
  "Lead with what's most important. Place important keywords near the beginning";
  "Use short, simple words. Get to the point. Then stop."; and parallel
  sentence structure for parallel things.
- **NN/g's reading research** — people read roughly a fifth to a quarter of the
  words on a screen. Anything that matters has to survive being skipped.

## The rules

**1. Front-load.** The first two or three words carry the meaning. A reader who
stops there should still be right about what this says. *"Could not reach
Planning Center to load the roster"* front-loads the failure; *"While attempting
to load the roster, Planning Center could not be reached"* buries it.

**2. Short words, then stop.** Prefer the shorter word where it is the same
word — *use* over *utilise*, *now* over *at this time*. Cut any clause that
survives its own deletion. Aim at a 7th–8th grade reading level; this app is
used by volunteers who signed up an hour ago.

**3. Buttons name their action.** A button label completes "I want to…" — a
verb and its object, in the reader's words. *Add student*, *Push now*, *Forget
the number*. Not *OK*, not *Submit*, not a noun where an action happened.

**4. Errors say what happened, then what to do.** Every failure string owes the
reader both halves. Missing the second half is the most common defect in this
catalogue. And it is never the reader's fault: the system failed to reach
something, the system did not accept it — not "you entered an invalid…".

**5. No system vocabulary.** *Backend*, *upstream*, *record*, *sync*, *push*,
*queued*, *write-back*, *linked*, *provision*, *rate-limited* are the words of
the people who built this. A children's ministry volunteer holding a tablet has
never heard them. Where the concept genuinely must surface, name it by what the
reader can see happen, not by its implementation.

**6. One term per thing, forever.** *Gathering* is not sometimes *event*.
*Counselor* is not sometimes *leader* and sometimes *volunteer*. *Roster* is not
sometimes *list*. Picking the term is a one-time decision; drifting off it is a
per-string defect, and it multiplies in translation because the two Chinese
catalogues have to make the same choice.

**7. Parallel things read in parallel.** Sibling options, sibling badges and
sibling empty states take the same grammatical shape. Two adjacent chips reading
*In flight* and *Needs you* are not parallel — one is a state and one is an
instruction.

**8. Sentence case.** Headings, buttons, labels, chips. Proper nouns keep their
capitals; nothing else earns one.

**9. Second person, and the system acts.** The reader is *you*. Tally is *Tally*
or is invisible; it is never *we*, and the reader is never *the user*.

**10. Explain only where somebody decides.** A caption under a destructive
button is earning its place. A paragraph explaining the data model above a
routine screen is not — it costs a scan of the whole screen to discover it did
not matter.

**11. Write something translatable.** No idiom that only works in English, no
pun, no joke that dies in Chinese. Never split a sentence into two catalogue
keys concatenated at runtime — a language that reorders the halves cannot put
them back together. An ICU argument is a *value* (a name, a count, a date),
never a clause.

## The two audiences, and how they differ

**The kiosk is read standing up.** A family in the lobby, in a queue, on a
tablet they have never used, possibly not reading English as a first language,
deciding in under a second whether a word is for them. Kiosk strings get the
strictest form of every rule above: shorter, more literal, fewer clauses, no
term that has to be learned. A kiosk string that needs a second read has failed.

**The staff app is read by volunteers, not operators.** The person on the
counselor screens may be doing this for the first time on a Sunday morning, and
the person in Settings is a ministry director, not an administrator. Neither is
technical. The staff app may carry a term of art — *gathering*, *roster*, *new
visitor* — but it has to teach it in place the first time it is used, and then
use it consistently forever.

## What a change here costs

Editing an English string invalidates both of its translations:
`messages/translation-state.json` records the verbatim English each was made
from, `tests/messages.test.ts` fails the build when the two disagree, and the
Chinese has to be re-drafted. That is the intended price — it is what stops
English drifting ahead of the languages half this church reads. It does mean a
reword has to be worth it, and that "this reads slightly better to me" is not
the bar. The bar is: a reader is measurably better off.
