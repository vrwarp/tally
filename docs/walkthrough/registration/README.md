# Registering a family at the kiosk

Captured from the running app by `e2e/registration-walkthrough.spec.ts`. Rebuild the page with
`npx tsx scripts/build-registration-walkthrough.ts`.

Every frame is the real lobby screen driving the real callable against a seeded emulator: the
pairing handshake happens, and the family at the end exists in Firestore and is checked in
against a real gathering.

## Finding the door

### 1. The kiosk at rest

*Nobody has typed anything* · `search` · 0 taps from the resting screen

Where every journey in this document starts, and the only screen a family sees before they touch anything. The door out of it is already on the glass, in the row above the keyboard — it has to be: a parent told "just put your name in" types their child's name, gets somebody else's Noah back, and never fails a search to be offered anything. Low-key and fixed-height, so a keystroke never moves the keyboard.

![The kiosk at rest — landscape](shots/landscape-01-the-kiosk-at-rest.png)

<img src="shots/portrait-01-the-kiosk-at-rest.png" width="320" alt="The kiosk at rest — portrait">

### 2. No match

*Not on the roster* · `search (no match)` · 4 taps from the resting screen

What a family nobody has met used to meet here was "No match — please see a leader", and nothing else. Seeing a leader is still the right last word when something is wrong with the search; it was never the right first one for being new. Two offers sit under the empty result and they answer different questions: a family somebody added while they queued needs the kiosk to look again, and a family nobody has ever met needs a form.

![No match — landscape](shots/landscape-02-no-match.png)

<img src="shots/portrait-02-no-match.png" width="320" alt="No match — portrait">

## Your child

### 3. Child's first name

*Registering — question 1 of 6* · `child-first` · 5 taps from the resting screen

One tap from the offer and the first question is up — the QR screen that used to stand between them retired with the phone form it pointed at. One question per screen in the frame the search already uses. The readout names the field rather than saying "type here", which matters most on the two steps where the answer could belong to either person in the room: "Child's last name" and "Your last name" are the same box until one of them says which.

