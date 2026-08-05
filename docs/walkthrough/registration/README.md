# Registering a family at the kiosk

Captured from the running app by `e2e/registration-walkthrough.spec.ts`. Rebuild the page with
`npx tsx scripts/build-registration-walkthrough.ts`.

Every frame is the real lobby screen driving the real callable against a seeded emulator: the
pairing handshake happens, the QR code is minted by `mintRegistrationCode`, and the family at the
end exists in Firestore and is checked in against a real gathering.

## Finding the door

### 1. No match

*Not on the roster*

What a family nobody has met used to meet here was "No match — please see a leader", and nothing else. Seeing a leader is still the right last word when something is wrong with the search; it was never the right first one for being new. Two offers sit under the empty result and they answer different questions: a family somebody added while they queued needs the kiosk to look again, and a family nobody has ever met needs a form.

![No match — landscape](shots/landscape-01-no-match.png)

<img src="shots/portrait-01-no-match.png" width="320" alt="No match — portrait">

### 2. The standing offer

*Not on the roster*

The door is also on the screen before anybody types, in the row above the keyboard. It has to be: a parent told "just put your name in" types their child's name, gets somebody else's Noah back, and never fails a search to be offered anything. Low-key and fixed-height, so a keystroke still never moves the keyboard.

![The standing offer — landscape](shots/landscape-02-the-standing-offer.png)

<img src="shots/portrait-02-the-standing-offer.png" width="320" alt="The standing offer — portrait">

## On your own phone

### 3. Scan this

*Choosing a door*

The first thing offered, because a parent holding a phone would rather type on it than on a tablet bolted to a shelf — their keyboard, their autocorrect, and the queue behind them does not have to watch. The code under it is minted by the kiosk and lives twenty minutes: a stable public registration URL would be a form on the open internet whose submissions land in a church's real people database, so registering remotely means being in the room. The address is spelled out in words too, for a camera that will not focus.

![Scan this — landscape](shots/landscape-03-scan-this.png)

<img src="shots/portrait-03-scan-this.png" width="320" alt="Scan this — portrait">

## Right here

### 4. The field says what it is

*Registering*

For the family without a phone, one tap behind the QR — the right way round, because this is the longer of the two flows on the harder keyboard. One question per screen in the frame the search already uses. The readout names the field rather than saying "type here", which matters most on the two steps where the answer could belong to either person in the room: "Child's last name" and "Your last name" are the same box until one of them says which.

![The field says what it is — landscape](shots/landscape-04-the-field-says-what-it-is.png)

<img src="shots/portrait-04-the-field-says-what-it-is.png" width="320" alt="The field says what it is — portrait">

### 5. Capitals, and a key to argue with them

*Registering*

The first letter is a capital without anybody asking, and so is the letter after every space, hyphen and apostrophe — the boundaries a name actually has, which is what makes Anne-Marie and O'Brien come out right on their own. But no rule short of a dictionary gets McDonald and van der Berg too, so the shift key is there beside them: it cycles off, on and locked the way every phone does, and the letters wear the state so a key shows exactly what it will produce.

![Capitals, and a key to argue with them — landscape](shots/landscape-05-capitals-and-a-key-to-argue-with-them.png)

<img src="shots/portrait-05-capitals-and-a-key-to-argue-with-them.png" width="320" alt="Capitals, and a key to argue with them — portrait">

### 6. Grade, or none

*Registering*

Thirteen chips and "No grade", which is an answer rather than a blank somebody fills in later: a child too young for a grade has none. On a gathering that hands children back the question opens on "No grade" for the same reason — making a parent clear a field is the same mistake as making a volunteer reach for undo.

![Grade, or none — landscape](shots/landscape-06-grade-or-none.png)

<img src="shots/portrait-06-grade-or-none.png" width="320" alt="Grade, or none — portrait">

### 7. Anybody else?

*One child*

The fork that makes this worth doing at a kiosk at all: a parent with three children walks the loop three times rather than queueing three times. Who is on the list so far is named above the buttons, because the question cannot be answered against a parent's memory of what they typed forty seconds ago — least of all the parent of four, who is exactly who this loop is for. It is also the last chance to catch a child entered twice, or one whose name went in wrong.

