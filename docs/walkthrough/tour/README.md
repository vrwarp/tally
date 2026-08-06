# Every journey, end to end

Captured from the running app by `e2e/tour.spec.ts`. Rebuild the page with
`npx tsx scripts/build-tour.ts`.

Six acts: a family the church already has, a family nobody has met arriving through the kiosk
and through the QR, a family gaining a second child, the review that turns any of it into a
record in the church's database, and the core team's own week. Each frame is shown on a wide
device and a tall one.

## Act 1 — At the door

### 1. One question, and no keyboard on the glass

*A family the church already has*

The kiosk asks for a name or four digits and nothing else — no account, no password, no app to install. The digits are the family's own phone number, which is the only credential a parent reliably has on them, and the keyboard is the kiosk's own: the device's native one is slow to rise and covers half the screen when it does.

![One question, and no keyboard on the glass — wide](shots/wide-01-one-question-and-no-keyboard-on-the-glass.png)

<img src="shots/tall-01-one-question-and-no-keyboard-on-the-glass.png" width="320" alt="One question, and no keyboard on the glass — tall">

### 2. Four keystrokes is usually the whole search

*A family the church already has*

Filtering happens on the device against a roster it already holds, so the list narrows with the keystroke rather than after a round trip. That matters more than it sounds: the queue behind is what makes a kiosk worth having, and a search that waits on a network is a search that stops the queue.

![Four keystrokes is usually the whole search — wide](shots/wide-02-four-keystrokes-is-usually-the-whole-search.png)

<img src="shots/tall-02-four-keystrokes-is-usually-the-whole-search.png" width="320" alt="Four keystrokes is usually the whole search — tall">

### 3. Is this you?

*A family the church already has*

One name, large, and one button. The check-in is a single tap rather than a hold: speed of confirmation is the whole point of a kiosk, and the worst a mis-tap does is mark somebody present who then walks in anyway. Undo lives with the staff in the main app, deliberately not here.

![Is this you? — wide](shots/wide-03-is-this-you.png)

<img src="shots/tall-03-is-this-you.png" width="320" alt="Is this you? — tall">

### 4. The tick, and a sticker on its way

*A family the church already has*

Painted optimistically — the write is already in flight and the screen does not wait for it, because a parent turning to walk their child in has stopped looking by then. The label rasterises in a worker that started when the confirm screen came up, so it is moving before the tick paints.

![The tick, and a sticker on its way — wide](shots/wide-04-the-tick-and-a-sticker-on-its-way.png)

<img src="shots/tall-04-the-tick-and-a-sticker-on-its-way.png" width="320" alt="The tick, and a sticker on its way — tall">

### 5. A pickup is a hold, not a tap

*The same family, at the end of the morning*

The same row, hours later, offering the only thing left to do with a child who is already here. Three seconds of deliberate pressure rather than one tap, and that is not ceremony: marking a child collected is a claim that somebody took them out of the building, made on an unattended screen in a lobby — and unlike a stray check-in it does not correct itself when the child walks back in. Undoing one needs a volunteer and the main app.

![A pickup is a hold, not a tap — wide](shots/wide-05-a-pickup-is-a-hold-not-a-tap.png)

<img src="shots/tall-05-a-pickup-is-a-hold-not-a-tap.png" width="320" alt="A pickup is a hold, not a tap — tall">

### 6. Signed out, and the count still stands

*The same family, at the end of the morning*

The pickup is its own record rather than an edit to the check-in, so the morning's head count is unchanged by anybody going home. Undoing a collection deletes that record rather than nulling a field — a room that thinks a child is present when they are not is a worse failure than one that has to be asked twice.

![Signed out, and the count still stands — wide](shots/wide-06-signed-out-and-the-count-still-stands.png)

<img src="shots/tall-06-signed-out-and-the-count-still-stands.png" width="320" alt="Signed out, and the count still stands — tall">

## Act 2 — Nobody has met us

### 7. What used to be a dead end

*A family the church has never seen*

