# The locked Events tab — five rounds, and what they were about

A core member reported the Events page as **noisy**. The screenshot showed nine
of ten past gatherings reading `🔒 not yours`.

## The scene, and why it had to be derived

`scripts/seed.ts` never writes an `eventAccess` document, so a capture of the
live app shows a calendar where every gathering belongs to the reader — the
opposite of the screen the complaint was about. `uxr/locked-scene.ts` derives it
instead, by doing to the frozen `events` scene exactly what `PastGatherings` does
when `canWork` is false. A script rather than a hand-edit, so it stays honest as
the real page changes.

Round 1's critique caught the scene lying about who was holding it: the freeze is
signed in as Miriam Achebe, an admin — for whom `canWorkChain` returns true
unconditionally — and the name `LockedGatherings` prints as the way *in*. The
derivation reseats the reader.

## The journeys, read from the rules rather than the screen

`uxr/JOURNEYS-events-locked.md`. Writing it turned the complaint into a bigger
finding: the same `onChain` gate that hides a head count also refuses an **edit**,
a **cancellation** and the **create** behind *Schedule next Friday*. The padlocks
were the visible edge of a state covering two thirds of the screen, and the page
went on offering every one of those writes.

## The loop

| round | blocker | major | minor | what it was about |
| --- | --- | --- | --- | --- |
| 1 | 2 | 8 | 10 | the fact is carried backwards only; the loudest object leads to a wall |
| 2 | 0 | 5 | 10 | the collapse was left out of the idiom; a dead row on a touch screen |
| 3 | 0 | 5 | 10 | the collapse over-collapsed; every fact in the wrong place |
| 4 | 0 | 2 | 9 | two row kinds, one drawn object; a phone ladder on a laptop |
| 5 | **0** | **0** | 15 | converged |

All four round-5 critics returned nothing above `minor`, which is the condition
the loop exits on. Since round 3 nobody has raised the padlock noise, the refused
writes, the approver repetition, the inverted row hierarchy, the dead rows, or
the hero card promising a door that refuses. Those were the complaint.

## What the rounds actually settled

**Round 1 — one answer in three places.** The blocker and three majors were one
finding. A locked gathering is the same demoted row wherever it appears; the
caption paid for fourteen times becomes one notice carrying the only move the
reader has. Its side effect is the design: with the locked rows demoted, the two
gatherings that *are* theirs are the only objects with a surface.

**Round 2 — finish the idiom.** Three critics independently found that
`LockedGatherings` is *divider, collapsed group, lock, name* and round 1 reused
three of the four. Phone 3,170px → 1,869px; desktop 1,912px → 1,098px. Round 1's
inert row was a cost, not a win: on a touch screen a tap with no response is
indistinguishable from a tap that missed.

**Round 3 — every fact to the object it is a property of.** The approver is true
of the page, the time is true of the chain, the date is true of the night. The
head was carrying the first two and withholding the third.

**Round 4 — where the marks sit.** A filled surface was unavailable to bracket a
group head, because a fill already means *this one is yours*. So the caret moved
next to the date instead of the far margin, and the child ladder became a
wrapping flow at pointer widths.

**Round 5 — seven agreed minors**, each one property, before they froze into
`src/`.

## Three defects the loop found that were not about this design

- A band called **next seven days** excluded day seven, so on a Friday the
  following Friday was missing from the week that named it.
- A locked **past** row pointed at `/event/<id>`, the check-in route, whose
  refusal page offers a way back to the counselor screen.
- The disclosure caret **jumped 6px** on opening, on this screen and on the
  check-in screen, because rotating a character about its em box throws ink that
  hangs low in that box to the top.

## Verifying the port

The prototypes are thrown away; what shipped is what matters, and the harness's
own lesson is that the two drift. The port was checked by mounting the real
`EventsPage` in the locked scenario, writing its DOM out, and photographing it
through the frozen stylesheet. That caught a formatting bug introduced during the
port — a date and a time concatenated without a separator on the one row type the
prototype never exercised, a chain whose nights are not all at the same hour.
