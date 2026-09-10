# Team management and event access — the journeys, and a proposal

**Status: proposal, for review.** Nothing in this document is built. It is the record of a design
campaign run the way the ones in [refinements.md](refinements.md) were run, but at design time
rather than against rendered frames: the journeys were walked, argued over by three consultants
until a round produced nothing above `minor`, and the proposal below is what survived. Every claim
about today's behaviour was checked against `src/`, `firestore.rules` and `functions/src` rather
than against the walkthrough, and three of them turned out to be worse than the walkthrough says.

The shipped behaviour this proposes to change is described in [product.md](product.md)
(Journey 8 and *Where the people come from*), [data-model.md](data-model.md) (`users`,
`invitations`, `eventAccess`, `kioskPairings`) and the walkthrough's
[Journey 8](walkthrough/README.md#journey-8--a-gathering-that-is-not-everybodys). The Team
screen's own four rounds are in [refinements.md](refinements.md#the-team-screen--4-rounds).

---

## 1. What exists today

Two lists decide who may use Tally and what they may do; a third decides which gatherings they
may work. All three are Tally's own.

**Who may sign in.** Sign-in is Google only, and authorisation is keyed on the verified address.
`invitations/{emailKey}` is the allowlist: an admin types a Google address and a starting role on
the Team screen. It is admin-only to read and to write, it is not consumed on sign-in, and
withdrawing one stops somebody *arriving* without evicting anybody who already has.
`users/{uid}` is the live authorisation, created by the `provisionAccess` Cloud Function on first
sign-in from the invitation's role; admins change anybody else's `role` and `active`, nobody
changes their own, and `active: false` — *Suspended* on the Team screen — is the only way to
remove somebody. `TALLY_ADMIN_EMAILS` is the deploy-time list of standing admins: the bootstrap
for the first admin and the break-glass if the team ever locks itself out.

**Who may work a gathering.** `eventAccess/{chainKey}` holds `restricted` and `members`; no
document means open to everybody, and one document covers every Friday of a repeat. Creating a
restriction is core team; the writer stays on the list; admins pass every gathering; flipping the
switch and removing people is core-on-the-chain; **adding somebody is open to anybody already on
the gathering**, counselors included; the document is never deleted. What closes is *working* the
gathering — check-in, undo, RSVPs, the register, editing, scheduling the next one. What stays open
is that it exists, its name and its time: a gathering you are not on is demoted below a divider on
the chooser with a lock and the name of somebody who can add you, never hidden.

**The surfaces.** The Team screen (account menu → Team): an admin's table of profiles with a role
select and an Active toggle, an invite form, and a pending list with a two-step Withdraw; a core
member's read-only copy. The *Who's on this gathering* sheet, opened from the event page (core) or
from a chip in the check-in header (everybody): two options drawn as a choice, a pre-fill from
whoever took the last three registers, *Add somebody* over the directory, and the list with
Remove. The chooser's *Not yours* section, the Events tab's notice, and the page a locked
gathering opens to by URL. The refusal screens behind *Continue with Google*. And the kiosk, which
is paired by any active member and thereafter *is* that person: every check-in it records carries
their uid, and every rule it passes reads their profile.

### What the code does that the documents do not say

Three things the campaign found by reading `src/` rather than the walkthrough, each graded a
blocker by at least one consultant:

- **A kiosk whose approver is suspended, or removed from the gathering it is bound to, keeps
  ticking children green and printing stickers while every write is refused.** `KioskApp.tsx`
  treats `permission-denied` on a check-in as "frozen student, not retryable" and leaves the row
  green; the replay queue drops the same code; the only route back to the pairing screen is a boot
  with no stored uid. A nursery morning of attendance that never existed, found on Tuesday if at
  all — and check-out is a custody record.
- **The break-glass is only re-asserted from the refusal screen.** `provisionAccess` is called
  from exactly one place, the pending screen, which mounts only when there is no active profile.
  Demoting a pinned admin therefore sticks for ever — one pick in a select disarms the deployment's
  standing grant — while suspending one silently undoes itself within seconds on whatever device
  they have open. The Team screen marks neither.
- **Re-closing a reopened gathering replaces the kept list.** `restrictChain` writes `members`
  through `setDoc(…, {merge: true})`, and a merge replaces an array field wholesale; the source
  comment and [data-model.md](data-model.md#eventaccesschainkey) both promise the opposite, and
  while the gathering is open the list about to be discarded is on no screen.

And one that is copy rather than code, and reads as the worst of the four to the people who meet
it: every sign-in refusal and suspension screen still says the allowlist is Planning Center and the
person to ask is "a core team leader … from Settings". Planning Center is a system the church
actually has and core team is a role that actually exists, so the instruction is *followable* and
wrong — a new volunteer's first journey ends in a successful ask that changes nothing. The login
screen two taps earlier already tells the truth.

---

## 2. The people, and the journeys

Five people carry every journey. **Dana** is the admin — the ministry director, on a laptop on a
Tuesday and a phone on a Sunday. **Miriam** is core team and runs Sunday School; she recruits her
own nursery volunteers. **Priya** is a counselor on Friday Fellowship, at the door. **Sam** is a
counselor new this term. **Jo** has never seen Tally. **Marcus** left in June.

The journeys were drafted from the walkthrough and the code, then argued over by three consultants:
a user researcher who walks journeys rather than screens, the church staff pair (director on
Tuesday, coordinator on Sunday), and a volunteer counselor speaking only from the door. Each
journey below carries its grade after round 1 and, where the consultants added it, who added it.

### A. Admin — the roster of adults

- **A1 Season start.** Eight new volunteers, one address and one role at a time, and Tally sends
  nothing: the URL, "Continue with Google" and *which* Google account travel out of band eight
  times, composed from memory. Edge: a typo; a *correct* address that fails — Gmail ignores dots
  and treats `googlemail.com` as `gmail.com`, and `emailKey` is an exact match; the personal
  account instead of the church one; inviting somebody already on the team, which writes the
  document, shows "can now sign in", and changes nothing. *Major.*
- **A2 Promote / demote.** A select, live, unconfirmed, no undo. Edge: demoting a pinned admin
  sticks (above); the demoted core member loses the editor mid-edit to "Core team only" with no
  word that anything changed. *Major / blocker on the pinned case.*
- **A3 Someone leaves.** One tap on a checkbox ends an adult's access on every device, kills the
  kiosk they paired silently, and leaves them counted in "🔒 3", listed under *On this gathering*,
  and named as "Marcus can add you" for ever. *Blocker.*
- **A4 Someone comes back.** Un-suspend. Recovery is live and needs no sign-out. *Fine.*
- **A5 Chasing the never-signed-in.** "Never signed in" is one bit over four situations — has not
  tried, wrong account, wrong address, stuck in an in-app browser — and a refused attempt is thrown
  away. Nothing to resend; nothing to copy. *Major.*
- **A6 Withdraw an invitation.** Two-step, red, warned, with Undo. *Fine* — and the comparison
  with A3 is the finding: the reversible act is guarded and the consequential one is a checkbox.
- **A7 Handover.** Nobody may change their own role, so nobody can step down; the only exit is
  promoting somebody, and nothing says how many admins exist. The one sentence written for a
  locked-out ministry names an environment variable, on an empty state that cannot render because
  reading Team requires an active profile. *Major.*
- **A8 "What can Sam do?"** No answer anywhere: role on Team, gatherings one sheet per chain,
  kiosks nowhere. The safeguarding question — who could see the roster in October — is answered by
  a screenshot nobody took. *Major.*
- **A9 Sunday rescue by phone.** "Sam says he can't see Nursery." Admins pass every gate, so no
  list an admin sees carries a lock; the route is Events → find it → Who's on → Change → search →
  tap. *Major.*
- **A10 A new gathering with its own team.** The pre-fill is "just you"; the people it is for
  cannot be added until each has signed in once. *Major.*
- **A11 The season roll** (added by the researcher). Ten leave, eight join: eighteen unconfirmed,
  un-undoable single writes. *Major.*
- **A12 A year in** (added). Forty rows, half leavers, no fold, no search, and — correctly — no
  delete. *Major.*

### B. Core — running a gathering's team

- **B1 Narrow Sunday School.** The pre-fill sentence carries the decision. Edge: the option is
  pressable while the sentence still reads "Working out…"; an unreadable register reads as
  "nobody has taken it". *Minor.*
- **B2 Add a volunteer** from the event page or the header chip. *Fine*, once they have a profile.
- **B3 Remove / reopen.** Re-close replaces the kept list (above); removing the approver of a
  bound kiosk kills it silently. *Blocker.*
- **B4 The three-person hop.** Miriam wants Jo on Sunday School. Miriam cannot invite; Dana
  invites on Tuesday; Jo cannot be placed until she has signed in; Jo signs in at 9:05 and reads
  "Nothing you're on today · Nursery 🔒 Miriam can add you"; Miriam is at the other door. The
  intent — *Jo is for Sunday School* — is written nowhere. The honest workaround, in the director's
  words, is making Miriam an admin over everyone's access to a roster of minors because she needed
  to add one nineteen-year-old to the nursery. *Major.*
- **B5 The mis-restriction.** The sentence warns; recovery is anybody on the list. *Fine.*
- **B6 The absent gatekeeper.** Miriam narrowed Sunday School to herself and is on leave; every
  locked row says "Miriam can add you"; "ask an admin" renders only when the list is *empty*; and
  `approvers()` never checks `active`, so the name can be somebody suspended in June. *Major.*
- **B7 Core, not on Friday.** The notice; cannot schedule; asks. *Fine.*
- **B8 Reading the team.** Read-only; cannot see invitations; the next move — find an admin — is
  unstated though the Admin badges are on the page. *Minor.*

### C. Counselor — at the door

- **C1 First sign-in, wrong account.** "Looking for you on the team in Planning Center…", then
  "We couldn't find you … Ask a core team leader to add this address to the team in Planning
  Center", with "Try again" as the primary button — which repeats the same question about the same
  wrong address — and the actual fix, "sign out and use that one", as a grey line. *Blocker.*
- **C2 Locked out on arrival.** A forename — the highest-ranked member, not whoever is in the
  building — on an inert row, and no way to ask. The section opens by itself precisely for the
  reader who chose nothing. Jo has never met Miriam. *Blocker.*
- **C3 Priya adds Jo at the door.** The chip reads "Everyone" or "🔒 3" beside "Change" and a
  select, and reads as a count; an invited Jo who has not signed in gets "Nobody on the team
  matches 'Jo'", which Priya reads as "Jo has no access" and goes to find an admin — the exact trip
  the chip exists to prevent. *Major.*
- **C4 Removed mid-shift.** The roster is replaced under a thumb by "You have not been added to
  this gathering *yet* … nothing else has changed"; no actor, no time; and the mis-tap of ten
  seconds ago is now permanent, because deleting attendance is gated on the chain. *Blocker* (the
  volunteer), *major* (the researcher).
- **C5 Suspended mid-shift.** "A core team leader can switch it back on from Settings." Both nouns
  wrong. Recovery, when it comes, is live — the one seam here that works. *Major.*
- **C6 The kiosk Sam paired.** See above. *Blocker.*
- **C7 Catching up a past register** on a narrowed night: the page does not know the errand it was
  reached with. *Minor.*
- **C8 The header select** offers gatherings the reader cannot open, and landing there costs the
  roster they were working. *Minor.*
- **C9 No signal at the door.** The access stream fails open — the right call, and the staff pair
  asked that it be kept — but every narrowed gathering then paints as a full hero card, and the
  recovery is one red toast per refused student. *Major.*
- **C10 The shared account.** `nursery@church.org` used by four rotating volunteers: attribution,
  "Miriam can add you", the kiosk session and suspension all assume one address is one person, and
  check-out is a custody record. Real, deliberately unsupported, and unsaid at the moment of
  invite. *Minor* — a sentence, not a control.
- **C11 Jo's second week** (added). Chain-keyed access covers every Friday; the retreat covers
  the retreat, and the difference is invisible to the person added. *Minor.*
- **C12 The other person's screen** (added). Every change lands live and nothing announces it:
  a hero card appears silently, a roster becomes a wall, an app becomes "Access turned off".
  *Minor* on its own; four journeys hinge on it.
- **C13 Jo's address changes** (added). A church rolls out Workspace; the new account is a new
  uid; `provisionAccess` creates a second person with no gatherings, the old row stays active, and
  the history splits. Once a year, in every ministry. *Major.*

### D. Turnover and time

D1 is A11; D2, a volunteer moving from Friday to Sunday, is two chains and two core members and
works; D3, a gathering that ends, leaves an orphan ACL that is documented and harmless; D4 is A12.
---

## 3. What the campaign settled before any screen was drawn

Three consultants read the journeys in section 2 and argued: a user researcher who walks journeys
rather than screens (`uxr-journey-critic`), the church staff pair — the director on a Tuesday, the
coordinator at 9:05 on a Sunday (`church-staff-consultant`) — and a volunteer counselor speaking
only from the door (the one voice `.claude/agents/` does not define; it was run as a persona
prompt over the same code, and is worth adding there for the next campaign). Round 1 was
discovery: every journey graded, the missing ones added. Rounds 2 to 5 were the loop: a proposal,
three critiques, a revision, until a round produced nothing above `minor` — the bar
[refinements.md](refinements.md) uses. Each consultant kept its context across rounds, so every
verdict below was checked against the consultant's own earlier findings, not re-derived.

| round | blocker | major | minor | what it was about |
| --- | --- | --- | --- | --- |
| 1 — discovery | 9 | 27 | 16 | three code findings worse than the walkthrough; the copy that instructs a stranded volunteer to do the impossible; the three-person hop; suspension weighed less than withdrawing an unused invitation |
| 2 — proposal v1 | 2 | 11 | 25 | both blockers in v1's *new* surfaces: inferring "not on this gathering" from a refusal code with five other causes; a pinned flag that could never become false |
| 3 — v2 | 0 | 4 | 26 | two distinct problems: an ask strip that pushed the roster under a thumb; a trim control the rules would refuse for the person it served |
| 4 — v3 | 0 | 2 | 13 | one problem, found by all three: the ask parked as a persistent two-button toast over the roster's most-tapped rows |
| 5 — v4 | 0 | 0 | 3 | converged: three one-line guards on the rules and the undo, folded in below |

Two principles came out of the arguing and every change below keeps them:

- **A refusal is a question, not an answer.** Nothing here concludes anything about a person's
  access from a `permission-denied` code. It asks, and when it cannot ask it does what the app does
  today. Round 2 found the first draft breaking this rule in the one place it would have replaced a
  live register on a guess.
- **Nothing at the door depends on somebody else noticing.** Every rescue works when the other
  person's phone is in their bag and both hands are full of a toddler; anything that needs their
  attention is additive. The staff pair said they would quietly never enable a request-and-approve
  queue, and this proposal does not contain one.

And the decisions already made at cost that the proposal leaves alone: locked never hidden; adding
is open to anybody on the gathering, removing and reopening are core, admins pass every gate; the
writer stays on the list and the ACL document is never deleted; Google-only sign-in keyed on an
address; no `active` flag on an invitation; Team is its own route; the event is chosen by a
person; a tap never moves a row; the access stream fails open.

---

## 4. The proposal

Sixteen changes, numbered so the critique record can refer to them. Each names the journeys it
serves, the mechanism, and what it deliberately does not do. Rule and function changes are named
because they are the part that cannot be prototyped.

### P1 — Say the true thing on the four screens a stranded person reads (C1, C5, A7)

The refusal, checking, granted and suspended screens (`Auth.*`, rendered by `AuthGate.tsx`) stop
naming Planning Center, "a core team leader" and Settings. The sentence they need is already
written in `Login.footer`.

- *Checking:* "Checking whether this Google address has been added to Tally…"
- *Not found:* "This address isn't on the team yet." / "Tally lets people in by Google address,
  and nobody has added this one." Then the address with a **Copy** control — the only useful next
  act is telling somebody the exact address, and today it is read off the glass into a text
  message. The **primary** button becomes **Use a different Google account**: it signs out and
  reopens the chooser (the provider already sets `prompt: 'select_account'`; the sign-out is what
  makes Google honour it), because the personal-instead-of-church account is the commonest failure
  and today its fix is a grey line under a "Try again" that repeats the same question. "Try again"
  stays, secondary, for the person who has just been added. The help line: "Ask the leader who set
  you up to add this exact address on Tally's Team page — an admin or a core member can do that"
  (the second half only once P4 ships), and, with P3, "This attempt has been noted for them."
- *Granted:* "You're on the team as Counselor." — and, from P5, which gatherings it just put them
  on.
- *Suspended:* "Your access has been switched off." / "An admin switched off this account's
  access. Any admin can switch it back on from Team, and this screen lets you straight back in when
  they do." The fact and the recovery, which is already live, and no position on why: the first
  draft said "often by mistake", and the person most likely to read that slowly is the one whose
  access was ended deliberately.
- The server's own `message` line is dropped wherever the client has words for the outcome, so
  the big text and the small print can never disagree. The sentence about the deployment's pinned
  addresses moves from the Team screen's empty state — which cannot render, because reading Team
  requires an active profile — to this screen's small print, worded for the person who inherits
  the install: "If nobody at the church can get in any more, the addresses pinned when Tally was
  set up always can."

*Declined:* naming the admins on the refusal screen. The refused person has no profile and
cannot read `users`; `provisionAccess` could return admin names, but that hands the names of a
church's safeguarding admins to anyone with a Google account who reaches the URL. The leader who
told them to install it is the person they already know. The director's answer was no.

### P2 — The invitation is a hand-off, not a database row (A1, A5, C10)

Tally still sends no mail. What changes is that the screen composes the message once, correctly.

- After **Invite**, the toast and the pending row offer **Copy the message**: the URL, "Continue
  with Google", the exact address on its own line under "Sign in with **this** account:" (the
  person receiving it has two Gmails too), and the gathering it is for (P5).
- `Invitation.note` — already in the type and the rules, exposed on no screen — becomes an
  optional "Note (for you)" on the form and the pending row: "nursery, Marie's daughter" is the
  difference between a list readable in a year and forty addresses.
- Inviting an address that already has a profile writes nothing and claims nothing: "Sam already
  has access as Counselor", with the row linked. The screen already knows — the pending filter is
  built on it. In practice an admin does this to fix somebody who "can't get in", and today the
  toast tells her she has.
- The address hint gains the one sentence about shared logins: "One address, one person. A
  shared login makes every register anonymous — for a device several people use, pair a kiosk
  instead." A soft, dismissible note — never a block — repeats it when an address looks like a
  role mailbox (`nursery@`, `kids@`, `youth@`, `office@`, `info@`, `admin@`, `hello@`; one list, no
  cleverness), on the form and again on that person's page (P10), because the shared address is
  usually signed in before anybody thinks about it. Check-out is a custody record; that is the
  whole reason the sentence exists, and nothing else is built for shared accounts.
- Pending rows show **invited by Miriam**, from `invitedBy`, which the rules make **write-once**
  (an update must keep it unchanged), so re-inviting to fix a note cannot take ownership of
  somebody else's invitation; the attribution and P4's withdrawal right read the same field, and
  `invitedBy` is the one word for "who let this person in" on both `invitations` and `users` (P9).
  A write-once rule cannot see a delete-then-create, which is how Withdraw's **Undo** works — so
  `restoreInvitation` carries `invitedBy` back across the way it already carries the role and the
  note, for the reason its own docstring gives: an undo that returns somebody's invitation under
  a different grantor is not an undo.

*Declined:* batch invite. The season roll is eight people who each need a different message; the
copyable message is the cost that was real.

### P3 — Keep the refused attempt as evidence, never as a candidate (A1, A5, C13)

`provisionAccess` writes `signInAttempts/{emailKey}` when it answers `not-on-roster`: the address
as Google reported it, the display name the account gave Google, first and last attempt, a count.
Admin-only read, for the reason `invitations` is. Never written for a kiosk session or a suspended
profile (that path returns `inactive`). At most one document per address and fifty live documents
— the reasoning behind `MAX_LIVE_PAIRINGS`: "not a busy night, it is somebody's script" — and the
card says when the cap has bitten ("Tally stopped recording attempts after 50", with **Clear
all**), because a diagnostic that goes quiet in an unusual week is quiet in the week it was built
for. Swept after thirty days; the sweep is built and tested in the same change.

The Team screen's Invited card gains **Tried to sign in · 1**: "jo.smith84@gmail.com · signed in
as Jo Smith · Sunday 9:05", with **Copy address** and **Not one of ours**. **No Invite button on
the row.** Everything on it was typed by whoever signed in — a free Google account with any display
name reaches this callable — so it is evidence for a diagnosis, not a candidate for admission;
inviting is the ordinary form, with the role chosen deliberately. Where somebody on the team
shares the display name, the line argues for a check rather than a tap: "Somebody on the team is
also called Jo Smith (jo@church.org). Check with her before inviting a second address."

That one card is the whole diagnosis for the wrong-account case, the Gmail-dots case and the
address-change case (C13), each of which today takes a phone call and a guess. Addresses are never
normalised: guessing that two addresses are one account is how the wrong person is granted a
roster of minors, so both addresses are shown to a human. The refused person is told on the
screen that the attempt was noted (P1).

This is a privacy decision and is recorded as one: Tally would hold, for thirty days, the
addresses of people who tried to sign in and were refused. The director's answer was yes, on
three conditions now built in — the sweep ships with it, nothing is written for kiosk or suspended
sessions, and it goes into the church's privacy notice.

### P4 — Core may invite counselors, see the pending list, and withdraw what they invited (B4, B8)

A governance change, asked for by the staff pair in these words: Miriam recruits her own nursery
team, and today the only way to let her is to make her an admin over everyone's access to a
roster of minors because she needed to add one nineteen-year-old to the nursery.

- `firestore.rules`: `invitations` create and update allowed for `isCore()` when the written role
  is `counselor` and, on update, the stored role is `counselor`; `get, list` allowed for `isCore()`;
  delete allowed for `isCore()` when `resource.data.invitedBy == request.auth.uid` and the role is
  `counselor`. Admin-role and core-role invitations stay admin-only in every direction.
  `validInvitation()` closes its key set with `hasOnly`, so the same change extends that list with
  the fields P5 writes — `gatherings`, `resolvedAt`, `placed`, `skipped` — or the first invitation
  with a gathering on it is refused whole. Permitting a key is also permitting a client to set it,
  so the three outcome fields are pinned the way `invitedBy` is: a client update must leave
  `resolvedAt`, `placed` and `skipped` unchanged — they are the server's record, and P9 and P10
  report them as such — while `gatherings` stays the inviter's to set.
- The Team screen: a core member sees the Invited card with the form's role fixed to Counselor,
  the pending list with Withdraw only on rows they created, and "invited by" on every row.
  `Team.membersDescription` stops saying invitations are not listed.
- The read widens from admin to core. The documented reason for admin-only was that a counselor's
  phone has no business holding staff addresses; `users` is already listable by every active
  member, so that line was only ever true of *pending* invitations, and core-yes-counselor-no is
  the right place to redraw it.

Round 2 found the first draft had rebuilt the inversion it was fixing one card over — a create
with no undo hands a core member a mistake she cannot take back and a wrong person who can sign in
until an admin is found. The verb pair widens together.

### P5 — An invitation carries what it is for, and says what it did (B4, A10, C11)

`invitations.gatherings: chainKey[]` (optional, at most twenty). The invite form offers the chains
the inviter can work as tick-boxes under **Put them on** — only when something is narrowed; when
nothing is, the form says why there is nothing to tick: "Nothing is narrowed yet, so everybody
invited can work every gathering." On first sign-in `provisionAccess` adds the new uid to each
named chain's `eventAccess.members` — Admin SDK, so the rules do not apply — re-checking at
resolution time that the inviter is still an admin or still on that chain, and skipping any chain
where they are not.

A skip is a fact somebody has to receive, and a success is confirmed at the one moment Tally can
confirm the text message Jo is holding:

- The grant screen names what happened: "You're on the team as Counselor. You've been put on
  Sunday School." / "… Sunday School couldn't be added — Miriam is no longer on it. Ask her, or an
  admin." / "put on the retreat (Sep 12 only)" for a one-off, because the difference between a
  gathering and every gathering in its repeat is invisible to the person added and permanent.
- The outcome is written back onto the invitation (`resolvedAt`, `placed`, `skipped`). The
  pending card carries **Arrived this week** — seven days from `resolvedAt`, rendering nothing when
  empty — and a skipped placement is not news but an **outstanding item** that sits in the pending
  card until resolved: "Jo arrived Sunday · Sunday School wasn't added: Miriam was no longer on
  it · **Add now** · Dismiss" — one tap for an admin, or a core member on that chain.

Effect: the Tuesday work finishes on Tuesday. Jo signs in at 9:05 and Nursery is her hero card.

*Declined:* an email-keyed pending list on the `eventAccess` document — it would put staff
addresses on a document every active member reads, which is the line P4 is careful to keep.

### P6 — The sheet tells the truth about who is not found, and the chip says what it opens (C3)

- The "Add somebody" empty state becomes two sentences for two facts: "Nobody who has signed in
  to Tally matches 'Jo'." then "If Jo has been invited but hasn't opened Tally yet, she needs to
  sign in once on her own phone — then search again. If she hasn't been invited, an admin or a core
  member can do that on Team." A core member additionally sees pending invitations naming this
  chain: "Invited, not signed in yet: jo@church.org."
- The header chip reads **Who's on · 3** when narrowed and **Who's on · everyone** when open, in
  the brand colour the Change pill wears. Decided once, for this change and P7 together: a noun
  that names the sheet it opens, no verb — the volunteer quick-adds visitors most weeks and read
  "Add" beside a roster as "add a child" — and not "leaders", which in the staff pair's building
  means small-group leaders and specifically not the nursery volunteers standing at that door.
  Nothing else is ever added to the chip; the header's own rule is that everything beside the
  select holds its size and the select takes what is left, and the select is the control that
  repairs being on the wrong night. `'Everyone'` is a literal in the source today; it is
  translated.
- For a reader who is **not** on the gathering, the sheet **opens on** what the locked page
  carries — who can add you, full names, the admin fallback, and **Ask to be added** (P7) — rather
  than on the state of the gathering: same component, same fewer-verbs pattern it already uses for
  counselors, different order. That is what lets the header select's demoted option (P15) open it
  in place.
- For a reader who **may add**, the sheet leads with any waiting ask — "Sam Whitfield is asking to
  be added · **Add**" — with the name above the finger on a surface built for the decision, and
  **Clear** as a second press ("Clear Sam's ask?"). Clear is never on the roster.
- Suspended members are **marked, not hidden** in "On this gathering", **excluded from every
  count** (the chip, `restrictedDetail`), and **never named as the way in**. Membership survives
  suspension by design, so un-suspending restores it; read-time filtering is the fix, not a
  cleanup job.

### P7 — The locked row names somebody who is here, opens something, and can ask (C2, B6)

- `approvers()` filters out suspended profiles and ranks by presence before rank: a member whose
  `lastSeenAt` is today first, then core, then admin. That stamp is once per session by design,
  so the ordering hint is "opened Tally today", not presence, and the proposal claims no more. **On the phone row: one name and the lock**,
  so the fallback is never the part that truncates. The page the row opens carries the second
  name, full names — a forename is the app's entire answer to somebody who has never met Miriam,
  in a lobby of two hundred — and the admin fallback, **unconditionally**: "or any admin: Dana
  Ruiz". Today `Events.askAnAdmin` renders only when the list is *empty*, and the named person may
  be on leave or suspended since June, which the app cannot know and the reader can.
- **The row is tappable** and opens the LockedGathering page that already exists for the URL and
  catch-up doors. The inert-row argument was made about a disclosure the reader chose to open; the
  section opens by itself precisely when the reader has chosen nothing, and on a touch screen a
  tap with no response is indistinguishable from a tap that missed.
- **Ask to be added.** One button on that page (and in the sheet, P6) writes
  `accessRequests/{chainKey}__{uid}` — create by the requester as themselves; read by active
  members; clear by anybody on the chain or the requester. It notifies nobody and nothing waits
  on it. Pressed, it says what it did and what to do with your feet: "Your name is on the Add list
  for Miriam Achebe and Dana Ruiz — they'll see it under *Who's on* when they open this roster. If
  they're not here, go and find them." Never "asked", "request", "pending" or a status: anything
  shaped like a workflow is a promise the design does not make.
- **On the other side, the durable home is the sheet, the signal costs no width, and the nudge
  is an ordinary toast.** The "Who's on" sheet leads with the ask row (P6). While an ask waits,
  the chip carries an 8px dot beside "Who's on · 3" — no word, no target, the select keeps its
  width — and the same dot sits on the event page's "Change who is on it" button, which opens the
  same sheet, so the Tuesday reader learns it too. When the ask lands on a roster held by somebody
  who may add, a normal-duration toast
  reads "Sam Whitfield is asking to be added" with one action, **See**, which opens the sheet; the
  toast body stays click-through as the provider already makes it, and the toast is evictable and
  times out like every other, because the fact it announces lives elsewhere. This took three
  rounds to place. Round 3's shared major was a strip above the first roster row, inserted by
  somebody else's tap, pushing every name down under a thumb already descending — the mechanism
  Journey 1 was rebuilt to prevent, on the screen `e2e/layout-shift.spec.ts` holds to a landing
  budget of zero. Round 4's shared major was the repair: a persistent toast carrying Add and Clear
  over the roster's most-tapped rows, on a phone that, for a counselor, has no tab bar under it —
  and `ToastProvider.tsx` already documents that a swallowed tap there records a standing child
  absent, that the stack caps at three and evicts, and that the panel had to be made click-through
  for exactly this reason. A place for things that have just happened is not a place for an
  outstanding item.
- **Clear is not silence.** Clearing marks the document (`clearedBy`, `clearedAt`) rather than
  deleting it, and the asker's page says "Miriam cleared this at 7:01 — ask her in person";
  otherwise the asker cannot tell "nobody looked" from "somebody said no" and presses again.
  Documents live seven days; the roster shows only today's; the person page (P10) shows the week's
  unanswered asks to an admin on Tuesday.

If nobody looks, Sam walks over exactly as today and the ask has cost nothing. That is what makes
it the version the staff pair would turn on — and the volunteer's honest note is that on most
nights the four-second toast will be missed and the real path is Sam saying "can you add me" out
loud, at which point his name is one tap instead of a search. That was always the real path; the
ask makes it shorter and never replaces it.

*Declined:* a held check-in queue on a locked gathering ("let me start ticking names and hold
them"). Tally is online-only by decision; a queue of writes the rules will refuse, held in memory
against a gathering the reader may never be put on, is the worst failure this app has wearing a
different coat. The mid-shift case is prevented at the other end instead (P8), and the volunteer
accepted the trade on that condition.

### P8 — Taking a gathering away from somebody standing in it is a different act (C4, C12)

- In the sheet, a member is **at the door now** when the check-in window is open **and** they have
  checked anybody in on this gathering tonight — and only that. Remove on such a row arms first —
  "Priya is checking people in right now. Remove anyway?" — and every other Remove stays one tap.
  The guard cannot see somebody who has opened the register and not yet had a student reach them:
  the app has no presence beyond writes, `lastSeenAt` is a once-per-session stamp by deliberate
  design (a draft widened the guard onto it and would have missed the counselor who has had the
  app open since four while admitting the one at home), and inventing a presence signal is a
  listener on every phone on every screen. Said here so nobody agrees to more than ships; the
  volunteer accepted the declined held queue on the condition that this guard fires when they are
  at the door, and this is exactly when it does.
- The page the removed person lands on loses "yet" and "nothing else has changed", and says what
  happened: "You were taken off Friday Fellowship at 7:14. You had checked in 22 students before
  that." The count is captured from memory **before** the register is dropped, and **omitted,
  never zero**, when it is not in hand — a zero there tells somebody their morning vanished.
- Who did it: `eventAccess.updatedBy` is the last writer of a document two people hold at once
  (which is why the collection is written with `arrayUnion` and `arrayRemove`), so a sentence
  built on it can name the wrong person. Every add, remove, close and reopen also writes
  `lastChange: {kind, by, at, subject}`, pinned in `validAccess()` the way `validArrival()` pins
  its own — `kind` from a closed set, `by` and `subject` uid-shaped strings or null, `at` a
  timestamp — because that document is read on every gated request. The sentence names the actor
  only when `subject` is the reader. A close has no subject and gets its own sentence, naming
  nobody: "Friday Fellowship was narrowed at 6:58 — you're not on the list it kept." That is B5,
  the mistake the whole feature is built around, and it needed a sentence of its own.
- The additive case lands as a toast on the other person's device — "Priya added you to Friday
  Fellowship — every Friday" / "— Sep 12 only" — from a diff over the access stream the app
  already holds, **after its first snapshot**, never on boot, or a counselor opening Tally on a
  Friday would be told she was just added to three gatherings she has worked since March.
- Lost undo on the mis-tap of ten seconds ago is accepted and stated: the rule that gates deleting
  attendance on the chain is the right rule; the guard above is what keeps it from mattering.

### P9 — Suspension says what it takes and weighs what it costs (A3, A11)

- The Active toggle becomes a **two-step**, inline, the shape Withdraw already has: arm, a
  sentence, confirm. The sentence is computed from what the app knows: "Ends Marcus's access now,
  on every device. He is on Sunday School and Nursery, and is the only person on Nursery who can
  add others. A kiosk was paired as him on Sep 3 (last seen Sunday 11:40) and will stop." It counts
  **live** pairings — bound now, or seen within fourteen days — and mentions older ones as a tail;
  pairings before the change are unknown and it says so. The toast after confirming offers
  **Undo**. Un-suspending is armed too, with the mirror sentence — "Restores Marcus as Core team,
  on Sunday School and Nursery" — because membership survives suspension by design and one tap on
  a folded row would otherwise return a former leader to Nursery with nothing on screen saying so.
- Role changes get a toast with **Undo**. No arm step: reversible and not destructive.
- Suspension stamps `accessEndedAt` / `accessEndedBy`; un-suspending stamps `accessRestoredAt`;
  `provisionAccess` stamps `invitedBy` onto the profile when it resolves an invitation, and "the
  deployment" for a pinned address. With `createdAt`, that is the narrow safeguarding fact the
  director asked for — **when access was granted, by whom, and when it ended** — and nothing more.
  Per-gathering membership history is not recorded, and the person page says so, so an admin
  answers "who could see the roster in October" honestly rather than wrongly. The stamp never lands
  for anybody who already has a profile, so a one-off backfill copies `invitedBy` from every
  surviving invitation document, and where none survives the page reads "Not recorded (before
  <date>)". Rules already permit extra fields on `users`.
- The season roll stays eighteen acts, deliberately: each is about a different adult.

### P10 — A person has a page (A8, A9, B8)

Each Team row expands — a disclosure, not a route — into the facts about that person, gathered
once: role; last seen; invited by whom, when and for what, with what happened (P5); **the
gatherings they are on** — every narrowed chain, on or not on, from `eventAccess`, which everyone
can read; the kiosks paired as them, with **Forget this kiosk**; the access dates (P9); the week's
unanswered asks (P7); and the role-mailbox note (P2). Rights are drawn per chain the way the sheet
draws them, not per rank: anybody on a chain sees Add beside it, core on the chain sees Remove,
admins see both everywhere, and controls appear only for narrowed chains, where `onIt` and
`writerStays()` agree. This is the 9:22 rescue — Team → Sam → Nursery → Add, on a phone.

A **find-by-name** field sits over the list, and it searches the fold (P12) too, opening it on a
match: the person the director most often looks for by name is the leaver.

Admins stop being blind without ceasing to pass: a narrowed gathering on an admin's chooser and
calendar carries a quiet "🔒 narrowed · 3" on the card or row it already has. Nothing is demoted
for an admin; the fact is drawn.

### P11 — A kiosk knows when it has lost its identity; Team knows which kiosks exist (C6, B3)

The correctness fix, and the most important change here.

- **`checkAccess({chain})`**, one small callable, **returns** `{status: 'ok' | 'inactive' |
  'not-on-chain', role}` and never throws for an access answer; it throws only for transport
  failures. Its client is one module with one burst rule for both callers below: one in-flight
  check per chain, a sixty-second floor, and while a check is in flight refusals are held silently
  and resolved together when the answer lands.
- **The kiosk asks when a write is refused.** On `permission-denied` from a check-in, a check-out
  or the register poll it calls `checkAccess` for its bound chain. `inactive` or `not-on-chain` is
  **lost identity**; a throw is "could not ask, carry on" — a network fact is not an identity fact,
  and a basement nursery must never blank mid-queue on a bad thirty seconds. The
  permission-denied-means-frozen-student branch stays for the case where the answer is `ok`. Two
  states that were one: "this child's record is frozen" and "this device is nobody". The same
  check runs at bind time and on the boot/wake sweep that already exists; firing at 9:15 to an
  empty lobby beats 9:35 to a queue.
- **The dead state is the pairing phase** — a code on the glass, the shortest path from "this
  device is nobody" to "somebody" — with a banner for the greeter, not the parent: "This kiosk lost
  its access at 9:12. Check-ins since then may not have been recorded — keep checking children in
  from a leader's phone (Check-in → Nursery), and pair this kiosk again: tap your name, choose
  Kiosk, enter this code." The hole already dug is named, and the register on a phone is declared
  the source of truth. No recovery queue, and it replays nothing.
- **The pairing is the record; liveness is the soft fact.** `claimKioskToken` writes
  `kioskDevices/{deviceId}` — approver, paired at — server-side, so the fact Team reads cannot go
  quiet. The kiosk updates only `lastSeenAt` and what it is bound to, every five minutes, only
  while bound and the window is open, silently on failure, and never as evidence about identity.
  Core+ read. Duplicates are expected — the kiosk's own module documents that installing after
  pairing makes a fresh storage container — so rows can be forgotten (P10) and are swept after
  sixty days unseen.
- Recorded direction, not built, at the director's request: **a kiosk is a room, not a
  volunteer**. "The kiosk is Sam" is the root cause of every finding in this section, and it should
  eventually hold a service identity no personal suspension can take down. Written into
  [data-model.md](data-model.md)'s kiosk section for whoever inherits this.

### P12 — The list folds its leavers (A12)

Suspended profiles move under a collapsed **No longer on the team · 12** at the foot of the
Signed-in card — the "Not yours" idiom — so the working list is the working team and a departure
is not memorialised at the top of a list every core member reads. No delete, ever, and the reason
is on the screen's disclosure: deleting a profile orphans the `checkedInBy` on every register they
took, and — because invitations are never consumed — the next sign-in would re-provision them from
the stale invitation at whatever rank it carries.

### P13 — Handover, and the pinned rows read where the truth lives (A2, A7)

- `provisionAccess` runs on every fresh sign-in (a new uid in `onAuthStateChanged`), not only from
  the refusal screen, so the deployment's grant is re-asserted the way the docs already claim.
  Idempotent; one call per sign-in, not per token refresh.
- **Nothing is cached on the profile.** The first draft stamped `pinned: true` and nothing ever
  cleared it — an address leaving the variable would have become an admin account no screen could
  end, which is the original defect with its sign flipped. Instead the admin's Team screen asks a
  small admin-only callable for the pinned addresses when it draws; matching rows read **Pinned by
  the deployment — changed by whoever deploys Tally, not here**, with no role select and no toggle.
  An address that leaves the variable is an ordinary row on the next draw. Day one is right without
  anybody signing in. When that call does not answer, the failure is rendered as a failure, in the
  file's own idiom: the roster draws, the controls stay, and a line says "Couldn't check which
  admins are pinned by the deployment — a change to a pinned admin reverts at their next sign-in",
  with Retry. "The last pinned admin has left the church" is a deployment fact and is documented as
  one beside the variable in [deployment-setup.md](deployment-setup.md).
- When the active admins number one, the Team header says so to that person: "You are the only
  admin who can change the team. Promote somebody before you hand this over." Nobody can step down;
  that rule stays. This is the sentence that makes the exit visible.

### P14 — Re-closing keeps the list, and the kept list is visible while open (B3, B5)

- `restrictChain` unions: on an existing document it writes `members: arrayUnion(…)`; only a
  document that does not exist is created whole. The comment and
  [data-model.md](data-model.md#eventaccesschainkey) then tell the truth.
- While the gathering is open, the sheet shows **the kept list and the recent register-takers as
  ticks** under one sentence: "These are kept when you narrow it — nobody's access changes until
  you press *Only people I add*." Unticking is local; the press is the single `restrictChain` write
  that already includes the writer, so "limit who is on it" can be a trim before the press rather
  than a union that excludes nobody. The first draft drew a per-name Remove here, and round 3
  found `writerStays()` would refuse it for exactly the core member it served — she is not in the
  March list she is trimming. No per-name write ever happens on an open gathering. Two things the
  ticks must not imply: **the writer's own row is a fact, not a tick** — `restrictChain` adds her
  regardless, correctly, so her row is drawn fixed with the one-line reason and the preview counts
  what will actually be written; and **the press runs as a transaction** that reads the current
  `members` and unions anybody added since the sheet opened, whom the sheet — already subscribed —
  shows as a new ticked row ("added just now by Priya") while it is open. `restrictChain`'s
  exemption from the collection's transform rule was justified by the document not existing yet;
  the kept-list case is the one where it does, and the volunteer added at the door sixty seconds
  earlier is the one who would otherwise be erased.
- The option cannot be pressed while the detail still reads "Working out…" (the sentence is
  load-bearing; pressing past it should not be free), and an unreadable register says "Couldn't
  read recent registers — would keep just you" rather than posing as "nobody has taken them".

### P15 — Failing open, asking before concluding, and demoting in the select (C9, C8)

- The access stream keeps failing open — an app that is refusing must never look empty. The
  stream-error banner the app already shows gains one sentence, once, when the access stream is
  the one that failed: "Who's on tonight's gatherings couldn't be checked — if one refuses you,
  Tally will say so." No per-card hedge: a per-device flag would suppress it on the new phone with
  a cold, failed stream it was written for and strand it for ever on a phone that saw one
  restriction in March.
- **On the first refused write the check-in page asks, never infers.** It calls `checkAccess`
  (P11). Only `not-on-chain` switches to the LockedGathering page — after taking the green back
  off the refused row where it stands, never re-sorting, and after capturing the count for P8's
  sentence. `inactive` is the profile stream's business; `ok`, and any failure to get an answer,
  is today's toast. A register with students in it is never replaced on a guess: the first draft
  inferred from the refusal code, and a frozen student, a stale suspension and an out-of-range
  grade all produce the same code.
- **The header select demotes, never hides**: locked gatherings sit in an `<optgroup>` labelled
  "Not yours" at the foot, with a lock, and choosing one opens the "Who's on" sheet in place
  (P6) — who can add you, and the ask — rather than a page, so the night being worked is never
  unmounted and the Recent stickiness, which is deliberately written nowhere, is never lost. A
  demoted option **never changes the select's value**: it fires the sheet and the select goes on
  reading the night being worked, because a select reading "Sunday School" over a Friday roster
  for even a moment is the one mistake the app is built around. The first draft filtered the
  options out, which contradicted the principle it cited.

### P16 — Housekeeping the seams

`Suspended`, `(you)` and the raw role strings in the sheet and the locked page are translated
alongside `'Everyone'`; the catch-up tail's locked page knows the errand it was reached with ("You
came to take last Friday's register; you are not on this gathering"); the core member demoted
mid-edit reads "This was open to you a minute ago — your role changed" when the profile stream
just changed it, not "Core team only".

---

## 5. What this proposal will not build, and why

- **Delete a person.** Orphans attribution on every register; re-provisions from the stale
  invitation at the old rank. Fold instead (P12).
- **An `eventAccess` cleanup job, or orphan-ACL tidying.** Read-time filtering (P6, P7) is the
  fix; membership survives suspension so un-suspending restores it.
- **Shared-account support.** One sentence where the mistake is made (P2); the supported answer
  to "a device several people use" is the kiosk.
- **Email or push from Tally.** A copyable message (P2); an ask that is a row on a screen the
  right people already hold (P7), never a notification.
- **A held check-in queue for locked gatherings.** P7, declined, with the volunteer's agreement.
- **A general activity feed.** Three stamps on the profile (P9) answer the safeguarding question
  that can honestly be answered.
- **Per-gathering membership history.** The claim is narrowed instead (P9).
- **Address normalisation.** P3 shows both addresses to a human.
- **Batch invite.** P2.
- **Naming admins on the refusal screen.** P1; the director's decision.
- **A presence signal beyond `lastSeenAt`.** P8; a listener on every phone on every screen.
- **A permanent lane on the roster for the ask, or a sticky toast kind in the provider.** P7; a
  rare event should not cost every roster a row of height, and the provider's limits are the
  reason the ask cannot live there — widening it would keep the ask on the one surface that
  documents why it should not be.

---

## 6. Sequencing

1. **Correctness and copy, no new surfaces.** P1; P11 (the `checkAccess` client and its burst
   rule, the kiosk's lost-identity phase, the pairing record); P13; P14; the filtering of suspended
   members in P6 and P7; P15's ask-before-concluding and the select's optgroup.
2. **The invitation as a hand-off.** P2, P3, P4, P5.
3. **The Team screen answers for people.** P9 with its backfill, P10, P12, the find field, the
   only-admin line.
4. **The door.** P7's ask, P8, P15's banner sentence, P16.

---

## 7. Decisions for the owner

Four were put to the director during the loop and answered in character; they are recorded here
for the owner's own answer.

1. **P3** keeps refused sign-in attempts for thirty days, admin-only. *Director: yes*, on the three
   conditions now built in.
2. **P4** lets core invite counselors, read the pending list, and withdraw what they invited.
   *Director: yes*, with attribution.
3. **P1** does not name admins on the refusal screen. *Director: keep it that way.*
4. **P11** records "a kiosk is a room, not a volunteer" as a direction and does not build it.
   *Director: record, do not build.*

And one the loop could not settle because it is a matter of taste rather than journey: the chip's
exact words (**Who's on · 3**) and the ask toast's exact shape are the two things here that a
rendered-frame round — `uxr-visual-critic` and `uxr-design-critic` over the real header and the
real roster — should look at before they are built.