This screen once said "No match — please see a leader" and nothing else. Seeing a leader is still the right last word when something is wrong with the search; it was never the right first one for being new. Two offers sit under the empty result and they answer different questions: a family somebody added while they queued needs the kiosk to look again, and a family nobody has met needs a form.

![What used to be a dead end — wide](shots/wide-07-what-used-to-be-a-dead-end.png)

<img src="shots/tall-07-what-used-to-be-a-dead-end.png" width="320" alt="What used to be a dead end — tall">

### 8. Your phone, or this screen

*A family the church has never seen*

The QR comes first because a family with a phone in their hand would nearly always rather type on it, and the ones without one are a single tap from the wizard. The code under it is minted by a real callable under the kiosk's own session, lives twenty minutes, carries at most twenty families, and re-mints itself while the screen is up — a stable public registration URL would be a form on the open internet whose submissions land in a church's people database.

![Your phone, or this screen — wide](shots/wide-08-your-phone-or-this-screen.png)

<img src="shots/tall-08-your-phone-or-this-screen.png" width="320" alt="Your phone, or this screen — tall">

### 9. One question per screen

*A family the church has never seen*

The alternative on a lobby tablet is a form with six boxes and an on-screen keyboard that can only fill one of them at a time — a parent tapping between fields, losing their place, with a queue behind. The readout is a div, never an input: nothing here focuses anything, so the device keyboard never rises.

![One question per screen — wide](shots/wide-09-one-question-per-screen.png)

<img src="shots/tall-09-one-question-per-screen.png" width="320" alt="One question per screen — tall">

### 10. The shift key, and where a capital belongs

*A family the church has never seen*

Capitals are automatic at the start of a name and after each space, hyphen and apostrophe — the boundaries a name actually has, which is what makes Anne-Marie and O'Brien come out right without anybody reaching for shift. It is a default, not a rule: no rule short of a dictionary gets McDonald, van der Berg and O'Sullivan all right, and what is typed here goes on a sticker a child wears.

![The shift key, and where a capital belongs — wide](shots/wide-10-the-shift-key-and-where-a-capital-belongs.png)

<img src="shots/tall-10-the-shift-key-and-where-a-capital-belongs.png" width="320" alt="The shift key, and where a capital belongs — tall">

### 11. A grade, or honestly none

*A family the church has never seen*

"No grade" is an answer rather than a blank. A nursery child has none to type, and a field left empty would either invent a zero or leave the child queued forever behind a validation nobody can satisfy. The chips open on the middle of the gathering's own band, which is one fewer tap for most families.

![A grade, or honestly none — wide](shots/wide-11-a-grade-or-honestly-none.png)

<img src="shots/tall-11-a-grade-or-honestly-none.png" width="320" alt="A grade, or honestly none — tall">

### 12. Anybody else?

*A family the church has never seen*

The loop that makes this worth doing at a kiosk at all — and the children so far are named above the two buttons, because a parent cannot answer "anybody else?" against their own memory of what they typed forty seconds ago. Naming them also catches the mistake this screen is the last chance to catch: a child entered twice, or one whose name went in wrong.

![Anybody else? — wide](shots/wide-12-anybody-else.png)

<img src="shots/tall-12-anybody-else.png" width="320" alt="Anybody else? — tall">

### 13. The second child already knows their surname

*A family the church has never seen*

Prefilled from the first child, with the shift key down rather than up — the next keystroke belongs mid-word, not at the start of one. This is the argument for a wizard over a form in one screen: the questions know what the family has already said, and a form cannot. It is one Clear away when the guess is wrong.

![The second child already knows their surname — wide](shots/wide-13-the-second-child-already-knows-their-surname.png)

<img src="shots/tall-13-the-second-child-already-knows-their-surname.png" width="320" alt="The second child already knows their surname — tall">

### 14. A number pad for a number

*A family the church has never seen*

The letter keyboard would work and would be wrong: everybody already knows what a phone keypad looks like, and the letter groups under the digits are there because a parent reading their own number off muscle memory finds them. The line above says why it is being asked for *before* it is typed, while somebody is still deciding whether to give it.

