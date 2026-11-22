# Proposal: extra dates on a recurring gathering

**Status:** draft for review — nothing here is built. Revision 2, after a church-staff review and a
journey critique. What changed and why is at the bottom.

A ministry that meets every Friday sometimes meets on a day that is not a Friday: the Christmas
party on a Saturday, a makeup night after a snowed-out week, the nursery opening for the Christmas
Eve service. Sometimes it meets on its usual day at an unusual time. Today Tally cannot record
either *as Friday Fellowship*. This proposal adds an **extra date**: a night that belongs to a
gathering's chain like any other, but was added by hand instead of produced by the recurrence rule.

The working term in this doc is *extra night*. The on-screen label is open question 5, and
*Extra date* is the current recommendation.

---

## What a leader can do today, and what each option breaks

The rule is the only thing that puts a night into a chain, and an edit to any night of a chain
changes the rule. That leaves three workarounds, and each one does damage.

| Workaround | What goes wrong |
| --- | --- |
| **Make a one-off** ("Friday Fellowship Christmas Party") and borrow Friday's regulars through `predictFromChain` | The register sits outside the chain. Who came doesn't count toward Friday's Recent list, its trend or its MIA streaks, and the dashboard files the night under *One-off events*. `requiresRsvp` defaults to on, so the counselor at the door sees an empty roster. `labelTemplate` is recurring-only, so the nursery kiosk prints nothing. `eventAccess/{chainKey}` doesn't cover it, so a gathering restricted to its volunteers becomes a night anyone can work. |
| **Edit the next Friday** and change its date or time | Edits carry forward (`retimeRecurrence`, and the template is the chain's latest live instance, `materialize.ts:206-211`). Every future Friday moves. The real Friday that week is lost too. |
| **Make a new recurring event** with "ends after 1" | It becomes a new chain of one, with every problem of the one-off and not even the borrowed regulars. |

The editor's "switch to one-off" path, which `materialize.test.ts` describes as how a leader says
"just this once", has the same flaw. It takes that night out of the chain.

---

## New journeys

These follow the numbering in [`docs/product.md`](../product.md). Each one says which existing
journey it pressures.

**Journey 9 — the Christmas party (Friday Fellowship, Saturday 19 December, 2–5pm).** On
Tuesday, a core leader opens Friday Fellowship on the Events tab and taps **＋ Add an extra
date**. The form is already filled in from the gathering: title, icon, location, check-in window,
labels, kiosk look. All that's left to choose is a date and a time. It has no *Repeats* field and
no *Type* field, because neither question applies. On Saturday a counselor opens Tally. The
chooser (Journey 1) shows *Friday Fellowship* with an **Extra date** tag, so a Friday gathering on
a Saturday reads as intended. The roster opens on Recent with Friday's regulars (Journey 2), and
every check-in lands in Friday Fellowship's history. The Fridays before and after are untouched:
same time, same rule, same ids.

**Journey 9b — the snow week.** Friday is called off and the group meets on Wednesday instead.
The leader cancels Friday (Journey 7, unchanged) and adds Wednesday as an extra date. Fourteen of
the usual forty come. On Tuesday (Journey 5) none of the other twenty-six gains a miss, because an
extra date was never something anyone was expected at. The fourteen who came have been seen, so a
streak they were building ends there.

**Journey 9c — this Friday only, at 5pm.** The youth pastor wants this week's Friday to start at
5 for a dinner, and only this week. They pick Friday the 11th in the extra-date form. The form
says *Friday Fellowship already meets on Fri 11 Dec at 7pm* and offers two answers:
**Instead of the 7pm** (the usual night is called off and the extra takes its place, in one save)
or **As well as the 7pm**. They pick *instead*. Next Friday is at 7 as always. This is the most
common case staff hit, and today the only way to do it moves every Friday after it.

**Journey 9d — the nursery on Christmas Eve (Thursday).** Sunday Nursery has check-out on,
prints labels, and is restricted to its volunteers (Journey 8). The extra date inherits all three
when it's created. The lobby kiosk (Journey 4c) is bound to it the usual way and prints the
nursery's labels. Parents see the same screen and the same one-tap pickup. The volunteers find it
on their chooser under *yours*. Nobody had to remember to add four people to a one-off at 11pm on
the 23rd. If the church runs two services (4pm and 6pm), the leader can add one long extra date
covering both, or two extra dates on the same day.

**Journey 9e — the follow-up list after an extra.** In January the core team reads Friday's tab.
The party is in the trend strip as its own marked bar, kept out of the average, because an
eighty-person party is not evidence that Fridays doubled. The friend who came to the party for the
first time shows up under first-timers *for Friday Fellowship*, the gathering they should be
invited back to. Today they would land in the one-off recap, where nobody looks.

**Journey 9f — getting it wrong.** The leader typed the 12th instead of the 19th. They open the
extra date, and the same extra-date form opens (never the gathering editor). They change the date,
and only that night moves. The editor offers no way to touch the rule from here. Cancelling works
like cancelling any night. On an extra date the danger zone puts the single-night delete first.
The chain action below it is labelled with the gathering's name, so it can't be mistaken for "this
one". Ending Friday Fellowship (Journey 7) removes its extra dates with everything else, and the
dialog counts them: *"52 nights, including 2 extra dates"*.

**Journey 9g — the gathering changes after the extra was added.** In November a leader adds
Christmas Eve to Sunday Nursery. In December someone changes the nursery's label template. The
extra date keeps what it was created with, like any night already written down. So the save of
that edit says so: *Doesn't change extra dates: Thu 24 Dec*, and links to it. A kiosk that was
bound to the extra before it was edited keeps its snapshot until it's rebound (`src/kiosk/binding.ts`),
which goes in the coordinator guide as one line.

**Journey 9h — where the leader starts.** Plenty of leaders won't look on the gathering's page.
They'll tap **New event** and pick *One-off*. That form adds one line, *"Is this a Friday
Fellowship night? Add it as an extra date instead"*, which opens the form above. It appears when
*Borrow regulars from* names a recurring gathering, **or** when the title contains a recurring
gathering's name: most leaders typing "Friday Fellowship Christmas Party" never touch *Borrow*.
The retreat (Journey 4) is unchanged: a trip that *borrows* Friday's regulars is a different thing
from a Friday that happens to fall on a Saturday.

---

## The proposal

### Data model

One new field on `events/{eventId}`:

| Field | Type | Notes |
| --- | --- | --- |
| `extra` | boolean | True for a night added by hand to a chain. It always has `mode: 'recurring'`, `recurrence: null`, and the chain link (`seriesId` or `recurrenceRootId`) copied from the gathering it was added to; the rules pin all three. False or absent on every existing document, so no migration is needed. |

**Every rule is keyed on `extra === true`, never on "has no recurrence".** Older recurring
documents can already have `recurrence: null` (`EventEditorModal.tsx:170-174`,
`converters.ts:302`), and those are ordinary Fridays.

Because it shares the chain link, everything that groups by `chainKey` picks it up unchanged:
the access list, kiosk chain lookups, chain deletion, the profile attendance card, `skippedNights`.
The journey critique checked that the predictive roster's chain history, `gatheringsOnCalendar`,
`AttendanceGridModal`, `listKioskEvents` and the occurrence prune already handle a recurring-mode
event with no rule correctly.

**Ids are generated, not derived from the day.** A day-based id (`occurrenceId`) would collide
with the cancelled rule night in Journey 9c, would block two services on one day, and would go
stale the moment an extra is moved to another date. A generated id has none of those problems.
Duplicates are caught by a check on chain + start time before creating: *There's already an extra
date on Sat 19 Dec at 2pm — open it?*

### Projection

`chainsToProject` already skips any event without a `recurrence`, so an extra can never become
the template or the `COUNT` origin. That is the dangerous case: a 2–5pm Saturday template would
make every future Friday a 2–5pm Saturday. Two changes make the guarantee explicit:

- `if (event.extra) continue` in `chainsToProject`, so the guarantee doesn't rest on
  `recurrence` happening to be null.
- **Extras don't add a chain-and-day key to `taken`** (`materialize.ts:309`). Otherwise an extra
  on a Saturday would silently hide a real rule night if the rule were later moved to Saturdays,
  and an "as well as" extra would hide the rule night it sits beside.

Plus a property test mirroring the existing one ("writing one night down decides nothing about any
other"): **adding, moving, cancelling or deleting an extra leaves every other occurrence in the
window identical.**

### History: an extra is never a miss, and attending one is never ignored

Applied in the shared `sessionHistory` / `participation` code so the app, the dashboard and the
kiosk's nightly index agree:

| Derivation | Rule night | Extra date |
| --- | --- | --- |
| Recent filter (last N of chain) | Occupies a slot | **Doesn't occupy a slot.** A party nobody was expected at doesn't push a real Friday out of "2 of the last 3". |
| MIA streak | Absence is a miss | **Absence is nothing.** Presence counts as being seen and ends a streak. |
| Trend strip | Plotted, in average | Plotted with a marker, **kept out of the average** |
| First-timers | Counted under the chain | Counted under the chain |
| Student page chips | Attended / Missed | Attended, or not shown — never "Missed" |

Two implementation traps the critique found:

- **`standingIn`'s window** (`insights.ts:318`) finds the student's last visit with
  `snapshots.indexOf(lastAttended)`. If extras are filtered out of `snapshots` and the last visit
  was the party, that returns -1 and a drifting regular quietly falls off the MIA list. Fix:
  "seen" is computed over all nights, and the window is read over rule nights starting from the
  latest rule night on or before the visit.
- **The server builds its own sources by hand.** `OccurrenceSource` (`materialize.ts:61-87`),
  `toSource` (`functions/src/occurrences.ts:122`), `ChainInstance` (`src/lib/participation.ts:130`)
  and `buildParticipationIndex` (`functions/src/kiosk/participation.ts`) all need `extra`, and the
  sync script won't add it. If one is missed, the party takes a Recent slot on the kiosk but not in
  the app. A parity test pins the two together.

This follows [decision 3](../data-model.md#3-a-gathering-with-no-attendance-is-a-cancelled-one):
Tally never phones a family about a night nobody was expecting them at.

### Screens

- **Event page and Events tab, on a recurring gathering:** **＋ Add an extra date**, for core
  team and up (the same people who create events today).
- **The extra-date form.** One form for creating *and* editing, chosen by `event.extra`, not by
  which button opened it. It opens pre-filled from the chain's template. *Type* and *Repeats* are
  hidden, the date fields read *Starts / Ends*, and no default rule is ever filled in. Today the
  editor fills in `defaultRecurrence(startAt)` (`EventEditorModal.tsx:175`) and `save` writes it
  (`:518`). On an extra, that would either be refused by the rules with a bare "save failed", or
  turn the party into the chain's template. `extra` is carried through `EventDraft`,
  `buildEventPayload` and the converters.
- **On a day the rule already has a night:** *Instead of* (cancel that night and create the
  extra in one batch) or *As well as*. Never "edit that night", which is the workaround that moves
  the schedule.
- **Tags:** **Extra date** on the hero card, upcoming and past rows, the check-in chooser and the
  kiosk chooser row (built server-side in `functions/src/kiosk/events.ts`, so the flag rides on
  the row). The detail page shows it in place of the *Recurring* badge (`EventDetailPage.tsx:303`).
- **Gathering edit save:** *Doesn't change extra dates: …* when the chain has upcoming extras.
- **One-off form:** the pointer from Journey 9h.
- **Danger zone on an extra:** single-night delete first, the chain action named
  (`EventDangerZone.tsx:390`), and the chain-delete count names the extras.

### Rules

In `firestore.rules`, `extra == true` requires `mode == 'recurring'`, `recurrence == null`, and a
non-null `seriesId` or `recurrenceRootId`. Who may write is unchanged.

### Out of scope for v1

- **Extras inheriting gathering edits at read time.** v1 snapshots at creation and says so
  (Journey 9g). Live inheritance can come later if snapshotting proves annoying.
- **A one-step "just this night" edit from a rule night's own page.** Journey 9c covers the case
  from the extra-date form. A shortcut on the rule night ("Change just this night…" → the same
  *instead of* flow) is a small follow-up.
- **RSVPs on an extra.** It inherits the chain's open roster.

### Rejected alternatives

1. **Polish the one-off.** Default `requiresRsvp` off when it borrows, allow labels, copy the
   ACL. That fixes the door but not the history, and a copied access list goes stale.
2. **RFC 5545 `RDATE` on the rule.** The rule is read off whichever night is newest, so every edit
   would have to carry every RDATE forward. An RDATE also takes the template's time of day, and
   extras usually run at their own times.
3. **An extra that keeps a rule but is excluded only from template selection.** A later edit could
   re-enable the rule. `recurrence: null` pinned by the rules is the safer shape.
4. **Day-derived ids for extras** (revision 1 of this doc). See *Data model* for why.

---

## Rough build order

1. `extra` on the type, `EventDraft`, `buildEventPayload`, converters, rules, and rules tests
   (`firestore-tests/`). Add a test that saving an extra never writes a rule.
2. Projection: the `chainsToProject` guard, no chain-and-day key for extras, the "decides nothing
   about any other night" property test.
3. History: the asymmetry in `sessionHistory` / `participation` / `predictiveRoster` / `insights`,
   the `standingIn` window fix, `extra` on `OccurrenceSource` / `toSource` / `ChainInstance` /
   `buildParticipationIndex`, and the app/server parity test. Run `scripts/sync-functions-shared.mjs`.
4. `createExtraDate` (with the *instead of* batch) in `services/events.ts`, and the extra-date form.
5. Tags, the one-off pointer, the gathering-save notice, the danger-zone changes, and copy in all
   five locales.
6. An e2e journey (9, 9b, 9c) and the docs: Journey 9 in `product.md`, the field row in
   `data-model.md`, the rebind line in the coordinator guide.

## Questions for you

1. **Recent window:** should an extra take a slot? Recommended: no. Staff review agreed.
2. **MIA:** should attending an extra end a streak? Recommended: yes. Staff review agreed.
3. **Trend:** plotted with a marker and kept out of the average? Recommended: yes. Staff review
   agreed.
4. **"Instead of" in v1:** Journey 9c brings a one-night retime into v1 through the extra-date
   form. Is that in scope, or should v1 be extras only?
5. **Label:** staff review found *Extra night* wrong for a Sunday morning, and *Special*
   uninformative. Recommended: **Extra date**.

---

## What changed in revision 2

- **Ids are generated, not derived from the day.** Revision 1 couldn't do "cancel and replace" on
  the same day, couldn't do two services on one day, and its convergence claim broke after a move.
- **"Edit that night instead" is gone.** It pointed leaders at the edit that moves every future
  Friday. It's replaced by *Instead of / As well as*, and Journey 9c is new.
- **The edit path keys on `event.extra`.** Revision 1 only covered the creation form. Opening an
  existing extra in the normal editor would have written a default weekly rule onto it.
- **Extras don't add a chain-and-day key to `taken`**, so they can never hide a rule night.
- **New:** server files to change, the `standingIn` window trap, keying on `extra === true` only,
  danger-zone ordering, the gathering-save notice (Journey 9g), and the title-match pointer.
