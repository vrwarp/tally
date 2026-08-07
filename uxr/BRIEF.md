# The refinement brief

Everything in `uxr/` exists to answer two questions that pull in opposite
directions, and to answer them without guessing.

## The product, in one paragraph

Tally is an attendance app for a 6th-to-12th-grade youth ministry. Two
audiences share one codebase. **Counselors** get exactly one screen — check-in —
and use it standing at a door on a Friday night, one-handed, in a dim hallway,
with a queue of teenagers in front of them and a budget of about three seconds
per student. **Core team and admins** also get insights, the event calendar, the
student directory and settings, and they use those on a Tuesday morning, sitting
down, on a laptop, deciding who to phone this week.

## The two goals

**Phone: make it touch-friendly.** The thumb is the only input device. A target
is comfortable at 48×48 CSS px and marginal below 44. Reach matters as much as
size: the bottom third of a 844px-tall screen is where a thumb lives, and the
top-right corner is where it does not. Anything a counselor does *repeatedly*
belongs low; anything they read once can sit high and scroll away. Adjacent
targets that do different things need space between them, because a mis-tap at a
door is a student filed against the wrong record. Text has to survive a glance,
not a read.

**Desktop: make it information-dense.** The same screens today are a phone
layout centred in a 1440px window, which means a leader on a laptop reads a
narrow column with two-thirds of their screen empty and scrolls for things that
would all fit at once. Density is not smallness — it is *more answered
questions per screen*: more rows above the fold, more columns of fact per row,
sections side by side instead of stacked, and hover/pointer affordances that a
touch screen cannot offer. The measure is how much of the job is done without
scrolling.

Both goals are constrained by one rule: **the two experiences share components.**
A change that helps the phone must not cost the desktop and vice versa; the
answer is nearly always a responsive difference (`lg:` and up is pointer
territory), not a compromise that is mediocre at both.

## What must not change

These are product decisions already made, at some cost, and a critique that
proposes undoing them is out of scope:

- **A tap never moves a row.** The roster is one list, sorted A–Z, and checking
  a student in recolours their row where it stands. Re-sorting slid the next
  name out from under a thumb already moving toward it.
- **The event is chosen by a person, not by the clock.** `/` is a question.
- **Undo is one tap on the check mark, never a dialog.** The second tap on the
  row body opens the corrections strip — undo, profile, wrong person — and
  undo itself must never become a confirmation.
- **No RSVP counts on calendar rows** — that data is not subscribed to, and a
  plausible wrong number is worse than none.
- **The dashboard is split by gathering.** Friday and Sunday are different
  crowds.
- **Nothing about minors beyond what is already shown.** No photos, no
  birthdates, no addresses. Do not invent richer student cards.

## The design system

Colour is a *distance from the reader*, not a palette. `ink-50` is what you are
meant to look at; `ink-950` is the page it sits on. The ramp flips wholesale for
the light theme, so any new colour must be expressed as an existing token or it
will be wrong in daylight. Accents: `brand` (blue, the app's own), `present`
(green, checked in), `warn` (amber), `danger` (red).

Tailwind v4. Spacing, radii and type come from the default scale. The app has no
icon library — icons are single characters and emoji, deliberately.

## The scenes

| id | audience | the job |
| --- | --- | --- |
| `choose-event` | counselor | Pick tonight's gathering in one tap, one-handed, with a queue waiting. |
| `roster` | counselor | Find the student at the front of the queue and mark them present in under three seconds. |
| `roster-search` | counselor | Find someone the prediction did not offer, by typing two or three letters. |
| `dashboard` | core team | Work out who to phone this week: who drifted, who is new, who nobody can reach. |
| `events` | core team | See what is on, schedule next Friday, find the gathering from three weeks ago. |
| `students` | core team | Find one student among forty-five, see who has no parent contact, open a record. |
| `review` | core team | Decide five families the lobby screen recorded and could not judge — duplicates, a half-failed push, a record about to be swept — knowing approval is irreversible upstream. |

## How the loop works

1. `uxr/baseline/` holds static HTML frozen out of the live seeded app — real
   DOM, real CSS, real data, no JavaScript.
2. `uxr/prototype/` starts as a copy and is what the ideation agent edits.
3. `npx tsx uxr/shoot.ts uxr/prototype --out uxr/renders/rNN` renders every
   prototype to PNG at its own viewport: `-fold` is what fits without
   scrolling, `-full` is the whole page.
4. Two critics look at the frames. One judges the job (`uxr-visual-critic`),
   one judges the craft (`uxr-design-critic`).
5. `uxr-ideator` edits the prototypes to answer them.
6. Repeat until a round produces no finding above `minor`.

A prototype may be changed by editing markup and classes directly, or through
the empty `<style data-uxr="overrides">` block every frozen page carries. The
override block is the cheap path and the honest one for pure styling; anything
structural should be edited in the markup so the implementation step can read it
straight across into React.