![A number pad for a number — wide](shots/wide-14-a-number-pad-for-a-number.png)

<img src="shots/tall-14-a-number-pad-for-a-number.png" width="320" alt="A number pad for a number — tall">

### 15. Everything, before anything is written

*A family the church has never seen*

Both children, the adult, and the number — the last point at which a correction costs a tap rather than a leader. Six questions in all, and nothing else: allergies, emails and second guardians are not here. That is the same bargain the staff quick-add makes, because a lobby form that asks for everything is a lobby form nobody finishes.

![Everything, before anything is written — wide](shots/wide-15-everything-before-anything-is-written.png)

<img src="shots/tall-15-everything-before-anything-is-written.png" width="320" alt="Everything, before anything is written — tall">

### 16. Next time, just type those four digits

*A family the church has never seen*

Both children are on the roster, both are checked in against tonight's gathering, and a sticker is coming out of the printer for each. The sentence under the tick is the part that matters next week: the last four digits of the number they just gave are the search this kiosk already had, and this is where the family learns it. No account, no password, no app.

![Next time, just type those four digits — wide](shots/wide-16-next-time-just-type-those-four-digits.png)

<img src="shots/tall-16-next-time-just-type-those-four-digits.png" width="320" alt="Next time, just type those four digits — tall">

### 17. And it works immediately

*A family the church has never seen*

Typed on the same screen, seconds later, with nothing refetched — the answer came back with the registration and went straight into what this kiosk holds. It survives the nightly rebuild too: that job reads the church's backends, which may not know this number for hours or, on a deployment that cannot write households, ever, so a registration keeps its digits in an overlay the rebuild folds in rather than overwrites.

![And it works immediately — wide](shots/wide-17-and-it-works-immediately.png)

<img src="shots/tall-17-and-it-works-immediately.png" width="320" alt="And it works immediately — tall">

## Act 3 — On their own phone

### 18. The one unauthenticated write Tally has

*The same family, on the device in their hand*

The page the QR opens, on a real second device holding nothing but the code from the lobby screen. It is deliberately not a link anybody can keep: the code expires, is capped, and is re-minted while the kiosk is up. Registering remotely means being in the room — which is the entire security model, and it is the right one, because the alternative is a public form whose submissions land in a church's people database.

![The one unauthenticated write Tally has — wide](shots/wide-18-the-one-unauthenticated-write-tally-has.png)

<img src="shots/tall-18-the-one-unauthenticated-write-tally-has.png" width="320" alt="The one unauthenticated write Tally has — tall">

### 19. A real form, because a phone can carry one

*The same family, on the device in their hand*

Ordinary labelled inputs with the phone's own keyboard, which is the opposite of the kiosk's one-question-per-screen and right for the same reason: the constraint on the tablet was the shared glass and the queue, and neither applies here. This is also the only surface that asks about allergies, and only where the church's backend can actually hold them — a lobby screen does not display a child's medical notes, so it does not collect them.

![A real form, because a phone can carry one — wide](shots/wide-19-a-real-form-because-a-phone-can-carry-one.png)

<img src="shots/tall-19-a-real-form-because-a-phone-can-carry-one.png" width="320" alt="A real form, because a phone can carry one — tall">

### 20. Now go and tap the button

*The same family, on the device in their hand*

This form checks nobody in — it cannot know the family walked through the door — so it ends by sending them back, and the order is the whole message: tap "I've registered", *then* type the digits. The kiosk holds a copy of the roster and refreshes it every six hours; telling somebody to type their digits without the button is telling them to watch a screen say "no match".

![Now go and tap the button — wide](shots/wide-20-now-go-and-tap-the-button.png)

<img src="shots/tall-20-now-go-and-tap-the-button.png" width="320" alt="Now go and tap the button — tall">

### 21. The button is what makes it go and look

*The same family, back at the lobby screen*