![Anybody else? — landscape](shots/landscape-07-anybody-else.png)

<img src="shots/portrait-07-anybody-else.png" width="320" alt="Anybody else? — portrait">

### 8. The surname, carried

*Two children*

The second child's last name arrives already typed, and the shift key is down rather than up — the next keystroke belongs mid-word, not at the start of one. This is the whole argument for a wizard over a form: the questions know what the family has already said, and a form cannot.

![The surname, carried — landscape](shots/landscape-08-the-surname-carried.png)

<img src="shots/portrait-08-the-surname-carried.png" width="320" alt="The surname, carried — portrait">

### 9. Both of them, named

*Two children*

The same fork one child later. Nothing about this screen asks a parent to remember anything.

![Both of them, named — landscape](shots/landscape-09-both-of-them-named.png)

<img src="shots/portrait-09-both-of-them-named.png" width="320" alt="Both of them, named — portrait">

### 10. A dialer, for the one question that is a number

*Two children, one adult*

The QWERTY row can type digits, but picking ten targets out of forty-three on a tablet while a queue watches is asking for a mistake in the one field where a mistake is expensive: four of these digits become the family's key for every visit after this one. The line above says why it is being asked for while a parent decides whether to give it — and it is the only thing on this screen Tally will not keep. The number lives inside one call, long enough to build the family in the church's own database and to be reduced to four digits for the kiosk index.

![A dialer, for the one question that is a number — landscape](shots/landscape-10-a-dialer-for-the-one-question-that-is-a-number.png)

<img src="shots/portrait-10-a-dialer-for-the-one-question-that-is-a-number.png" width="320" alt="A dialer, for the one question that is a number — portrait">

### 11. Ten digits

*Two children, one adult*

Grouped as they are typed. A number nobody could ring is refused here rather than after the round trip, and a repdigit — the thing somebody types to get past a field they do not want to answer — is refused too.

![Ten digits — landscape](shots/landscape-11-ten-digits.png)

<img src="shots/portrait-11-ten-digits.png" width="320" alt="Ten digits — portrait">

### 12. Does this look right?

*Ready to check in*

The whole family on one screen, and one button. Everything before this was reversible with Back; this is the point where two children join the ministry's roster and are marked present, as a single act.

![Does this look right? — landscape](shots/landscape-12-does-this-look-right.png)

<img src="shots/portrait-12-does-this-look-right.png" width="320" alt="Does this look right? — portrait">

### 13. Next time, just type those four digits

*On the roster, checked in*

Both children exist, both are checked in against tonight's gathering, and a sticker is coming out of the printer for each of them. The sentence under the tick is the part that matters next week: the last four digits of the number they just gave are the search this kiosk already had, and this is where the family learns it. That is the entire handoff — no account, no password, no app.

![Next time, just type those four digits — landscape](shots/landscape-13-next-time-just-type-those-four-digits.png)

<img src="shots/portrait-13-next-time-just-type-those-four-digits.png" width="320" alt="Next time, just type those four digits — portrait">

### 14. And it works immediately

*Findable*

Typed on the same screen, seconds later. Nothing was refetched: the answer came back with the registration and went straight into what this kiosk holds. It survives the nightly rebuild too — that job reads the church's backends, which may not know this number for hours or, on a deployment that cannot write households, ever, so a registration keeps its digits in an overlay the rebuild folds in rather than overwrites.

![And it works immediately — landscape](shots/landscape-14-and-it-works-immediately.png)

<img src="shots/portrait-14-and-it-works-immediately.png" width="320" alt="And it works immediately — portrait">

## What it will not do

### 15. Already on our list

*Refused, nothing written*

The same family again, five minutes later — the child who wandered off, the parent who was not sure it saved. Nothing is created. Not one of the two, either: a half-registered family is worse than one told to search, so a name already on the roster stops the whole thing. This is also what a retry meets, and why the server takes its claim on the registration before it reads the roster — otherwise a retried call would find the children it created a second ago and report them as duplicates of themselves.

![Already on our list — landscape](shots/landscape-15-already-on-our-list.png)

<img src="shots/portrait-15-already-on-our-list.png" width="320" alt="Already on our list — portrait">
