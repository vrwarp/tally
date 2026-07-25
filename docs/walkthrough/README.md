# Tally — a walkthrough

Every screenshot below is the real application, captured by Playwright against a
live Firebase Emulator Suite and a seeded 45-student ministry. Nothing is a mockup;
the Planning Center sync in the last three shots really did make HTTP calls.

Regenerate with:

```bash
npm run dev:emulated                  # in one terminal
npm run walkthrough                   # capture, then build the page
```

## Getting in

### Sign in

The only screen a signed-out volunteer sees. An email link is the primary path — counselors are handed a phone at the door and never set a password. Google is secondary, and hides itself in browsers that cannot do OAuth.

![Sign in](web/desktop-01-sign-in.jpg)

<img src="web/phone-01-sign-in.jpg" width="260" alt="Sign in on a phone">

## Journey 1 — high-volume check-in

### The predictive roster

Tally picked tonight’s event from the clock; nobody chose it. The “Recent” block is the predictive roster: students who came to at least 2 of the last 3 Fridays, most consistent first. Friday history predicts Friday — Sunday’s regulars are not in this list.

![The predictive roster](web/desktop-02-the-predictive-roster.jpg)

<img src="web/phone-02-the-predictive-roster.jpg" width="260" alt="The predictive roster on a phone">

### One tap checks a student in

Maya Adebayo moved to “Checked in” at the bottom, and the header count went up. The row flashed green and buzzed before the write left the device — the authoritative state then arrives back through Firestore, so a second counselor at the same door sees it too.

![One tap checks a student in](web/desktop-03-one-tap-checks-a-student-in.jpg)

<img src="web/phone-03-one-tap-checks-a-student-in.jpg" width="260" alt="One tap checks a student in on a phone">

### Search for anyone not in the Recent block

Two letters, filtered instantly against the in-memory roster. The header counts deliberately do not move: they describe the event, not the query, so nobody watches the number drop as they type and thinks they broke something.

![Search for anyone not in the Recent block](web/desktop-04-search-for-anyone-not-in-the-recent-block.jpg)

<img src="web/phone-04-search-for-anyone-not-in-the-recent-block.jpg" width="260" alt="Search for anyone not in the Recent block on a phone">

## Journey 3 — bring a friend

### Quick-add a visitor

A first name, a last name, a grade. Nothing else, because anything more forms a queue at the door. “Save & check in” is one atomic write: the student is created and marked present together, then the modal closes.

![Quick-add a visitor](web/desktop-05-quick-add-a-visitor.jpg)

<img src="web/phone-05-quick-add-a-visitor.jpg" width="260" alt="Quick-add a visitor on a phone">

### The visitor is already checked in

Back on the roster with no interruption. Behind the scenes the profile carries a “missing info” flag, which is what puts them on the core team’s follow-up list later that evening.

![The visitor is already checked in](web/desktop-06-the-visitor-is-already-checked-in.jpg)

<img src="web/phone-06-the-visitor-is-already-checked-in.jpg" width="260" alt="The visitor is already checked in on a phone">

## Journey 5 — pastoral follow-up

### Insights, not a data table

Monday evening. The PRD asks for actionable insight rather than raw numbers, so every row leads somewhere: tap-to-call, tap-to-text, or through to the student. “Missing in action” is students who missed three or more gatherings in a row.

![Insights, not a data table](web/desktop-07-insights-not-a-data-table.jpg)

<img src="web/phone-07-insights-not-a-data-table.jpg" width="260" alt="Insights, not a data table on a phone">

### New faces and incomplete profiles

First-timers from the past week, and the profiles still missing a way to reach a parent — the visitors quick-added at the door. “Copy list” puts names and numbers on the clipboard for a group chat, which is what actually happens.

![New faces and incomplete profiles](web/desktop-08-new-faces-and-incomplete-profiles.jpg)

<img src="web/phone-08-new-faces-and-incomplete-profiles.jpg" width="260" alt="New faces and incomplete profiles on a phone">

### Attendance trend

Head count per gathering, per series. Eight bars, no gridlines, no chart library — enough to see a slide starting, which is all this needs to do.

![Attendance trend](web/desktop-09-attendance-trend.jpg)

<img src="web/phone-09-attendance-trend.jpg" width="260" alt="Attendance trend on a phone">

## Journey 4 — the field trip

### The event calendar

Recurring gatherings and one-offs together. “Schedule next Friday Fellowship” is two taps, because somebody has to do it every single week.

![The event calendar](web/desktop-10-the-event-calendar.jpg)

<img src="web/phone-10-the-event-calendar.jpg" width="260" alt="The event calendar on a phone">

### RSVPs, waivers and payments

A one-off event is about accountability rather than speed. The numbers a leader is actually chasing the week before a retreat — waivers outstanding, payments outstanding — are the prominent ones.

![RSVPs, waivers and payments](web/desktop-11-rsvps-waivers-and-payments.jpg)

<img src="web/phone-11-rsvps-waivers-and-payments.jpg" width="260" alt="RSVPs, waivers and payments on a phone">

## The roster

### Students

The whole ministry, filterable by grade, small group and status. Each row says whether the record came from Planning Center or was created in Tally, so it is obvious which fields are safe to edit here.

![Students](web/desktop-12-students.jpg)

<img src="web/phone-12-students.jpg" width="260" alt="Students on a phone">

## Planning Center

### Settings and the sync

The predictive thresholds are configurable with a plain-language preview. Below them, the Planning Center card: what the last sync did, and a button to run one now.

![Settings and the sync](web/desktop-13-settings-and-the-sync.jpg)

<img src="web/phone-13-settings-and-the-sync.jpg" width="260" alt="Settings and the sync on a phone">

### A sync, end to end

Browser → callable → Cloud Function → the Planning Center API → Firestore → back through onSnapshot. Students and counselors both come from Planning Center; access is derived from it rather than from a list somebody maintains by hand.

![A sync, end to end](web/desktop-14-a-sync-end-to-end.jpg)

<img src="web/phone-14-a-sync-end-to-end.jpg" width="260" alt="A sync, end to end on a phone">

### People pulled from Planning Center

Amara Okonkwo existed only in Planning Center a moment ago. Her grade, allergies and parent contact all came across — the contact resolved through her household, since Planning Center keeps it on the parent’s record, not the child’s.

![People pulled from Planning Center](web/desktop-15-people-pulled-from-planning-center.jpg)

<img src="web/phone-15-people-pulled-from-planning-center.jpg" width="260" alt="People pulled from Planning Center on a phone">