A forced read past two caches — the kiosk's own roster copy and the server's copy of the church behind it — and then the four digits find the child the phone just created. The same refresh is offered from the no-match state, for the family who took ten minutes over the form and came back to a kiosk that had moved on.

![The button is what makes it go and look — wide](shots/wide-21-the-button-is-what-makes-it-go-and-look.png)

<img src="shots/tall-21-the-button-is-what-makes-it-go-and-look.png" width="320" alt="The button is what makes it go and look — tall">

## Act 4 — The second child

### 22. Find a brother or sister

*A family the church already has, growing*

A parent looking at one name who knows there should be two. The kiosk offers the siblings it can see, ticked, above the button — but that guess is deliberately conservative and so it misses people: a child on a different number, a family split across two households, somebody added by hand last week, a second child who is finally old enough. All of them arrive here, on the one screen where the kiosk knows which family is standing in front of it. It sits below the main action in the smaller weight, being the rarer of the two things somebody came here to do.

![Find a brother or sister — wide](shots/wide-22-find-a-brother-or-sister.png)

<img src="shots/tall-22-find-a-brother-or-sister.png" width="320" alt="Find a brother or sister — tall">

### 23. Both readings of the same question

*A family the church already has, growing*

This used to be a link straight to the registration form, which read as one thing and did another: "add a brother or sister" is plainly an instruction to include another of my children in this check-in, and it answered by asking a new child's name and grade. Both readings are real, so the screen holds both — the search finds the sibling the kiosk simply failed to associate, and the standing offer underneath registers the one who genuinely is not on the roster.

![Both readings of the same question — wide](shots/wide-23-both-readings-of-the-same-question.png)

<img src="shots/tall-23-both-readings-of-the-same-question.png" width="320" alt="Both readings of the same question — tall">

### 24. Two questions, and no adult at all

*A family the church already has, growing*

No name, no phone number, no second household invented — the confirm names the siblings this child is joining and that is the whole of it. The kiosk resolved the family from the four digits it searched with; the server re-verifies every one of those ids before believing any of them. At approval the household comes from an existing sibling, which is the fix for a real bug: a family gaining a second child used to gain a second *household*, with the first child left behind in the original and invisible from the new one.

![Two questions, and no adult at all — wide](shots/wide-24-two-questions-and-no-adult-at-all.png)

<img src="shots/tall-24-two-questions-and-no-adult-at-all.png" width="320" alt="Two questions, and no adult at all — tall">

## Act 5 — The review

### 25. The door records; a person decides

*Core team, on a weekday*

Everything the last three acts created is here, and *none* of it has reached Planning Center. Every registered child is written held, and that hold is the only thing gating the push — both backends, both sweeps, the on-create trigger, the re-create repair. The reason is that nothing upstream is reversible: there is no delete anywhere in this codebase, and the second backend has no merges at all. A public screen with a queue behind it should not be settling identity.

![The door records; a person decides — wide](shots/wide-25-the-door-records-a-person-decides.png)

<img src="shots/tall-25-the-door-records-a-person-decides.png" width="320" alt="The door records; a person decides — tall">

### 26. The form as the family typed it

*Core team, on a weekday*

The children with their grades, the guardian, and the four digits — and the phone number, which is the one place in Tally a parent's number lives. It waits on a functions-only document with a thirty-day sweep, deleted the moment a reviewer decides, because deferring the push would otherwise lose the guardian entirely: the security rules forbid a parent's name or number on a student document, deliberately, and there is nowhere else for it to go.

![The form as the family typed it — wide](shots/wide-26-the-form-as-the-family-typed-it.png)

<img src="shots/tall-26-the-form-as-the-family-typed-it.png" width="320" alt="The form as the family typed it — tall">

### 27. This might be the Jacob Smith we already have

*Core team, on a weekday*

The door recorded the suspicion and did nothing about it, which is the change. It used to refuse the registration and tell the family to "search for their name instead" — an instruction to check in a different child of the same name, on an unattended screen. Two rows a reviewer merges on Tuesday is the cheaper mistake, and the only one anybody notices. The grade beside each candidate is what actually tells two children apart.

