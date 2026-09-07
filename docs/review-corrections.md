# Correcting a family on the Review screen

Five journeys, and the guidance that follows from them. The screen is
`/review` — [`src/features/review/ReviewPage.tsx`](../src/features/review/ReviewPage.tsx) — and
the change this document describes is the ability to fix what a family typed
before approving them into the church's database.

---

## Why there was a hole here

The lobby kiosk takes a stranger's typing, on a touchscreen, standing up, with a
queue behind them. That is a deliberate trade: [product.md](product.md), journey
4c, argues that a duplicate a reviewer merges on Tuesday is a smaller problem
than a child checked in as somebody else on Sunday, so the door records rather
than judges.

Which makes Tuesday the moment every judgement lands. And until now the Review
screen offered exactly three answers, all of them about **identity**:

| Answer | What it decides |
| --- | --- |
| **Approve and add** | These people are real and new — put them in the church's database, permanently. |
| **Merge** | This child is a roster row we already have. |
| **Not ours** | None of this should be on the roster. |

None of them is *the details are wrong*. A reviewer holding a card that said
`Micheal Okonkwo` had two moves: approve the misspelling into a database with no
delete, or discard a real family and lose the only phone number Tally holds for
them. Both are wrong, and the second is worse. In practice reviewers took the
first — which is how a ministry accumulates *Micheal*, *MOM SMITH*, and a
seven-year-old filed as a kindergartener.

---

## The journeys

### Journey A — the misspelling that would have become permanent

*Chidi registers at the kiosk on Friday. In the queue, on a glass keyboard, he
types his son as `Micheal`. The church already has a `Michael Okonkwo` on the
roster — the boy came last spring with a friend.*

Tuesday, Rita opens `/review`. The card shows `Micheal Okonkwo · 5th grade`, no
duplicate warning, and a blue **Approve and add** button. There is no warning
*because* of the typo: the door's duplicate scan matched on the name as typed,
and `Micheal` collides with nobody.

She taps **Edit** on the child's row, fixes the spelling, and saves. The card
comes back changed: `Michael Okonkwo`, a **Possible duplicate** badge, the
approve button held, and `Michael Okonkwo · 4th grade · Same phone digits on
file` offered as a candidate to merge into. A toast says *"Saved — and one
student on the roster now shares Michael's name. Settle their row before
approving."*

**The point of this journey is the second half.** A correction that only fixed
the spelling would have handed her a clean-looking card and a released button
over a duplicate the fix itself created. Renaming a child re-runs the roster
scan, server-side, in the same call.

### Journey B — the parent who is not a person yet

*The adult box on the card reads `MOM MARCHETTI`. The kiosk asked "who is
bringing them?" and a parent in a hurry answered the question they thought it
was asking.*

Approving this creates a **person** in Planning Center called MOM MARCHETTI,
attached to a household, for ever. This is the one field on the screen that
becomes a contact card somebody will later try to phone.

Rita taps **Edit** beside the phone number, types `Renata Marchetti`, saves.
The card's title changes with it, and a caption under the phone now reads *"Typed
at the kiosk as MOM Marchetti."* — so a colleague opening the card on Thursday
can see this is a correction and not the form.

### Journey C — the wrong digit

*A parent transposes two digits. The number on the card is not theirs.*

This is the most expensive typo on the screen and the least visible, because
those four digits are **not a display field** — they are the key the family
types at the lobby kiosk next week to find their own children. A wrong number
means three things at once:

1. the family types their real number on Friday and the kiosk does not know them;
2. somebody *else's* real number now finds the Marchetti children by name, which
   is the exact failure the kiosk's search screen is built around; and
3. the only way to ring this family about a pickup is wrong.

Rita corrects it. The save caption says what will happen before it happens:
*"Changes the digits this family types at the kiosk from 3344 to 3355 — the old
four stop finding them."* Both halves run: the children are added to the new
bucket in `kioskIndex/phones` **and removed from the old one**.

### Journey D — the grade that was a guess

