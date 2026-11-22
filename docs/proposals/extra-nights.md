# Proposal: extra nights on a recurring gathering

**Status:** draft for review — nothing here is built.

A ministry that meets every Friday sometimes meets on a day that is not a Friday: the Christmas
party on a Saturday, a makeup night after a snowed-out week, the nursery opening for the Christmas
Eve service. Today Tally cannot record that night *as Friday Fellowship*. This proposal adds a
third kind of gathering, the **extra night**. An extra night belongs to a chain like any other
night of it, but it was added by hand and the recurrence rule never produced it.

---

## What a leader can do today, and what each option breaks

The rule is the only thing that puts a night into a chain, and an edit to any night of a chain
changes the rule. That leaves three workarounds, and each one does damage.

| Workaround | What goes wrong |
| --- | --- |
| **Make a one-off** ("Friday Fellowship Christmas Party") and borrow Friday's regulars through `predictFromChain` | The register sits outside the chain. Who came doesn't count toward Friday's Recent list, its trend or its MIA streaks. The dashboard files the night under *One-off events*. `requiresRsvp` defaults to on, so the counselor at the door sees an empty roster until someone RSVPs the whole group. `labelTemplate` is recurring-only, so the nursery kiosk prints nothing. `eventAccess/{chainKey}` doesn't cover it, so a gathering restricted to its volunteers becomes an extra night anyone can work. |
| **Edit the next Friday** and change its date to the Saturday | Edits carry forward (`retimeRecurrence`, and the template is the latest live instance), so every future Friday moves to Saturday. The real Friday that week is lost too. |
| **Make a new recurring event** with "ends after 1" | It becomes a new chain of one, which has every problem of the one-off and doesn't even borrow the regulars. |

The editor's "switch to one-off" path, which `materialize.test.ts` describes as how a leader says
"just this once", has the same flaw. It turns one rule night into a one-off, which takes that
night out of the chain.

---

## New journeys

These follow the numbering in [`docs/product.md`](../product.md). Each one says which existing
journey it pressures.

**Journey 9 — the Christmas party (Friday Fellowship, Saturday 19 December, 2–5pm).** On
Tuesday, a core leader opens Friday Fellowship on the Events tab and taps **＋ Add an extra
night**. The form is already filled in from the gathering: title, icon, location, check-in
window, labels, kiosk look. All that's left to choose is a date and a time. It has no *Repeats*
field and no *Type* field, because neither question applies. On Saturday a counselor opens Tally.
The chooser (Journey 1) shows *Friday Fellowship* with an **Extra night** tag and the date, so a
Friday gathering appearing on a Saturday reads as intended. The roster opens on Recent with
Friday's regulars (Journey 2), and every check-in lands in Friday Fellowship's history. The
Fridays before and after the party are untouched: same time, same rule, same ids.

**Journey 9b — the snow week.** Friday is called off and the group meets on Wednesday instead.
The leader cancels Friday (Journey 7, unchanged) and adds Wednesday as an extra night. This is
what a "makeup night" is in Tally: two acts, each reversible, neither one touching the rule.
Fourteen of the usual forty come on Wednesday. On Tuesday (Journey 5) nobody among the other
twenty-six gains a miss, because an extra night was never something anyone was expected at. The
fourteen who came have been seen, so a streak they were building ends there.

**Journey 9c — the nursery on Christmas Eve (Thursday).** Sunday Nursery has check-out on,
prints labels, and is restricted to its volunteers (Journey 8). The extra night inherits all
three. The lobby kiosk (Journey 4c) is bound to it the usual way and prints the nursery's labels.
Parents see the same screen and the same one-tap pickup. The volunteers find it on their chooser
under *yours*, not under *Not yours*. Nobody had to remember to add four people to a one-off at
11pm on the 23rd.

**Journey 9d — the follow-up list after an extra.** In January the core team reads Friday's tab.
The party is in the trend strip as its own marked bar, kept out of the average, because an
eighty-person party is not evidence that Fridays doubled. The friend who came to the party for
the first time shows up under first-timers *for Friday Fellowship*, which is the gathering they
should be invited back to. Today they would land in the one-off recap, where nobody looks.

**Journey 9e — getting it wrong.** The leader typed the 12th instead of the 19th. They open the
extra night and change the date, which moves only that night. The editor offers no way to touch
the rule from here. If the party is off, cancelling it works like cancelling any night. Deleting
it uses the single-night phrase. Ending Friday Fellowship (Journey 7) removes its extra nights
along with everything else, and the dialog counts them: *"52 nights, including 2 extra"*.

**Journey 9f — where the leader starts.** Plenty of leaders won't look on the gathering's page.
They'll tap **New event** and pick *One-off*. When that form has *Borrow regulars from* set to a
recurring gathering, it adds one line: *"Is this a Friday Fellowship night? Add it as an extra
night instead"*, and the line opens the form above. The retreat (Journey 4) keeps working as it
does now: a trip that *borrows* Friday's regulars is a different thing from a Friday that
happens to fall on a Saturday.

---

## The proposal

### Data model: an extra is a recurring-mode night with no rule

One new field on `events/{eventId}`:

| Field | Type | Notes |
| --- | --- | --- |
| `extra` | boolean | True for a night added by hand to a chain. It never carries a `recurrence` (pinned by the rules), and it always carries the chain link, `seriesId` or `recurrenceRootId`, copied from the gathering it was added to. False or absent on every existing document, so no migration is needed. |

An extra night has `mode: 'recurring'` with `recurrence: null` and the chain's own `seriesId` /
`recurrenceRootId`. Everything that groups by `chainKey` therefore picks it up without a code
change: the access list, the kiosk's chain lookups, chain deletion, the profile's attendance card,
`skippedNights`.