![Child's first name — landscape](shots/landscape-03-child-s-first-name.png)

<img src="shots/portrait-03-child-s-first-name.png" width="320" alt="Child's first name — portrait">

### 4. Capitals, and a key to argue with them

*Registering — question 1 of 6* · `child-first (typed)` · 10 taps from the resting screen

The first letter is a capital without anybody asking, and so is the letter after every space, hyphen and apostrophe — the boundaries a name actually has, which is what makes Anne-Marie and O'Brien come out right on their own. But no rule short of a dictionary gets McDonald and van der Berg too, so the shift key is there beside them: it cycles off, on and locked the way every phone does, and the letters wear the state so a key shows exactly what it will produce.

![Capitals, and a key to argue with them — landscape](shots/landscape-04-capitals-and-a-key-to-argue-with-them.png)

<img src="shots/portrait-04-capitals-and-a-key-to-argue-with-them.png" width="320" alt="Capitals, and a key to argue with them — portrait">

### 5. Child's last name, with nothing to carry

*Registering — question 2 of 6* · `child-last` · 11 taps from the resting screen

The first child of a new family is the one time this box opens empty — there is no previous child to borrow a surname from, and the kiosk does not know the family yet. Every later surname in this run arrives prefilled. An identical-looking screen that behaves differently four frames from now is worth seeing twice.

![Child's last name, with nothing to carry — landscape](shots/landscape-05-child-s-last-name-with-nothing-to-carry.png)

<img src="shots/portrait-05-child-s-last-name-with-nothing-to-carry.png" width="320" alt="Child's last name, with nothing to carry — portrait">

### 6. A surname nobody can spell for them

*Registering — question 2 of 6* · `child-last (typed)` · 21 taps from the resting screen

Twelve keystrokes on glass, and the only check on them is a parent reading the readout above the keys. This is the screen where a typo becomes a roster row, a sticker and a record in the church's database — and the readout is deliberately the same object the search screen taught them to read two taps ago.

![A surname nobody can spell for them — landscape](shots/landscape-06-a-surname-nobody-can-spell-for-them.png)

<img src="shots/portrait-06-a-surname-nobody-can-spell-for-them.png" width="320" alt="A surname nobody can spell for them — portrait">

### 7. Grade, or none

*Registering — question 3 of 6* · `child-grade` · 22 taps from the resting screen

Fourteen chips and "No grade", which is an answer rather than a blank somebody fills in later: a child too young for a grade has none. On a gathering that hands children back the question opens on "No grade" for the same reason — making a parent clear a field is the same mistake as making a volunteer reach for undo. Choosing is the whole step: a chip advances, so there is no state between picking and moving on.

![Grade, or none — landscape](shots/landscape-07-grade-or-none.png)

<img src="shots/portrait-07-grade-or-none.png" width="320" alt="Grade, or none — portrait">

### 8. Allergies, only where they can land

*Registering — question 4 of 6* · `child-allergies` · 23 taps from the resting screen

The fourth question, and it only exists when the church's own database takes full write-back — the same gate the retired phone form kept, because collecting a medical note into a screen that silently drops it is worse than never asking. The common answer is the tick under the box rather than anything typed into it: a medical field with a keyboard under it and no visible way to say "nothing" collects "None" and "N/A" as though they were notes.

![Allergies, only where they can land — landscape](shots/landscape-08-allergies-only-where-they-can-land.png)

<img src="shots/portrait-08-allergies-only-where-they-can-land.png" width="320" alt="Allergies, only where they can land — portrait">

### 9. A real note, typed on a lobby keyboard

*Registering — question 4 of 6* · `child-allergies (typed)` · 44 taps from the resting screen

The minority answer, and the one nobody has photographed before. The field takes digits as well as letters — "Type 1 diabetes", "EpiPen 0.3" is legitimate medical text — and it takes no comma or full stop, because two more keys would change the keyboard's geometry on every screen including search. Whether a parent can say what they need to say inside that alphabet is a fair thing to argue about, and this is the frame to argue about it on.

![A real note, typed on a lobby keyboard — landscape](shots/landscape-09-a-real-note-typed-on-a-lobby-keyboard.png)

<img src="shots/portrait-09-a-real-note-typed-on-a-lobby-keyboard.png" width="320" alt="A real note, typed on a lobby keyboard — portrait">

### 10. Ticked, and the box goes quiet

*Registering — question 4 of 6* · `child-allergies (ticked)` · 45 taps from the resting screen

What the tick does, rather than only that it is there — and here it does it to a note that was actually typed. The box empties and dims and the keyboard goes with it, so the question is visibly answered and there is nothing left to type into. Anything already typed is cleared rather than hidden behind the grey: a note that survived out of sight would be a note nobody agreed to send. Unticking reopens an empty box, not the old text.

![Ticked, and the box goes quiet — landscape](shots/landscape-10-ticked-and-the-box-goes-quiet.png)

<img src="shots/portrait-10-ticked-and-the-box-goes-quiet.png" width="320" alt="Ticked, and the box goes quiet — portrait">

### 11. Anybody else?

*One child banked* · `another` · 46 taps from the resting screen

The fork that makes this worth doing at a kiosk at all: a parent with three children walks the loop three times rather than queueing three times. Who is on the list so far is named above the buttons, because the question cannot be answered against a parent's memory of what they typed forty seconds ago — least of all the parent of four, who is exactly who this loop is for. It is also the last chance to catch a child entered twice, or one whose name went in wrong.

![Anybody else? — landscape](shots/landscape-11-anybody-else.png)

<img src="shots/portrait-11-anybody-else.png" width="320" alt="Anybody else? — portrait">

## Child 2

### 12. Round two, from the top

*Second child — question 1 of 4* · `child-first (child 2)` · 47 taps from the resting screen

The loop returns to exactly the screen the run opened on, with the header counting: "Child 2" rather than "Your child". Nothing else is carried into the first-name question, and nothing could be. The honest question about this frame is whether a parent who has just answered four questions can tell they are at the start of four more.

![Round two, from the top — landscape](shots/landscape-12-round-two-from-the-top.png)

<img src="shots/portrait-12-round-two-from-the-top.png" width="320" alt="Round two, from the top — portrait">

### 13. Three letters, same keyboard

*Second child — question 1 of 4* · `child-first (child 2, typed)` · 50 taps from the resting screen

Identical mechanics to the first child, photographed anyway: the repeats are the part of this flow most likely to be worth cutting, and a document that showed them once could not be used to argue about them.

![Three letters, same keyboard — landscape](shots/landscape-13-three-letters-same-keyboard.png)

<img src="shots/portrait-13-three-letters-same-keyboard.png" width="320" alt="Three letters, same keyboard — portrait">

### 14. The surname, carried

*Second child — question 2 of 4* · `child-last (carried)` · 51 taps from the resting screen

The second child's last name arrives already typed, and the shift key is down rather than up — the next keystroke belongs mid-word, not at the start of one. This is the whole argument for a wizard over a form: the questions know what the family has already said, and a form cannot. It is still a full screen and a full tap for an answer the kiosk already has.

![The surname, carried — landscape](shots/landscape-14-the-surname-carried.png)

<img src="shots/portrait-14-the-surname-carried.png" width="320" alt="The surname, carried — portrait">

### 15. Grade again, with no memory

*Second child — question 3 of 4* · `child-grade (child 2)` · 52 taps from the resting screen

Fourteen chips a second time, opening on the same default as the first child rather than near the sibling just entered. Families arrive in bands — a four-year-old and a six-year-old, not a four-year-old and a fifteen-year-old — so whether this grid should lean on the answer above it is a real question this frame exists to ask.

![Grade again, with no memory — landscape](shots/landscape-15-grade-again-with-no-memory.png)

<img src="shots/portrait-15-grade-again-with-no-memory.png" width="320" alt="Grade again, with no memory — portrait">

### 16. Allergies, asked again from scratch

*Second child — question 4 of 4* · `child-allergies (child 2)` · 53 taps from the resting screen

Each child answers for themselves: the tick is cleared on every entry to this step, so the second child is never silently answered by the first. Correct, and it is also the fourth screen in ninety seconds asking a parent about medicine.

![Allergies, asked again from scratch — landscape](shots/landscape-16-allergies-asked-again-from-scratch.png)

<img src="shots/portrait-16-allergies-asked-again-from-scratch.png" width="320" alt="Allergies, asked again from scratch — portrait">

### 17. Both of them, named

*Two children banked* · `another (two children)` · 55 taps from the resting screen

The same fork one child later, with the allergy note from the first child printed under her name — this list is the family checking their own typing, the one moment the person reading the note is the person who wrote it. Nothing about this screen asks a parent to remember anything.

![Both of them, named — landscape](shots/landscape-17-both-of-them-named.png)

<img src="shots/portrait-17-both-of-them-named.png" width="320" alt="Both of them, named — portrait">

## And you

### 18. Your first name

*Adult — question 1 of 3* · `guardian-first` · 56 taps from the resting screen

The wizard turns to the adult, and the header says so: "And you". The readout carries the whole of the distinction between this screen and the four before it — the frame, the keyboard and the button are identical, and "Your first name" is the only thing on the glass that says whose name is wanted. Worth deciding whether that is enough at arm's length in a lobby.

![Your first name — landscape](shots/landscape-18-your-first-name.png)

<img src="shots/portrait-18-your-first-name.png" width="320" alt="Your first name — portrait">

### 19. Typed, and the door is still open

*Adult — question 1 of 3* · `guardian-first (typed)` · 61 taps from the resting screen

Nothing on this screen says the number two questions away is the part that matters, or that the name is what a volunteer will use to find this family at pickup. The step is cheap; whether it earns its place before the phone number is a fair question.

![Typed, and the door is still open — landscape](shots/landscape-19-typed-and-the-door-is-still-open.png)

<img src="shots/portrait-19-typed-and-the-door-is-still-open.png" width="320" alt="Typed, and the door is still open — portrait">

### 20. Your last name, borrowed from the child

*Adult — question 2 of 3* · `guardian-last (carried)` · 62 taps from the resting screen

Prefilled with the first child's surname, which is right far more often than it is wrong and is one Clear away when it is not — a step-parent, a different name, a family that does not share one. The prefill is silent: nothing on the screen says where those letters came from, so a parent who does share the name presses Next, and a parent who does not has to notice.

![Your last name, borrowed from the child — landscape](shots/landscape-20-your-last-name-borrowed-from-the-child.png)

<img src="shots/portrait-20-your-last-name-borrowed-from-the-child.png" width="320" alt="Your last name, borrowed from the child — portrait">

### 21. A dialer, for the one question that is a number

*Adult — question 3 of 3* · `guardian-phone` · 63 taps from the resting screen

The QWERTY row can type digits, but picking ten targets out of forty-three on a tablet while a queue watches is asking for a mistake in the one field where a mistake is expensive: four of these digits become the family's key for every visit after this one. The line above says why it is being asked for while a parent decides whether to give it — and it is the only thing on this screen Tally will not keep. The number lives inside one call, long enough to build the family in the church's own database and to be reduced to four digits for the kiosk index.

![A dialer, for the one question that is a number — landscape](shots/landscape-21-a-dialer-for-the-one-question-that-is-a-number.png)

<img src="shots/portrait-21-a-dialer-for-the-one-question-that-is-a-number.png" width="320" alt="A dialer, for the one question that is a number — portrait">

### 22. Grouped as they are typed

*Adult — question 3 of 3* · `guardian-phone (partial)` · 69 taps from the resting screen

Six digits in, and the readout is already punctuating them the way a phone number is read aloud. Next stays dead until there are ten: an incomplete number is refused on the glass rather than after a round trip.

![Grouped as they are typed — landscape](shots/landscape-22-grouped-as-they-are-typed.png)

<img src="shots/portrait-22-grouped-as-they-are-typed.png" width="320" alt="Grouped as they are typed — portrait">

### 23. Ten digits

*Adult — question 3 of 3* · `guardian-phone (complete)` · 73 taps from the resting screen

A number nobody could ring is refused here rather than after the round trip, and a repdigit — the thing somebody types to get past a field they do not want to answer — is refused too. This is the last keystroke of the run; everything after it is a decision, not typing.

![Ten digits — landscape](shots/landscape-23-ten-digits.png)

<img src="shots/portrait-23-ten-digits.png" width="320" alt="Ten digits — portrait">

### 24. Does this look right?

*Ready to check in* · `confirm` · 74 taps from the resting screen

The whole family on one screen, and one button. Everything before this was reversible with Back; this is the point where two children join the ministry's roster and are marked present, as a single act. Back reopens the previous question — it does not walk into an earlier child, so a wrong name three screens up is a restart.

![Does this look right? — landscape](shots/landscape-24-does-this-look-right.png)

<img src="shots/portrait-24-does-this-look-right.png" width="320" alt="Does this look right? — portrait">

### 25. One moment

*The call is in flight* · `submitting` · 75 taps from the resting screen

Cancel goes invisible while the call is out, because a half-written family is worse than a slow one — but look at the other corner: **Back** is still there, and on this step `goBack` has no case, so it falls through to closing the whole flow. The write still lands; the family loses the screen that teaches them their four digits. Everything else here is absence: "Saving…" and a header, and no sense of how long, for a callable that writes children, a household and a check-in. This is the one frame in the document whose timing is arranged — the request is held for a second and a half so the screen exists long enough to photograph.

![One moment — landscape](shots/landscape-25-one-moment.png)

<img src="shots/portrait-25-one-moment.png" width="320" alt="One moment — portrait">

### 26. Next time, just type those four digits

*On the roster, checked in* · `success` · 75 taps from the resting screen

Both children exist, both are checked in against tonight's gathering, and a sticker is coming out of the printer for each of them. The sentence under the tick is the part that matters next week: the last four digits of the number they just gave are the search this kiosk already had, and this is where the family learns it. That is the entire handoff — no account, no password, no app. It clears itself after eight seconds.

![Next time, just type those four digits — landscape](shots/landscape-26-next-time-just-type-those-four-digits.png)

<img src="shots/portrait-26-next-time-just-type-those-four-digits.png" width="320" alt="Next time, just type those four digits — portrait">

### 27. And it works immediately

*Findable* · `search (by last 4)` · 80 taps from the resting screen

Typed on the same screen, seconds later. Nothing was refetched: the answer came back with the registration and went straight into what this kiosk holds. It survives the nightly rebuild too — that job reads the church's backends, which may not know this number for hours or, on a deployment that cannot write households, ever, so a registration keeps its digits in an overlay the rebuild folds in rather than overwrites.

![And it works immediately — landscape](shots/landscape-27-and-it-works-immediately.png)

<img src="shots/portrait-27-and-it-works-immediately.png" width="320" alt="And it works immediately — portrait">

## The second child

### 28. The other door, in the same slot

*On the confirm screen* · `confirm (check-in)` · 86 taps from the resting screen

A parent whose next child is finally old enough starts here, not at the front door: they have already found their family by phone and tapped a name. The offer sits below the main action in the smaller weight, because it is the rarer of the two things somebody came to this screen to do — and it is on this screen at all because this is where the kiosk knows which family is standing in front of it.

![The other door, in the same slot — landscape](shots/landscape-28-the-other-door-in-the-same-slot.png)

<img src="shots/portrait-28-the-other-door-in-the-same-slot.png" width="320" alt="The other door, in the same slot — portrait">

### 29. The cheaper answer, offered first

*Searching the roster first* · `sibling search` · 87 taps from the resting screen

Both readings of that link are real journeys. The common one is a sibling already on the roster whom the phone search did not surface — the church has them, the family folk simply do not line up — and finding them costs nothing and creates nothing. So this screen searches by name, shows the family's own rows greyed and inert so nobody taps a child twice, and keeps "add a new child" as a standing offer rather than the destination. A registration is the expensive answer and it is one tap further away.

![The cheaper answer, offered first — landscape](shots/landscape-29-the-cheaper-answer-offered-first.png)

<img src="shots/portrait-29-the-cheaper-answer-offered-first.png" width="320" alt="The cheaper answer, offered first — portrait">

### 30. "Another child", not "their brother"

*Sibling — question 1 of 4* · `child-first (sibling mode)` · 88 taps from the resting screen

The same first question, under a header that refuses to claim a relationship: the kiosk inferred kinship from four phone digits, and this wizard is reached from the screen that exists for everyone that inference is wrong about — a cousin, a neighbour's boy, a child on a different number. "Another child" is the only relationship it can actually vouch for: they arrived together.

!["Another child", not "their brother" — landscape](shots/landscape-30-another-child-not-their-brother.png)

<img src="shots/portrait-30-another-child-not-their-brother.png" width="320" alt=""Another child", not "their brother" — portrait">

### 31. The surname it does not carry

*Sibling — question 2 of 4* · `child-last (sibling mode, empty)` · 94 taps from the resting screen

Empty — and this is the frame that shows why every step deserves a photograph. The prefill offers the surname of the previous child *in this run*, and a sibling run has none: the family being joined is on the confirm screen behind the wizard, not in the draft. The kiosk knows which household this is well enough to file the child into it, and still asks a parent to type a surname it is holding.

![The surname it does not carry — landscape](shots/landscape-31-the-surname-it-does-not-carry.png)

<img src="shots/portrait-31-the-surname-it-does-not-carry.png" width="320" alt="The surname it does not carry — portrait">

### 32. Grade, unchanged by any of it

*Sibling — question 3 of 4* · `child-grade (sibling mode)` · 99 taps from the resting screen

The same fourteen chips, opening on the same default, for a child whose siblings the kiosk has on screen. Nothing about the family it is joining narrows the grid.

![Grade, unchanged by any of it — landscape](shots/landscape-32-grade-unchanged-by-any-of-it.png)

<img src="shots/portrait-32-grade-unchanged-by-any-of-it.png" width="320" alt="Grade, unchanged by any of it — portrait">

### 33. Allergies, for the joining child

*Sibling — question 4 of 4* · `child-allergies (sibling mode)` · 100 taps from the resting screen

Asked here too, and on the same terms: the note goes to the reviewer and then upstream, and the kiosk keeps a marker rather than the text.

![Allergies, for the joining child — landscape](shots/landscape-33-allergies-for-the-joining-child.png)

<img src="shots/portrait-33-allergies-for-the-joining-child.png" width="320" alt="Allergies, for the joining child — portrait">

### 34. Anybody else, on the sibling path too

*One child banked* · `another (sibling mode)` · 102 taps from the resting screen

The loop is the same one the family wizard uses — a parent bringing two new children to a household the church already has walks it twice. The fork is worth seeing on this path because the run it ends is two questions long, and a screen that exists to offer a repeat sits at the end of it either way.

![Anybody else, on the sibling path too — landscape](shots/landscape-34-anybody-else-on-the-sibling-path-too.png)

<img src="shots/portrait-34-anybody-else-on-the-sibling-path-too.png" width="320" alt="Anybody else, on the sibling path too — portrait">

### 35. Joining the family that exists

*Two questions, no adult* · `confirm (sibling mode)` · 103 taps from the resting screen

No name, no phone number, no second household invented — the confirm names the siblings this child is being added to and that is the whole of it. The kiosk resolved the family from the four digits it searched with; the server re-verifies every one of those ids before it believes any of them, and at approval the household comes from an existing sibling rather than from the children in the run. That last part is the fix for a real bug: a family gaining a second child used to gain a second household, with the first child left behind in the original and invisible from the new one.

![Joining the family that exists — landscape](shots/landscape-35-joining-the-family-that-exists.png)

<img src="shots/portrait-35-joining-the-family-that-exists.png" width="320" alt="Joining the family that exists — portrait">

### 36. One moment, again

*The call is in flight* · `submitting (sibling mode)` · 104 taps from the resting screen

The same spinner, at the end of a run a quarter as long, and held the same way. What a family waits on here is identical to what the six-question run waits on, which is a point in the sibling path's favour and an argument about the other one.

![One moment, again — landscape](shots/landscape-36-one-moment-again.png)

<img src="shots/portrait-36-one-moment-again.png" width="320" alt="One moment, again — portrait">

### 37. Recorded, not decided

*Checked in, held for review* · `success (sibling mode)` · 104 taps from the resting screen

Nothing reached Planning Center. Every child a family registers is written held, and the hold is the only thing that gates the push — both backends, both sweeps, the on-create trigger and the re-create repair all consult it. What happens next happens on a weekday, on a core-team screen, with the form as the family typed it beside any roster row that shares a name: approve, merge, or discard. The door records; a person decides. Note what this screen does *not* say: there is no four-digit line here, because a sibling run never asked for a number.

![Recorded, not decided — landscape](shots/landscape-37-recorded-not-decided.png)

<img src="shots/portrait-37-recorded-not-decided.png" width="320" alt="Recorded, not decided — portrait">

## The edges

### 38. As many as one go takes

*Six children — the cap* · `another (at MAX_CHILDREN)` · 174 taps from the resting screen

Six is the wizard's cap and the server's. **Add another child** goes dead and a line under the buttons explains it — the first time in the flow a parent is told no. A family of seven is rare and real, and what happens to them is a sentence pointing at a leader. The list above the buttons is also, at six rows, doing the most work it will ever do.

![As many as one go takes — landscape](shots/landscape-38-as-many-as-one-go-takes.png)

<img src="shots/portrait-38-as-many-as-one-go-takes.png" width="320" alt="As many as one go takes — portrait">

### 39. Six rows and a button

*Six children on one confirm* · `confirm (six children)` · 195 taps from the resting screen

The last screen before a record goes upstream, holding as much as it ever has to. The list hangs from the bottom against the button on purpose — on a portrait tablet a family's children used to sit a thousand pixels from the control that files them — and this is the frame that shows what that costs when the list is long. Whether the parent of six can check six names here, on the one screen where checking is the entire job, is the question. This run was cancelled rather than submitted; nothing on it reached the roster.

![Six rows and a button — landscape](shots/landscape-39-six-rows-and-a-button.png)

<img src="shots/portrait-39-six-rows-and-a-button.png" width="320" alt="Six rows and a button — portrait">