*`No grade` on a fourth-grader, or `6th` on a child who is in 5th.*

Small, and it does two things. The grade is a filter on the check-in roster, and
it is one of the two discriminators on the merge picker — a candidate whose
grade matches is drawn emphasised, because a name alone is often not enough to
tell two children apart. A wrong grade makes the duplicate comparison worse at
exactly the moment somebody is leaning on it.

Two taps in the same editor, from the same select the kiosk offered, with **No
grade** as the first option because it is an answer and not a blank.

### Journey E — the allergy note

*The note says `epi pen in bag`. Rita, who spoke to the mother at the door,
knows it is peanuts.*

The allergy note is pushed into Planning Center's medical notes when the family
is approved, and after that it is what a leader reads. It is also the only field
on this screen with a safety consequence. She edits it to `Peanut allergy —
carries an EpiPen in her bag` before approving.

### What is deliberately *not* here

**Adding or removing a child.** A child on a registration is already a roster
row carrying a check-in from Friday night. Removing one means deactivating that
row, which is a different decision with a different blast radius, and it already
has two homes: **Not ours** for the whole family, and the student's own page for
one of them. Adding one means a child who was never at the door being invented
by somebody who was not there either.

**Anything upstream.** Every correction here is Tally-only. That is what makes
it safe, and it is why the editor disappears the moment a child has been pushed:
renaming Tally's copy of a child the church's database already holds would leave
two spellings and nothing to say which is right. The card says so and points at
the student's page, which knows how to carry a rename upstream.

---

## UXR guidance

Ten rules the implementation follows. Each one is a thing that would otherwise
go wrong on a Tuesday.

### 1. Deciding is the job. Editing is not.

The screen's default state does not change: a read-only card, three decisions,
the form as the family typed it. Editing is entered per person, one person at a
time, and leaves no trace when it is closed. A card that opened as a form would
be a card that invites correction of things that are not wrong — and every
keystroke here is a keystroke about a child a stranger typed and nobody in the
building has met.

### 2. A correction is not a decision, and must not be dressed as one.

Every `Button` on this card either writes to a database with no undo or refuses
to. **Edit** is therefore *not* a Button: it is the same quiet ringed target
as **Undo**, at 44px so a thumb can still land it. Giving the least consequential
control on the screen the most consequential clothes is how a reviewer learns to
distrust the blue ones.

### 3. Say what a save does — including the part nobody expects.

The card's existing grammar is *a sentence, then the control*, with the sentence
above so a thumb does not cover it. The editors keep it:

- renaming → *"Renames this row on Tally's roster and asks the roster again
  whether anybody already has that name. Nothing is sent to the church's
  database."*
- a moved number → *"Changes the digits this family types at the kiosk from 3344
  to 3355 — the old four stop finding them."*

The re-scan clause is the one that earns its place. Without it, a reviewer fixes
a spelling and watches the approve button they were reaching for go grey. That
reads as the app breaking; it is the app working, and the button that caused it
is the right place to say so.

### 4. Hold the card while a correction is open.

While an editor is open, everything else on the card is disabled — approve,
discard, merge, the same-family group, the guardian candidates, and the other
rows' **Edit** buttons. Two reasons, and the second is the real one:

- two open forms on a phone is a wall of boxes with two Saves in it; and
- **a card mid-correction is a card whose facts are in flux.** The duplicate
  candidates below belong to the name currently on the roster; the approve
  caption names children by names somebody is in the middle of changing.

### 5. The editor takes the row, not a modal.

A dialog would cover the duplicate candidates — which are exactly what the edit
may change — and on a phone it would cover the card entirely. The child editor
replaces the row's own body and is ringed in brand; the candidate list under it
is withdrawn while typing and comes back recomputed.

### 6. Refuse in the same words the door would have used, under the box.

