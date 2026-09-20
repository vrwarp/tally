# The name tags a printer owes

When a kiosk's printer comes back after being down, it knows exactly which
children were checked in while it was — it queued those labels and watched them
fail. This is what it does with that, why it stops where it stops, and what the
ideation and critique loop threw out on the way.

The shipped surfaces are summarised for an operator in
[label-printing.md](label-printing.md#the-tags-that-missed-an-outage). This
document is the reasoning.

---

## The hole this filled

Before this, a failed label was a row in **Name tags tonight** on the staff
printer screen and nothing else. That list is honest and it is complete, but it
is four presses behind a two-second hold, and the one moment somebody would act
on it — standing at the printer, having just fixed it — is the moment they are
looking at the printer rather than at the tablet.

So the outcome was reliably this: the roll is reloaded, check-ins carry on, and
nine children are in rooms with nothing on them until somebody notices at
pick-up. The kiosk had the answer the whole time and no way to say it.

## The journeys

Five ways it happens, all ordinary, and the differences between them are what
the policy is made of:

1. **The roll runs out mid-queue.** Six families check in over four minutes
   before anyone notices. The person who reloads it is the person who was
   already there — this is the case the whole feature is aimed at, and the only
   one where somebody is standing at the printer when it recovers.
2. **The tablet is carried away.** Check-ins move to a bus door or a second
   entrance for ten minutes; the tablet comes back and is docked. Nothing was
   wrong with the printer — the tags are twenty minutes old by the time it is
   plugged in again, which is why the notice's clock runs from the *recovery*
   and not from the tags' age.
3. **Auto Power Off, or a cable.** The QL-800 series ships set to switch off
   after 60 minutes; a hub or a cleaner does the same thing less politely. The
   printer comes back *by itself*, often with nobody near it.
4. **A jam that took a few labels with it.** The failures are scattered through
   the evening rather than bunched, and some of those children left long ago.
5. **A family registered at the kiosk whose labels failed.** Nobody in the room
   has ever met these children, and their sticker is how the room learns their
   names. Their labels are also keyed to a temporary id until the callable
   answers, which is its own hazard.

Journey 3 is why nothing prints automatically. Journey 4 is why there is a
clock. Journey 5 is why the clock has an exception.

## What is there now

### 1. Owed is not the same as failed

`printing/index.ts` writes a tag into the owed set only when the failure was
painted as **trouble** — which is the state in which the parent is *not*
offered their own ten-minute hold. A label that died while the recovery was
still deciding whether the printer left leaves the state at `ready`, so the
parent standing at the glass can still print it themselves, and it is theirs
rather than a staff errand. A staff reprint that fails is never owed either:
the person who pressed it is watching it not work.

What reaches the offer is therefore the set nobody else can fix.

### 2. The policy is a pure module

`src/kiosk/owed.ts` answers one question — given what failed, what should a
volunteer be offered and what should already be ticked — and it needs no
printer, transport or worker to answer it. Three rules:

- **A tag has a job until the child leaves.** On a gathering that hands
  children back, the sticker carries the allergy line and the pickup match, so
  the *register* says when a tag stops mattering: owed until checked out, and
  every row arrives ticked. A clock there would be guessing at something the
  kiosk can simply look up.
- **Where nothing checks out, the clock stands in.** Ticked inside the
  ten-minute window the parent's own reprint uses — the same number, shared
  rather than restated, because it names the same walk — offered unticked for a
  while after, and gone at thirty minutes, by which time a sticker is an errand
  nobody asked for.
- **The child nobody has met comes first.** A family registered at this kiosk
  tonight stays ticked and stays offered however long it has been.

Rows are returned in **arrival order, oldest first**. Grade order and family
order were both considered and both lose to this one: arrival order is the
order the stack comes off the printer, which is the order the person carrying
it to a room reads it in.

### 3. Three surfaces, in rising order of attention

- **The amber mark** on the check-in screen. It meant *the printer needs a
  person*; a decision nobody has made is a person it needs, so it now lights
  for a working printer with tags waiting. It goes out when they are printed,
  skipped, or age out — and **skipping puts it out**, which was a deliberate
  decision: a mark that only a print could clear would be a mark that punishes
  the honest answer.
- **One line of words**, on the check-in screen, for ten minutes after the
  recovery and only while the glass has gone untouched for a few seconds. It
  leads to the same staff screen the mark does.
- **The staff menu and printer screen**, which lead with *N waiting* and offer
  **Print N name tags**.

### 4. The hand-off

The kiosk changes the screen under somebody's finger in exactly one case: the
printer became ready **because of a press on the printer screen** — the
browser's device chooser or **Look again** — there are tags owed, and the
printer screen is what is on the glass. Then the offer opens itself.

Everything about that is a guard against the same accident. A `ready` arriving
on its own has nobody to hand off to. A `ready` arriving while the *reprint
confirm* is open would put **Print 4 name tags** under a thumb already
descending on **Print name tag**. The press-caused ones are the only arrivals
that come with a modal the volunteer opened, which guarantees their finger is
off the glass when it closes. It fires once per recovery, not once per render.

### 5. One press settles the list

The ticked rows print; the unticked are let go, and the screen says so above
the button before it is pressed. A volunteer who printed three of nine and
walked away used to have settled nothing: the mark stayed lit, the menu still
said nine, and the next person was asked again about children somebody had
already decided against. The one thing that brings a tag back is the one thing
that should — a label that fails a second time is written down again.

### 6. The batch is its own lane

`queue.ts` gained a second lane that is **preferred last, never dropped as
stale, and never dropped for overflow**. Each of those is a rule the live lane
needs and a batch must not be subject to:

- a family standing at the glass never waits behind twelve tags;
- an owed tag is old by construction, so the two-minute staleness rule would
  throw away the entire feature;
- twelve tags is an ordinary outage and the live lane holds eight.

The batch prints the time each child **arrived**, not the time of the press:
`{{time}}` on a nursery sticker is what the room reads for how long a child has
been here, so the moment travels with the tag (`LabelJob.atMs` →
`tokenValuesFor`).

---

## The refusals

**It never prints by itself.** This was the first and most tempting design, and
journey 3 kills it: a printer that powers itself back on at 9:40 would put a
stack of stickers on the tape with nobody in the room. The queue already
refuses to be a spool across a reboot for exactly this reason — *a sticker for
a child who was checked out twenty minutes ago is litter on the floor* — and a
batch that arrives unasked is that spool with a delay on it.

**The notice is not a second door.** Its tap is the amber mark's own, so the
offer stays two screens away from a stray press in a queue, and nothing on the
parent's glass can print or settle anything. The wider hand-off — putting the
offer itself in front of whoever was standing there — was argued for on the
grounds that it is friendlier, and it is; what it is not is safe in a lobby,
where the person standing there is usually a parent. What survived of it is
§4: the same generosity, narrowed to the one arrival that proves a volunteer is
looking.

**Calm is not the same as "nobody is here".** `calm` — nothing typed, no
overlay, nobody in the wizard — is a fact about the screen: clearing a mistyped
name empties the buffer without anyone having gone anywhere, and every gap
between two families is calm. `useQuietGlass` adds a few seconds of stillness
on top of it, listens only while something wants the answer, and writes state
only on the edges.

**No new count on the parent's screen.** The check-in screen gained one dot
state and one line of words, both of which already had a place to live. A
badge, a counter or a coloured banner would be the kiosk telling a queue of
families about a printer, which the codebase refuses everywhere else.

---

## How it is put together

### New

- **`src/kiosk/owed.ts`** — the policy, pure: `offeredOwed`, `OWED_TICK_MS`
  (shared with `reprintOffer`), `OWED_AGE_OUT_MS`, `OWED_NOTICE_MS`,
  `OWED_QUIET_MS`.
- **`src/kiosk/screens/OwedScreen.tsx`** — the confirm, in `ConfirmScreen`'s
  grammar and at its row pitch. Group headings are the all-or-none control; a
  group of one draws no mark, because its row's own tick already is that
  control. `rowsThatFit` measures rather than counts, and always keeps one row
  on the glass.
- **`src/kiosk/components/useQuietGlass.ts`** — stillness on top of `calm`.

### Changed

- **`printing/queue.ts`** — `printOwed()`, the second lane, `onPrinted`, and
  jobs that carry `atMs` and `owable`.
- **`printing/index.ts`** — the owed ledger (`owedLabels`, `settleOwed`,
  `printOwedLabels`), `owe()` behind the recovery-deferred branch of
  `onFailure`, `cause: 'press'` on the ready state, and the ledger following a
  just-registered child through `adoptStudentId`.
- **`printing/tokens.ts`** — an optional `atMs`, so a late sticker says when
  the child arrived.
- **`KioskApp.tsx`** — the `owed` overlay, the recovery edge, the offered rows
  and their groups, the hand-off effect, and the four surfaces' props.
- **`PrinterScreen`** — a reserved news line, the batch as the primary verb
  while the printer is ready, and log rows on the offer reading *Waiting*
  rather than wearing the failure ring.
- **`SearchScreen`** — the notice, as a sibling of the results column.
- **`StaffScreen`** — *N waiting* leading the printer line.

### Tested

`owed.test.ts` (the policy, to the millisecond), `OwedScreen.test.tsx` (the
list and its commit), `KioskApp.owed.test.tsx` (the journey end to end),
plus the owed-lane cases in `printing/queue.test.ts` and the ledger cases in
`printing/index.test.ts`.

The harness at `uxr/kiosk-live/?screen=owed&owed=6` mounts the shipped screen
with six tags straddling the ten-minute tick; `?owed=6` alone drives the mark,
the notice, the staff menu's line and the printer screen's offer from one
number.
