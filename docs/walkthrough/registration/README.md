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

### 3. The whole run, before any of it is answered

*Registering — question 1 of 4* · `child-first` · 5 taps from the resting screen

One tap from the offer, and what a parent meets is not one question on an empty screen but the run: their child's questions, then their own, named and in order. This region used to be a 664px hole — half an upright tablet — between the question and the keys that answer it. The question is said again against the keys, and the two are doing different jobs: the row is the index, saying where you are and what you will be able to go back and fix; the line above the rule is the question, in the same glance as the thumb.

![The whole run, before any of it is answered — landscape](shots/landscape-03-the-whole-run-before-any-of-it-is-answered.png)

<img src="shots/portrait-03-the-whole-run-before-any-of-it-is-answered.png" width="320" alt="The whole run, before any of it is answered — portrait">

### 4. Capitals, and a key to argue with them

*Registering — question 1 of 4* · `child-first (typed)` · 11 taps from the resting screen

The first letter is a capital without anybody asking, and so is the letter after every space, hyphen and apostrophe — the boundaries a name actually has, which is what makes Anne-Marie and O'Brien come out right on their own. But no rule short of a dictionary gets McDonald and van der Berg too, so the shift key is there beside them: it cycles off, on and locked the way every phone does, and the letters wear the state so a key shows exactly what it will produce. The doubled letter here is deliberate: it is the typo the repair five frames from now goes back for.

![Capitals, and a key to argue with them — landscape](shots/landscape-04-capitals-and-a-key-to-argue-with-them.png)

<img src="shots/portrait-04-capitals-and-a-key-to-argue-with-them.png" width="320" alt="Capitals, and a key to argue with them — portrait">

### 5. Child's last name, with nothing to carry

*Registering — question 2 of 4* · `child-last` · 12 taps from the resting screen

The first child of a new family is the one time this box opens empty — there is no previous child to borrow a surname from, and the kiosk does not know the family yet. Every later surname in this run arrives prefilled. An identical-looking screen that behaves differently is worth seeing twice.

