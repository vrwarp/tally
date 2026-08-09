# The scene: `events-locked`, and the journeys it has to serve

A companion to `BRIEF.md`, for one scene only. Read both.

## What this scene is

`uxr/baseline/events-locked--{phone,desktop}.html`, derived from the frozen
`events` scene by `uxr/locked-scene.ts`. It is the Events tab as it renders for
**a core-team member who has been added to almost nothing**: fourteen of the
fifteen past rows say `🔒 not yours`, and the one that does not is a lock-in he
ran himself.

This is not a hypothetical. It is the state a real core member reported, and the
word they used was *noisy*.

## Who is reading it

Call him Ben. Core team, not admin. He does the reporting, the imports, the
Tuesday follow-up calls and the term calendar. He has never stood at the Friday
door, so nobody ever added him to *Friday Fellowship*, and the Sunday team
closed *Sunday School* to themselves when they started rotating volunteers.

Ben is not locked out of Tally. He is locked out of two gatherings, and the
consequence of that reaches much further than the app currently admits.

## What "not yours" actually costs him — from the rules, not from guesswork

`firestore.rules` gates on `onChain(chainKey)`. For a chain Ben is not on:

| He wants to | Rule | Outcome |
| --- | --- | --- |
| See the gathering exists | `events: get, list: isActive()` | **Allowed.** Every row on this page is legitimately his to read. |
| See its head count | `attendance: get, list: … && onChain()` | Refused. This is the `🔒 not yours` on the row. |
| Open its page | client short-circuits | `LockedGathering` — a wall. |
| Take or fix its register | `attendance: create/update … && onChain()` | Refused. |
| **Edit the event** — move it, rename it, cancel it | `events: update: isCore() && onChain()` | **Refused.** |
| **Schedule next Friday** | `events: create: isCore() && onChain()` | **Refused, after the form.** |
| Manage its RSVPs | `rsvps: … && onChain()` | Refused. |
| Add himself | `eventAccess: update … writerStays()` / `AccessSheet` `onIt` | Refused — he cannot self-serve. |
| Import history into it | callable, gated on the chain | Refused. |

So the lock is not a detail of the right-hand column. **It is the state of two
thirds of this screen**, and the screen shows it in exactly one place: a 11px
grey caption at the end of a past row.

## The journeys

Graded by how often Ben does them and what the screen currently does to him.

### J1 — "Is next Friday on the calendar?" · weekly · **broken silently**
He scans *Upcoming*, sees Friday Fellowship is missing, and taps
**Schedule next Friday Fellowship** in *Next in each series*. The editor opens,
pre-filled and encouraging. He picks a room, taps Save, and the write is
refused. Nothing before the refusal told him this was not his to do. The quick
action is the single most-repeated act on this page and it is a trap for him.

### J2 — "What was the head count three weeks ago?" · weekly · **dead end**
He came for a number. Fourteen of the fifteen rows he can see are the wrong
answer, and the row he wants is one of them. The screen tells him *not yours*
and stops: no count, no route to a count, no name of anyone who has one. His
real next move is Slack, and the app does not know that.

### J3 — "Move the retreat to the 14th" · monthly · **wall**
He taps the row, gets `LockedGathering`, and that page does at least name
people who can add him. But he had to burn a navigation to find out, and the
row he tapped looked identical to the rows that work.

### J4 — "Nobody took Friday's register" · occasional · **wall, and worse**
Same wall, from a row whose caption said only *not yours* — a phrase about
possession, when the fact is about permission and the fix is a person.

### J5 — "Which of these is actually mine?" · every visit · **unanswerable**
The one question that would make the rest of the screen legible, and *Upcoming*
— the half he looks at first, the half with three hero cards and a blue button
— does not answer it at all. Ownership is invisible ahead of time and shouted
behind. Today's hero card, the loudest object on the page, is a gathering he
cannot open, wearing a full-width brand-blue **Open this gathering**.

### J6 — "Get me added to Friday" · once, then never · **not offered here**
The whole page knows who can add him — `LockedGatherings` on the check-in
screen already prints "Miriam or Dana can add you" from the same data. The
Events tab has that data in `useData().access` and does not use it.

### J7 — "Cancel Sunday, it's a holiday weekend" · termly · **wall**
### J8 — "Import last term's check-ins" · twice a year · **partially blocked**
Import is offered in the header at full strength and can only land on chains he
is on.

## The design question

Not "how do we hide the locks". Hiding them is the failure `LockedGatherings`
already argues against at length: a leader who sees an empty calendar concludes
Tally is broken, and a gathering that vanishes is a gathering nobody notices is
missing.

The question is: **can this screen stop making Ben find out fourteen times, one
row at a time, something it could tell him once?** And having told him, can it
give him the move he actually has — the name of somebody who can let him in —
instead of a padlock repeated down a column?

## Constraints, on top of `BRIEF.md`

- **Demotion, not disappearance.** Same rule as `LockedGatherings`. A locked
  gathering must remain findable on this screen.
- **No RSVP or attendance numbers for a locked chain.** There are none to show;
  inventing a placeholder is worse than the lock.
- **Do not offer a control that will be refused.** This is the loop's own
  finding from round 5, restated: a button that cannot work is worse than an
  absent one, because pressing it costs a form.
- **The counselor's check-in screen already solved the "today" half of this.**
  `LockedGatherings` is the established idiom — a divider, a collapsed group, a
  lock, a name. Reuse beats invention.