![This might be the Jacob Smith we already have — wide](shots/wide-27-this-might-be-the-jacob-smith-we-already-have.png)

<img src="shots/tall-27-this-might-be-the-jacob-smith-we-already-have.png" width="320" alt="This might be the Jacob Smith we already have — tall">

### 28. Approval is a replay, in the right order

*Core team, on a weekday*

Every child first, then **one** call to build the family — approving child by child would mint one household per sibling, the exact failure the family write exists to avoid. The hold comes off before the push rather than after it, which looks like the risky order and is the safe one: a push that fails after approval leaves an ordinary queued student that the Settings sweep already understands.

![Approval is a replay, in the right order — wide](shots/wide-28-approval-is-a-replay-in-the-right-order.png)

<img src="shots/tall-28-approval-is-a-replay-in-the-right-order.png" width="320" alt="Approval is a replay, in the right order — tall">

### 29. And the other answer

*Core team, on a weekday*

Discarding takes the children off the roster and forgets the phone number — the sentence comes before the second press, because that half is not reversible. The students go inactive rather than away: every attendance record points at these documents, and deleting one would silently drop a head count somebody has already reported to a room full of parents.

![And the other answer — wide](shots/wide-29-and-the-other-answer.png)

<img src="shots/tall-29-and-the-other-answer.png" width="320" alt="And the other answer — tall">

## Act 6 — The rest of the week

### 30. The same job, without a kiosk

*A counselor at a door*

Check-in is the home screen, because a counselor at a door should never have to navigate to start working. It opens on the regulars rather than the whole ministry — a student who comes every Friday is one tap away, and the rest of the roster is one tap behind that. This is the screen most people who install Tally will only ever see.

![The same job, without a kiosk — wide](shots/wide-30-the-same-job-without-a-kiosk.png)

<img src="shots/tall-30-the-same-job-without-a-kiosk.png" width="320" alt="The same job, without a kiosk — tall">

### 31. One student, and the history under them

*Core team*

Names, grades and allergies are read live from the church's own database rather than mirrored here — Tally stores the membership and the attendance, and nothing about who somebody is. "Every night they came" underneath reaches back as far as the records go, further than the calendar the screens above keep loaded, and it unions the history of any duplicate row merged into this one.

![One student, and the history under them — wide](shots/wide-31-one-student-and-the-history-under-them.png)

<img src="shots/tall-31-one-student-and-the-history-under-them.png" width="320" alt="One student, and the history under them — tall">

### 32. A call list, not a report

*Core team*

Students who have missed three gatherings in a row, first-timers from the last week, profiles nobody can be reached about. Split by gathering, for the same reason prediction is: a student who comes every Sunday and has never been to a Friday has missed nothing, and the pooled version phoned their family about it.

![A call list, not a report — wide](shots/wide-32-a-call-list-not-a-report.png)

<img src="shots/tall-32-a-call-list-not-a-report.png" width="320" alt="A call list, not a report — tall">

### 33. Where the church's database is connected

*Core team*

Two backends, either or both, with what is queued and what is *waiting to be reviewed* counted separately — a family held for a person is not a stuck push, and saying "3 queued" about them would teach somebody to ignore the line that means it. The link from here is how most reviewers will find the screen in Act 5.

![Where the church's database is connected — wide](shots/wide-33-where-the-church-s-database-is-connected.png)

<img src="shots/tall-33-where-the-church-s-database-is-connected.png" width="320" alt="Where the church's database is connected — tall">

### 34. How the lobby screen gets its identity

*Any active member*

The kiosk shows a six-character code and polls; whoever types it here hands the kiosk a session bound to their own account, and every check-in it records from then on carries their name. Open to any active member, not just the core team — the person setting up the lobby screen on a Friday evening is a counselor.

![How the lobby screen gets its identity — wide](shots/wide-34-how-the-lobby-screen-gets-its-identity.png)

<img src="shots/tall-34-how-the-lobby-screen-gets-its-identity.png" width="320" alt="How the lobby screen gets its identity — tall">