![Child's last name, with nothing to carry — landscape](shots/landscape-05-child-s-last-name-with-nothing-to-carry.png)

<img src="shots/portrait-05-child-s-last-name-with-nothing-to-carry.png" width="320" alt="Child's last name, with nothing to carry — portrait">

### 6. A surname nobody can spell for them

*Registering — question 2 of 4* · `child-last (typed)` · 22 taps from the resting screen

Twelve keystrokes on glass, and the only check on them is a parent reading the readout above the keys. This is the screen where a typo becomes a roster row, a sticker and a record in the church's database — and the readout is deliberately the same object the search screen taught them to read two taps ago.

![A surname nobody can spell for them — landscape](shots/landscape-06-a-surname-nobody-can-spell-for-them.png)

<img src="shots/portrait-06-a-surname-nobody-can-spell-for-them.png" width="320" alt="A surname nobody can spell for them — portrait">

### 7. Fifteen chips, four across

*Registering — question 3 of 4* · `child-grade` · 23 taps from the resting screen

Four across rather than three is what puts fifteen chips in four rows instead of five — and four rows land in the keyboard's footprint to the pixel, so this question has the same console as every other and the rule above it does not move when the question changes. That is what the grade step gains: a **Next** and a readout it never had. A chip now selects rather than advancing, which costs a tap per child and buys a parent the sight of the year they picked before it reaches a sticker. Next stays dead until one is pressed, because the draft always holds a grade and "No grade" is an answer here rather than a default nobody chose.

![Fifteen chips, four across — landscape](shots/landscape-07-fifteen-chips-four-across.png)

<img src="shots/portrait-07-fifteen-chips-four-across.png" width="320" alt="Fifteen chips, four across — portrait">

### 8. Allergies, and the answer most families give

*Registering — question 4 of 4* · `child-allergies` · 25 taps from the resting screen

The fourth question, and it only exists when the church's own database takes full write-back — the same gate the retired phone form kept, because collecting a medical note into a screen that silently drops it is worse than never asking. The common answer is its own button rather than something typed into the box: a medical field with a keyboard under it and no visible way to say "nothing" collects "None" and "N/A" as though they were notes. **No allergies** is lit and **Next** is dead, because there is nothing yet to press Next with — which is also the answer to what a parent is meant to do with two buttons.

![Allergies, and the answer most families give — landscape](shots/landscape-08-allergies-and-the-answer-most-families-give.png)

<img src="shots/portrait-08-allergies-and-the-answer-most-families-give.png" width="320" alt="Allergies, and the answer most families give — portrait">

### 9. A real note, and the buttons trade places

*Registering — question 4 of 4* · `child-allergies (typed)` · 46 taps from the resting screen

The minority answer. The field takes digits as well as letters — "Type 1 diabetes", "EpiPen 0.3" is legitimate medical text — and it takes no comma or full stop, because two more keys would change the keyboard's geometry on every screen including search. Note what auto-capitalisation does to a medical note: the rule that makes Anne-Marie right title-cases every word here, and flattens the capitals inside EpiPen while it is at it. And note the band above: one letter was enough for **Next** to take the colour and for **No allergies** to go quiet. Colour says which answer is being offered; neither button moves.

![A real note, and the buttons trade places — landscape](shots/landscape-09-a-real-note-and-the-buttons-trade-places.png)

<img src="shots/portrait-09-a-real-note-and-the-buttons-trade-places.png" width="320" alt="A real note, and the buttons trade places — portrait">

## And you

### 10. The child is answered, and it shows

*One child banked — adult, question 1 of 3* · `guardian-first` · 47 taps from the resting screen

The child's last question banks them and the wizard turns to the adult — and nothing about that arrives as a surprise, because the adult's three questions have been on the glass since the first keystroke. There used to be a screen in this gap ("Anybody else?", with **That's everyone** under it) and then a line standing in for it; a run named in full needs neither. What the list is doing now is the second job: the name typed forty seconds ago is right there to check, without pressing Back to reach it.

![The child is answered, and it shows — landscape](shots/landscape-10-the-child-is-answered-and-it-shows.png)

<img src="shots/portrait-10-the-child-is-answered-and-it-shows.png" width="320" alt="The child is answered, and it shows — portrait">

### 11. The list holds still while a name is typed

*Adult — question 1 of 3* · `guardian-first (typed)` · 52 taps from the resting screen

Nothing above the rule changes on a keystroke — the list is drawn from what has been committed, and a keystroke touches the buffer and the shift state and nothing else. It is memoised on exactly that, so the subtree does not re-render while somebody types. The same discipline the keyboard already keeps, and for the same reason.

![The list holds still while a name is typed — landscape](shots/landscape-11-the-list-holds-still-while-a-name-is-typed.png)

<img src="shots/portrait-11-the-list-holds-still-while-a-name-is-typed.png" width="320" alt="The list holds still while a name is typed — portrait">

### 12. Your last name, borrowed from the child

*Adult — question 2 of 3* · `guardian-last (carried)` · 53 taps from the resting screen

Prefilled with the first child's surname, which is right far more often than it is wrong and is one Clear away when it is not — a step-parent, a different name, a family that does not share one. The prefill is silent: nothing on the screen says where those letters came from, so a parent who does share the name presses Next, and a parent who does not has to notice.

![Your last name, borrowed from the child — landscape](shots/landscape-12-your-last-name-borrowed-from-the-child.png)

<img src="shots/portrait-12-your-last-name-borrowed-from-the-child.png" width="320" alt="Your last name, borrowed from the child — portrait">

### 13. A dialer, for the one question that is a number

*Adult — question 3 of 3* · `guardian-phone` · 54 taps from the resting screen

The QWERTY row can type digits, but picking ten targets out of forty-three on a tablet while a queue watches is asking for a mistake in the one field where a mistake is expensive: four of these digits become the family's key for every visit after this one. The line above says why it is being asked for while a parent decides whether to give it — and it is the only thing on this screen Tally will not keep. The number lives inside one call, long enough to build the family in the church's own database and to be reduced to four digits for the kiosk index.

![A dialer, for the one question that is a number — landscape](shots/landscape-13-a-dialer-for-the-one-question-that-is-a-number.png)

<img src="shots/portrait-13-a-dialer-for-the-one-question-that-is-a-number.png" width="320" alt="A dialer, for the one question that is a number — portrait">

### 14. Grouped as they are typed

*Adult — question 3 of 3* · `guardian-phone (partial)` · 60 taps from the resting screen

Six digits in, and the readout is already punctuating them the way a phone number is read aloud. Next stays dead until there are ten: an incomplete number is refused on the glass rather than after a round trip.

![Grouped as they are typed — landscape](shots/landscape-14-grouped-as-they-are-typed.png)

<img src="shots/portrait-14-grouped-as-they-are-typed.png" width="320" alt="Grouped as they are typed — portrait">

### 15. Ten digits

*Adult — question 3 of 3* · `guardian-phone (complete)` · 64 taps from the resting screen

A number nobody could ring is refused here rather than after the round trip, and a repdigit — the thing somebody types to get past a field they do not want to answer — is refused too.

![Ten digits — landscape](shots/landscape-15-ten-digits.png)

<img src="shots/portrait-15-ten-digits.png" width="320" alt="Ten digits — portrait">

## Fixing something

### 16. One tap, five screens back

*A question reopened, mid-answer* · `child-first (reopened)` · 65 taps from the resting screen

A parent standing on the phone question sees the doubled letter in their child's name. The row is a button: tapping it opens that question with its own answer already in the box and the keyboard lower-case, because the next press is a correction to a word that is there rather than the start of a new one. The child it belongs to is banked and five screens behind, and none of that is a parent's problem any more. Only answered questions are buttons — jumping forward to one nobody has reached would leave a hole in the run and a blank on the confirm. The phone row is marked "back to this" rather than lit: still unanswered, and where **Next** returns. The ten digits already typed travel with it, because a parent taps a row *while* answering something — that is when they notice — and coming back to an empty box would lose work they can see. Back here is "never mind", so a row tapped by accident costs nothing.

![One tap, five screens back — landscape](shots/landscape-16-one-tap-five-screens-back.png)

<img src="shots/portrait-16-one-tap-five-screens-back.png" width="320" alt="One tap, five screens back — portrait">

### 17. Put back, not walked back

*Back where they were, with the digits intact* · `guardian-phone (resumed)` · 72 taps from the resting screen

Next commits the fix to the child it belongs to and returns straight to the question they were on, with their ten digits where they left them. The alternative — walking forward through everything between the typo and where they were — is five screens of re-confirming answers nobody changed, in front of a queue, to fix one letter.

![Put back, not walked back — landscape](shots/landscape-17-put-back-not-walked-back.png)

<img src="shots/portrait-17-put-back-not-walked-back.png" width="320" alt="Put back, not walked back — portrait">

## And you

### 18. Nothing above the rule has moved

*One child, ready to check in* · `confirm` · 73 taps from the resting screen

The confirm keeps the run. Press **Next** on the phone question and the body does not change at all — same eleven rows, same order, same place — while the console below it changes completely. The confirm used to replace all of this with a receipt of the same facts in a different shape, at the one moment a parent is asked to check them, and its rows stopped being buttons exactly when repair was being asked for. Here every row is still a button. And there are two questions on this screen rather than one: the header asks whether the typing is right, over the rows that answer that by touch; **Anyone else to add?** sits on top of the two buttons that answer *it*. The commit names who it is about to check in, which the adult's row is deliberately not part of — a guardian never gets an attendance row, and "Check in everyone" said otherwise in front of the family it named.

![Nothing above the rule has moved — landscape](shots/landscape-18-nothing-above-the-rule-has-moved.png)

<img src="shots/portrait-18-nothing-above-the-rule-has-moved.png" width="320" alt="Nothing above the rule has moved — portrait">

## Child 2

### 19. Round two, from the top

*Second child — question 1 of 4* · `child-first (child 2)` · 74 taps from the resting screen

The loop returns to exactly the screen the run opened on, with the header counting: "Child 2" rather than "Your child". The adult's three questions are not asked again — they have been answered, and this child's last question goes straight back to the confirm. Back from here abandons the half-typed child and returns to the confirm too, rather than closing a registration a parent has already answered seven questions for.

![Round two, from the top — landscape](shots/landscape-19-round-two-from-the-top.png)

<img src="shots/portrait-19-round-two-from-the-top.png" width="320" alt="Round two, from the top — portrait">

### 20. Three letters, same keyboard

*Second child — question 1 of 4* · `child-first (child 2, typed)` · 77 taps from the resting screen

Identical mechanics to the first child, photographed anyway: the repeats are the part of this flow most likely to be worth cutting, and a document that showed them once could not be used to argue about them.

![Three letters, same keyboard — landscape](shots/landscape-20-three-letters-same-keyboard.png)

<img src="shots/portrait-20-three-letters-same-keyboard.png" width="320" alt="Three letters, same keyboard — portrait">

### 21. The surname, carried

*Second child — question 2 of 4* · `child-last (carried)` · 78 taps from the resting screen

The second child's last name arrives already typed, and the shift key is down rather than up — the next keystroke belongs mid-word, not at the start of one. This is the whole argument for a wizard over a form: the questions know what the family has already said, and a form cannot. It is still a full screen and a full tap for an answer the kiosk already has.

![The surname, carried — landscape](shots/landscape-21-the-surname-carried.png)

<img src="shots/portrait-21-the-surname-carried.png" width="320" alt="The surname, carried — portrait">

### 22. Grade again, with no memory

*Second child — question 3 of 4* · `child-grade (child 2)` · 79 taps from the resting screen

Fourteen chips a second time, opening on the same default as the first child rather than near the sibling just entered. Families arrive in bands — a four-year-old and a six-year-old, not a four-year-old and a fifteen-year-old — so whether this grid should lean on the answer above it is a real question this frame exists to ask.

![Grade again, with no memory — landscape](shots/landscape-22-grade-again-with-no-memory.png)

<img src="shots/portrait-22-grade-again-with-no-memory.png" width="320" alt="Grade again, with no memory — portrait">

### 23. Allergies, asked again from scratch

*Second child — question 4 of 4* · `child-allergies (child 2)` · 81 taps from the resting screen

Each child answers for themselves: the box opens empty on every entry to this step, so the second child is never silently answered by the first. Correct, and it is also the fourth screen in ninety seconds asking a parent about medicine. The next frame is one press away — **No allergies** answers and moves on rather than ticking something Next then has to collect.

![Allergies, asked again from scratch — landscape](shots/landscape-23-allergies-asked-again-from-scratch.png)

<img src="shots/portrait-23-allergies-asked-again-from-scratch.png" width="320" alt="Allergies, asked again from scratch — portrait">

### 24. Both of them, and the button names them

*Two children, ready to check in* · `confirm (two children)` · 82 taps from the resting screen

Back at the confirm, one child heavier — and this is the second look at the first child's name, ten seconds after it was typed and again at the end. Every fact under its own label: "Adeyeminkx" beside **Last name** is easier to check than the same word run into a sentence, and the allergy note sits on the row that asked for it. The commit reads **Check in Chidi and Ada** rather than "Check in everyone", which named a set the kiosk does not act on: the adult below them is on this screen, is not checked in, and is now visibly not in the button either.

![Both of them, and the button names them — landscape](shots/landscape-24-both-of-them-and-the-button-names-them.png)

<img src="shots/portrait-24-both-of-them-and-the-button-names-them.png" width="320" alt="Both of them, and the button names them — portrait">

## And you

### 25. One moment

*The call is in flight* · `submitting` · 83 taps from the resting screen

Cancel goes invisible while the call is out, because a half-written family is worse than a slow one — but look at the other corner: **Back** is still there, and on this step `goBack` has no case, so it falls through to closing the whole flow. The write still lands; the family loses the screen that teaches them their four digits. Everything else here is absence: "Saving…" and a header, and no sense of how long, for a callable that writes children, a household and a check-in. This is the one frame in the document whose timing is arranged — the request is held for a second and a half so the screen exists long enough to photograph.

![One moment — landscape](shots/landscape-25-one-moment.png)

<img src="shots/portrait-25-one-moment.png" width="320" alt="One moment — portrait">

### 26. Next time, just type those four digits

*On the roster, checked in* · `success` · 83 taps from the resting screen

Both children exist, both are checked in against tonight's gathering, and a sticker is coming out of the printer for each of them. The sentence under the tick is the part that matters next week: the last four digits of the number they just gave are the search this kiosk already had, and this is where the family learns it. That is the entire handoff — no account, no password, no app. It clears itself after eight seconds.

![Next time, just type those four digits — landscape](shots/landscape-26-next-time-just-type-those-four-digits.png)

<img src="shots/portrait-26-next-time-just-type-those-four-digits.png" width="320" alt="Next time, just type those four digits — portrait">

### 27. And it works immediately

*Findable* · `search (by last 4)` · 88 taps from the resting screen

Typed on the same screen, seconds later. Nothing was refetched: the answer came back with the registration and went straight into what this kiosk holds. It survives the nightly rebuild too — that job reads the church's backends, which may not know this number for hours or, on a deployment that cannot write households, ever, so a registration keeps its digits in an overlay the rebuild folds in rather than overwrites.

![And it works immediately — landscape](shots/landscape-27-and-it-works-immediately.png)

<img src="shots/portrait-27-and-it-works-immediately.png" width="320" alt="And it works immediately — portrait">

## The second child

### 28. The other door, in the same slot

*On the confirm screen* · `confirm (check-in)` · 94 taps from the resting screen

A parent whose next child is finally old enough starts here, not at the front door: they have already found their family by phone and tapped a name. The offer sits below the main action in the smaller weight, because it is the rarer of the two things somebody came to this screen to do — and it is on this screen at all because this is where the kiosk knows which family is standing in front of it.

![The other door, in the same slot — landscape](shots/landscape-28-the-other-door-in-the-same-slot.png)

<img src="shots/portrait-28-the-other-door-in-the-same-slot.png" width="320" alt="The other door, in the same slot — portrait">

### 29. The cheaper answer, offered first

*Searching the roster first* · `sibling search` · 95 taps from the resting screen

Both readings of that link are real journeys. The common one is a sibling already on the roster whom the phone search did not surface — the church has them, the family folk simply do not line up — and finding them costs nothing and creates nothing. So this screen searches by name, shows the family's own rows greyed and inert so nobody taps a child twice, and keeps "add a new child" as a standing offer rather than the destination. A registration is the expensive answer and it is one tap further away.

![The cheaper answer, offered first — landscape](shots/landscape-29-the-cheaper-answer-offered-first.png)

<img src="shots/portrait-29-the-cheaper-answer-offered-first.png" width="320" alt="The cheaper answer, offered first — portrait">

### 30. "Another child", not "their brother"

*Sibling — question 1 of 4* · `child-first (sibling mode)` · 96 taps from the resting screen

The same first question, under a header that refuses to claim a relationship: the kiosk inferred kinship from four phone digits, and this wizard is reached from the screen that exists for everyone that inference is wrong about — a cousin, a neighbour's boy, a child on a different number. "Another child" is the only relationship it can actually vouch for: they arrived together. And no count under the field, because there is no adult section coming — the last of this child's questions goes straight to the confirm.

!["Another child", not "their brother" — landscape](shots/landscape-30-another-child-not-their-brother.png)

<img src="shots/portrait-30-another-child-not-their-brother.png" width="320" alt=""Another child", not "their brother" — portrait">

### 31. The surname it does not carry

*Sibling — question 2 of 4* · `child-last (sibling mode, empty)` · 102 taps from the resting screen

Empty — and this is the frame that shows why every step deserves a photograph. The prefill offers the surname of the previous child *in this run*, and a sibling run has none: the family being joined is on the confirm screen behind the wizard, not in the draft. The kiosk knows which household this is well enough to file the child into it, and still asks a parent to type a surname it is holding.

![The surname it does not carry — landscape](shots/landscape-31-the-surname-it-does-not-carry.png)

<img src="shots/portrait-31-the-surname-it-does-not-carry.png" width="320" alt="The surname it does not carry — portrait">

### 32. Grade, unchanged by any of it

*Sibling — question 3 of 4* · `child-grade (sibling mode)` · 107 taps from the resting screen

The same fourteen chips, opening on the same default, for a child whose siblings the kiosk has on screen. Nothing about the family it is joining narrows the grid.

![Grade, unchanged by any of it — landscape](shots/landscape-32-grade-unchanged-by-any-of-it.png)

<img src="shots/portrait-32-grade-unchanged-by-any-of-it.png" width="320" alt="Grade, unchanged by any of it — portrait">

### 33. Allergies, for the joining child

*Sibling — question 4 of 4* · `child-allergies (sibling mode)` · 109 taps from the resting screen

Asked here too, and on the same terms: the note goes to the reviewer and then upstream, and the kiosk keeps a marker rather than the text.

![Allergies, for the joining child — landscape](shots/landscape-33-allergies-for-the-joining-child.png)

<img src="shots/portrait-33-allergies-for-the-joining-child.png" width="320" alt="Allergies, for the joining child — portrait">

### 34. Joining the family that exists

*One child, no adult* · `confirm (sibling mode)` · 110 taps from the resting screen

No name, no phone number, no second household invented — the confirm names the siblings this child is being added to and that is the whole of it. Four questions, then this. The kiosk resolved the family from the four digits it searched with; the server re-verifies every one of those ids before it believes any of them, and at approval the household comes from an existing sibling rather than from the children in the run. That last part is the fix for a real bug: a family gaining a second child used to gain a second household, with the first child left behind in the original and invisible from the new one.

![Joining the family that exists — landscape](shots/landscape-34-joining-the-family-that-exists.png)

<img src="shots/portrait-34-joining-the-family-that-exists.png" width="320" alt="Joining the family that exists — portrait">

### 35. One moment, again

*The call is in flight* · `submitting (sibling mode)` · 111 taps from the resting screen

The same spinner, at the end of a run a third as long, and held the same way. What a family waits on here is identical to what the longer run waits on, which is a point in the sibling path's favour and an argument about the other one.

![One moment, again — landscape](shots/landscape-35-one-moment-again.png)

<img src="shots/portrait-35-one-moment-again.png" width="320" alt="One moment, again — portrait">

### 36. Recorded, not decided

*Checked in, held for review* · `success (sibling mode)` · 111 taps from the resting screen

Nothing reached Planning Center. Every child a family registers is written held, and the hold is the only thing that gates the push — both backends, both sweeps, the on-create trigger and the re-create repair all consult it. What happens next happens on a weekday, on a core-team screen, with the form as the family typed it beside any roster row that shares a name: approve, merge, or discard. The door records; a person decides. Note what this screen does *not* say: there is no four-digit line here, because a sibling run never asked for a number.

![Recorded, not decided — landscape](shots/landscape-36-recorded-not-decided.png)

<img src="shots/portrait-36-recorded-not-decided.png" width="320" alt="Recorded, not decided — portrait">

## The edges

### 37. Six rows, and the offer goes dead

*Six children — the cap* · `confirm (at MAX_CHILDREN)` · 201 taps from the resting screen

Six is the wizard's cap and the server's. **Add another child** goes dead and a line under the buttons explains it — the first time in the flow a parent is told no. A family of seven is rare and real, and what happens to them is a sentence pointing at a leader. Past two the commit counts rather than lists, because six names would not fit a button. This is also the confirm holding as much as it ever has to: twenty-seven rows in a region that shows about fifteen, so it scrolls — which the receipt it replaced could not do at all. Whether the parent of six can check six children here, on the one screen where checking is the entire job, is the question. This run was cancelled rather than submitted; nothing on it reached the roster.

![Six rows, and the offer goes dead — landscape](shots/landscape-37-six-rows-and-the-offer-goes-dead.png)

<img src="shots/portrait-37-six-rows-and-the-offer-goes-dead.png" width="320" alt="Six rows, and the offer goes dead — portrait">