The id is `occurrenceId(chainKey, date)`, the same derived id a rule night would get on that
day. Two leaders adding the same party converge on one document, the way materialising does.
Creation uses `create()`, so it fails instead of overwriting.

### Projection: almost nothing to change, and one property to prove

`chainsToProject` already skips any event without a `recurrence`. So an extra night can never
become the template, which is the dangerous case. If it could, a 2–5pm Saturday party would turn
every future Friday into a 2–5pm Saturday. It also can never become the `COUNT` origin. Its
derived id and its chain-and-day key go into `taken` like any document's, which is harmless: the
rule doesn't land on that day.

The work is a test that mirrors the existing one in `materialize.test.ts` ("writing one night
down decides nothing about any other"): **adding, moving, cancelling or deleting an extra night
leaves every other occurrence in the window identical.** An explicit `if (event.extra) continue`
also goes into `chainsToProject`, so the guarantee doesn't rest on `recurrence` happening to be
null.

### History: an extra is never a miss, and attending one is never ignored

This is the one real product decision. Recommended rule, applied once in the shared
`sessionHistory` / `participation` code so the app, the dashboard and the kiosk's nightly index
can't drift apart:

| Derivation | Rule night | Extra night |
| --- | --- | --- |
| Recent filter (last N of chain) | Occupies a slot | **Doesn't occupy a slot.** A party nobody was expected at doesn't push a real Friday out of "2 of the last 3". |
| MIA streak | Absence is a miss | **Absence is nothing.** Presence counts as being seen and ends a streak. |
| Trend strip | Plotted, in average | Plotted with an *extra* marker, **kept out of the average** |
| First-timers | Counted under the chain | Counted under the chain (today it would be the one-off recap) |
| Student page chips | Attended / Missed | Attended, or not shown — never "Missed" |

This is the same forgiving asymmetry as [decision 3](../data-model.md#3-a-gathering-with-no-attendance-is-a-cancelled-one):
Tally never phones a family about a night nobody was expecting them at.

### Screens

- **Event page and Events tab, on a recurring gathering:** a **＋ Add an extra night** action
  next to the gathering's other actions. Core team and up, the same people who can create events
  today.
- **Editor, in extra-night form:** opens pre-filled from the chain's template. *Type* and
  *Repeats* are hidden. The date fields read *Starts / Ends*, not *Next start / Next end*. The
  `save` path writes `recurrence: null` unconditionally. It refuses a date on which the rule
  already has a night, with *"Friday Fellowship already meets on 18 Dec — edit that night
  instead"*.
- **Badges:** an **Extra night** tag on the hero card, the upcoming and past rows, the check-in
  chooser, and the kiosk's chooser row (the kiosk builds it server-side in
  `functions/src/kiosk/events.ts`, so the flag rides on the row).
- **One-off editor:** the one-line pointer from Journey 9f, shown only while *Borrow regulars
  from* names a recurring gathering.
- **Danger zone:** the chain delete count names how many of the nights are extra.

### Rules

In `firestore.rules`, `extra == true` requires `mode == 'recurring'`, `recurrence == null`, and a
non-null `seriesId` or `recurrenceRootId`. Who may write is unchanged.

### Out of scope for v1

- **Moving one rule night without moving the rule** ("this Friday only, at 8pm"). It is the
  sibling gap: edits carry forward today. Cancel-plus-extra covers it in two steps. A one-step
  "just this night" edit can come later on top of this field.
- **Two nights of one chain on one day** (4pm and 6pm Christmas Eve services). The derived id is
  per day, and the module says outright that this case doesn't happen. If it turns out to be
  real for nurseries, extra nights could take a time-qualified id instead, which also means
  dropping their chain-and-day key from `taken`.
- **RSVPs on an extra night.** It inherits the chain's open roster.

### Rejected alternatives

1. **Polish the one-off.** Default `requiresRsvp` off when it borrows, allow labels, copy the
   ACL. That fixes the door but not the history: the night still doesn't count as Friday, and
   copying an access list creates a second list that goes stale.
2. **RFC 5545 `RDATE` on the rule.** It is standard, but the rule is read off whichever night is
   newest, so every edit would have to carry every past and future RDATE forward. An RDATE also
   takes the template's time of day, and extra nights usually run at their own times. An extra
   night is a fact about one night, not about the schedule.
3. **Make the extra a full rule instance that is excluded only from template selection.** Rejected
   because it gives the extra a rule that a later edit could re-enable. `recurrence: null` plus a
   pinned rule is the safer shape.

---

## Rough build order

1. `extra` on the type, converters, rules, and rules tests (`firestore-tests/`).
2. The projection guard and the "decides nothing about any other night" property test.
3. The history asymmetry in `sessionHistory` / `participation` / `predictiveRoster` /
   `insights`, with tests for each row of the table above. Run `scripts/sync-functions-shared.mjs`.
4. `createExtraNight` in `services/events.ts` and the editor's extra-night form.
5. Badges, the one-off pointer, the danger-zone count, and copy in all five locales.
6. An e2e journey (9 / 9b) and the docs: Journey 9 in `product.md`, the field row in
   `data-model.md`.

## Questions for you

1. **Recent window:** should an extra night take a slot? Recommended: no.
2. **MIA:** should attending an extra end a streak? Recommended: yes.
3. **Trend:** should an extra be plotted with a marker and kept out of the average, or not
   plotted? Recommended: plotted with a marker.
4. **Two services on one day:** is this a real need for v1?
5. **Name:** *Extra night* reads naturally for a Friday group but oddly for a Sunday morning. An
   alternative is *Extra session*, or *Special* with no noun.