The form and the Cloud Function share
[`src/lib/registrationFields.ts`](../src/lib/registrationFields.ts), copied
verbatim into the functions package by `scripts/sync-functions-shared.mjs`. A
digit typed into a name is refused under the field that holds it, immediately,
with the sentence the kiosk uses — not a round trip later in a toast at the edge
of the screen, and not a different sentence about the same rule.

A refusal from the **server** — "this child has already been pushed", "that name
is already on this registration" — is a banner *inside the open editor*, and the
editor stays open holding what was typed. A form that closes on a refusal has
thrown away the correction along with the reason for it.

### 7. Reset the judgements the correction invalidated.

A reviewer's local answers are assertions about facts that have just changed, so
saving drops them:

| Corrected | Dropped |
| --- | --- |
| a child's name | that child's merge resolution — including "none of them, they're new" |
| the adult | which upstream adult is "the same person" |
| the phone number | which other cards are "the same family" (the server groups those by digits) |

Leaving `None of them — Micheal is new` standing after the spelling is fixed
would walk a corrected name straight past the collision the correction created.

### 8. The card must stop claiming to be the form.

The whole card is captioned "as the family typed it", and that is the evidence
the merge judgement rests on. Once somebody edits, it is not true any more — so
a corrected row carries *"Typed at the kiosk as Micheal Okonkwo."* in the caption
voice, under the name it corrects. The bright run stays on the name that is
about to be approved; the provenance is a rung quieter.

Shown only where it differs. A caption reading "typed as Ada Okonkwo" under the
name *Ada Okonkwo* is noise on a screen whose job is to make one difference
visible.

### 9. Keep the typed names. Never keep the typed number.

The original names are kept on the registration record from the first correction
onwards, once, and never overwritten — the point is what the *family* typed, not
what the last reviewer saw.

The original **phone number is not kept**, and this is not an oversight. A
mistyped number belongs to a stranger, and holding a stranger's number for thirty
days to caption a correction is precisely the retention this collection's TTL
exists to prevent (see [data-model.md](data-model.md#the-one-place-tally-holds-a-parents-phone-number)).
That one *was* corrected is recorded instead, which is all a second reviewer
needs.

### 10. Only offer it where it can still matter — and that is a different question for each half.

No **Edit** button appears on a child who has been pushed or folded into
another roster row. Each would either lie about what it can change or edit a
document nobody will read.

The adult is *not* the same test, and the obvious version of it is wrong. "Are
the children still held?" gets two real cards backwards:

- a **counselor's contact** — a leader quick-added a visitor at a door
  and took a number down afterwards — is settled from the moment it is created,
  because that child was never held. The adult is the entire point of it.
- a **kiosk family whose guardian was refused** is settled too, and is kept
  precisely so somebody can try the adult again. A mistyped number is the
  likeliest reason for that refusal, so correcting it is the move that ends the
  job.

The adult is editable for as long as the adult has not been written, and the
record's own survival is the evidence — it is deleted the moment the guardian
lands. The one genuinely-too-late card is the mirror image: `lastErrorKind:
'children'` means the guardian went upstream and a child did not, so the record
now outlives its own adult.

A button whose only possible outcome is a refusal is worse than no button — and
the server refuses each of these anyway, because the screen is not the only
thing that can call it.

---

## Seeing it

A frame-by-frame walkthrough of all five journeys, captured from the running
component, is in
[`docs/walkthrough/corrections/`](walkthrough/corrections/README.md) — desktop
and phone side by side. Regenerate it with:

```bash
npm run walkthrough:corrections
```

---

## Where it lives

| Piece | File |
| --- | --- |
| The screen, the editors, the captions | `src/features/review/ReviewPage.tsx` |
| Field rules, shared verbatim with the server | `src/lib/registrationFields.ts` |
| The callable: rescan, index move, provenance | `functions/src/kiosk/amend.ts` |
| Entry point and role check | `functions/src/index.ts` (`amendRegistration`) |
| What the record holds afterwards | `docs/data-model.md` → `kioskRegistrations` |
| The walkthrough, and the harness that shoots it | `docs/walkthrough/corrections/`, `uxr/review-live/` |
