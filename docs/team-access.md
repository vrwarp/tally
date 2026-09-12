# Team management and event access — the journeys, and a proposal

**Status: proposal, for review.** Nothing in this document is built. It is the record of a design
campaign run the way the ones in [refinements.md](refinements.md) were run, but at design time
rather than against rendered frames: the journeys were walked, argued over by three consultants
until a round produced nothing above `minor`, and the proposal below is what survived — then
revised once more after the owner's review (section 7). Every claim
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
discovery: every journey graded, the missing ones added. Rounds 2 to 5 were the loop, and round 6 the owner's review: a proposal,
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
| 6 — the owner's review | 0 | 2 | 14 | four questions from the owner (section 7): invite links must name the account before the token is spent; a retired kiosk must notice on the refused write, not a five-minute poll |

Two principles came out of the arguing and every change below keeps them:

- **A refusal is a question, not an answer.** Nothing here concludes anything about a person's
  access from a `permission-denied` code. The kiosk asks the register, which a frozen student can
  never refuse; the check-in page says only what it saw; and where nothing can be asked, the app
  does what it does today. Round 2 found the first draft breaking this rule in the one place it
  would have replaced a live register on a guess.
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
  (the second half only once P4 ships). And one line for the one wrong-account case the link (P2)
  leaves: "If a leader sent you a link, open that link instead of signing in here."
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

### P2 — The invitation is a hand-off: a link, a QR, or an address (A1, A5, C1, C3, C10)

The invitation used to be an address an admin typed, matched exactly against whichever Google
account the volunteer happened to pick, with nothing sent to anybody. Two doors now share the form:

- **Invite link.** The inviter chooses the gatherings it is for (P5) and types **who it is for** —
  "Jo, nursery, Marie's daughter" — which is required, because a link row has no address to name
  it and eight anonymous rows on a Tuesday is how the season roll goes back into a spreadsheet.
  Tally mints a 128-bit token, stores only its hash on the invitation, and offers the link with
  **Share** and **Copy**, or as a **QR** on the screen for the person standing beside you. A link
  is single-use and lives fourteen days; a QR is the same invitation re-minted with a ten-minute
  life, because its whole safety property is that both people are in the room. The row shows
  "not used yet · expires Sunday 21st" and one tap **extends** it (re-minting, which invalidates
  the old token). Every link grants **counselor and nothing else**, whoever mints it: a core-team
  link that leaks in a screenshot would open Insights, Students and Settings, and promoting is one
  tap on the row once there is a person to promote. At most twenty unredeemed links live at once.
- **Invite by address**, for the case where the inviter knows the account — the church's
  Workspace address. It keeps the optional note, and the address hint gains "For Gmail addresses,
  dots and +tags don't matter" (P17).

**Redeeming.** `/join/<token>` opens on who invited you and for what — "Miriam Achebe invited you
to Tally for Sunday School" — and one button, **Continue with Google — any account is fine**. The
token survives the Google round trip (it is kept for the session, so a redirect sign-in lands
back on it, never on "we couldn't find you" holding a spent link). After sign-in the page names
the account **before anything is spent**: "Join as jo.smith84@gmail.com?" with **Join** and **Use
a different account**. Round 6 found that without this step the link does not remove the
wrong-account failure, it converts a loud refusal Jo fixes in ten seconds into a silent grant to
the wrong identity that only an admin can undo — and a phone's default account is the one the
chooser leads with. Only **Join** spends the token. The screen then says which account you are
in as and to use that one next time, and names the gatherings you were put on (P5). A used or
expired link says so and names the inviter to ask.

**Afterwards.** The redemption is written on the invitation — who, which address, when — and the
row moves to **Arrived this week** (P5) reading "used by Jo Smith (jo.smith84@gmail.com) on
Sunday", so the naming of the redeemer is something the inviter meets rather than looks for; a
name the inviter does not recognise is one tap from Suspend on the profile. A redeemed row is a
different object from an unredeemed one: it carries no Withdraw, because withdrawing would not
evict anybody and would delete the only record of who redeemed the link. Withdraw stays on
unredeemed rows only, and a redeemed invitation is kept as the audit.

Also: inviting an address that already has a profile writes nothing and says "Sam already has
access as Counselor" with the row linked; the one-address-one-person hint and the role-mailbox
note (`nursery@`, `kids@`, `youth@`, `office@`, `info@`, `admin@`, `hello@`) stay, on the form and on
the person's page; `invitedBy` is write-once in the rules and carried across an Undo.

*Honestly scoped:* the QR covers the volunteer who turns up beside a **core member**. A counselor
cannot mint one — handing out the access you hold on one gathering is not the same act as granting
sign-in to the ministry — so Jo beside Priya at 9:06 is still Priya texting a core member, who
mints the link from wherever they are. P5's placement on the invitation is what closes the planned
case; the QR closes the same-room case.

*Declined:* multi-use links, now and in writing (section 5) — a link that works twice is a password
to the children's roster pasted in a group chat. Batch invite, as before.

### P3 — Dropped: keeping refused sign-in attempts

v1 to v4 kept a thirty-day record of every refused sign-in, admin-only, as the diagnosis for the
wrong-account, mistyped-address and address-change cases. The owner's review removed the need:
invite links (P2) mean nobody types an address for the common case, and the Gmail canonical key
(P17) removes the largest class of "correct address that fails". Dropping it is also the better
governance answer — Tally stops holding the addresses of people who never got in. What remains of
the wrong-account case is one line on the refusal screen (P1): "If a leader sent you a link, open
that link instead of signing in here."

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

### P8 — Taking a gathering away from somebody standing in it, kept plain (C4)

The owner's review asked that mid-shift loss of access be "just not broken" rather than designed
for, and round 6 walked every drop: none leaves a journey broken. Today the live access stream
already replaces the roster with the LockedGathering page the moment somebody is removed; that is
not broken. What changes is the copy: the page loses "yet" and "nothing else has changed", and —
because the app knows it had a roster open a second ago without asking anybody — it says **"You've
just been taken off this gathering"** in that case rather than a sentence that reads as though the
reader was never on it. No guard on Remove, no `lastChange` map, no count, no dated actor, no
toast. "Ask to be added" (P7) stays on the page.

### P9 — Suspension says what it takes and weighs what it costs (A3, A11)

- The Active toggle becomes a **two-step**, inline, the shape Withdraw already has: arm, a
  sentence, confirm. The sentence is computed from what the app knows: "Ends Marcus's access now,
  on every device. He is on Sunday School and Nursery, and is the only person on Nursery who can
  add others." There is no kiosk clause any more: with P11 a kiosk holds its own identity and
  suspending Marcus stops nothing. The toast after confirming offers **Undo**. Un-suspending is
  armed too, with the mirror sentence — "Restores Marcus as Core team, on Sunday School and
  Nursery" — because membership survives suspension by design and one tap on a folded row would
  otherwise return a former leader to Nursery with nothing on screen saying so.
- Role changes get a toast with **Undo**. No arm step: reversible and not destructive.
- Suspension stamps `accessEndedAt` / `accessEndedBy`; un-suspending stamps `accessRestoredAt`;
  `provisionAccess` stamps `invitedBy` onto the profile when it resolves an invitation or a link,
  and "the deployment" for a pinned address. With `createdAt`, that is the narrow safeguarding
  fact the director asked for — **when access was granted, by whom, and when it ended** — and
  nothing more. Per-gathering membership history is not recorded, and the person page says so. The
  stamp never lands for anybody who already has a profile, so a one-off backfill copies
  `invitedBy` from every surviving invitation document, and where none survives the page reads
  "Not recorded (before <date>)". Rules already permit extra fields on `users`.
- The season roll stays eighteen acts, deliberately: each is about a different adult.

### P10 — A person has a page (A8, A9, B8)

Each Team row expands — a disclosure, not a route — into the facts about that person, gathered
once: role; last seen; invited by whom, when and for what, with what happened (P5); **the
gatherings they are on** — every narrowed chain, on or not on, from `eventAccess`, which everyone
can read; **the kiosks paired by them**, from the device row (P11), each saying whether it is bound
and live right now, with **Retire** — which arms when the kiosk is live, because retiring a working
lobby screen mid-morning is an act that takes something away, and the duplicate rows an installed
tablet leaves behind make the mis-tap likely; the access dates (P9); the week's unanswered asks
(P7); and the role-mailbox note (P2). Rights are drawn per chain the way the sheet draws them, not
per rank: anybody on a chain sees Add beside it, core on the chain sees Remove, admins see both
everywhere, and controls appear only for narrowed chains, where `onIt` and `writerStays()` agree.
This is the 9:22 rescue — Team → Sam → Nursery → Add, on a phone.

A **find-by-name** field sits over the list, and it searches the fold (P12) too, opening it on a
match: the person the director most often looks for by name is the leaver.

Admins stop being blind without ceasing to pass: a narrowed gathering on an admin's chooser and
calendar carries a quiet "🔐 3" on the card or row it already has. Nothing is demoted
for an admin; the fact is drawn.

### P11 — A kiosk is a room, not a volunteer (C6, B3)

The owner asked whether a kiosk's authorisation has to be tied to a person. It does not, and it
should not: "the kiosk is Sam" was the root cause of the one finding in this campaign that loses
data, and every earlier draft of this section was a bandage on it.

- **Its own identity.** `claimKioskToken` mints a token for a synthetic uid `kiosk_<deviceId>`
  with claims `{kiosk: true, deviceId}`, where the device id is one the kiosk mints for itself and
  keeps in its own storage. The claim writes `kioskDevices/{deviceId}` — who approved it, their
  name as of that moment, when — and that row is the kiosk's standing: rules and callables gate a
  kiosk session on **the row existing and not being retired**, never on the approver's profile.
  Suspending or removing the approver touches nothing.
- **Its reach is the room it stands in.** On bind the kiosk writes onto its own row what it is
  bound to — the gathering's title and chain — and the attendance rules let a kiosk session write
  only to that chain. Today a lobby session's reach is bounded by the approver's chains; under a
  service identity it would otherwise pass every chain, and the device row is being written
  anyway. The kiosk may update only `lastSeenAt`, `boundTo` and `boundChain` on its own row, on a
  timer while bound and the window is open, silently on failure.
- **The rules.** `isLiveKiosk()` — the claim, plus the row exists and `retiredAt` is null — is the
  alternative to `isCounselor()` on exactly what a kiosk touches today: an attendance record, a
  first pickup, the eight-key student date patch, the register poll, the active-student list, the
  three index documents, a backdrop. The kiosk claim keeps narrowing what it may do exactly as now
  (no undo, no profiles). Callables the kiosk calls take the same gate.
- **Attribution, honestly.** `checkedInBy` becomes the kiosk uid, which carries the device id;
  `method: 'kiosk'` already marks these rows; the register export writes "Lobby kiosk" in the
  name column and the device id beside it. A pickup from the lobby is the parent's act and never
  was the approver's, so this is the truer custody record. Who paired the device, and their name
  at the time, live on the device row — which is why **retiring a kiosk marks the row
  (`retiredAt`, `retiredBy`) and never deletes it**, and why there is no sweep: the row is the
  provenance of every morning that kiosk recorded, and a device row costs nothing to keep.
- **Retiring, and noticing.** Retire from the person page (P10) or the pair-kiosk page; the row
  says whether the kiosk is bound and live, and the act arms when it is. The kiosk notices on its
  next refused write, not on a five-minute poll: a refused check-in **re-reads the register** — the
  read a frozen student can never refuse, since `attendanceFrozen()` gates writes only — and the
  answer collapses the ambiguity. Read succeeds: it was the student, today's behaviour stands and
  the child standing there stays green. Read refused: this device is nobody, the binding is put
  down and the screen goes to **pairing**, with the greeter's sentence: "This kiosk stopped being
  able to record at 9:12 — keep checking children in from a leader's phone, and pair it again:
  tap your name, choose Kiosk, enter this code." No callable, no debounce, one round trip. The
  register poll keeps its own refusal branch for the idle case.
- **The chooser keeps the app's grammar.** `getKioskEvents` offers every gathering — a leader
  binding a lobby screen chooses the room — with the ones the pairer works as the answer and the
  rest below a divider marked as the chooser marks them, because the old narrowing to the
  approver's chains was quietly keeping a greeter from binding the nursery tablet to the youth
  night one tap away.
- **Migration.** A token minted before this change carries no `deviceId` claim. The kiosk reads
  its own claims at boot and, finding none, goes to pairing once — with its own sentence, because
  a bare pairing screen at 9:15 reads as "somebody unpaired us": "Tally was updated — this kiosk
  needs pairing once. Any leader: tap your name, choose Kiosk, enter this code." The re-pair goes
  in the deploy notes so it can be done on a weekday, and pairing stays open to any active member,
  as today, so migration morning does not depend on a core member being in the lobby.

The identity this replaces was documented as the kiosk's design; the docs that say "every
check-in it records will be under your name" change with it.

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

### P15 — Failing open, staying plain, and demoting in the select (C9, C8)

- The access stream keeps failing open — an app that is refusing must never look empty. The
  stream-error banner the app already shows gains one sentence, once, when the access stream is
  the one that failed, and it promises only what happens: "Who's on tonight's gatherings couldn't
  be checked — if one refuses you, ask a leader to add you." (An earlier draft promised "Tally
  will say so" on the strength of machinery this revision removed; a banner that promises an
  explanation nothing delivers is worse than none.)
- **No inference from a refusal code, and no callable either.** v2 to v4 asked a `checkAccess`
  callable before concluding anything; the owner's review judged the whole mid-shift class too
  rare for that, and round 6 agreed nothing is left broken by dropping it — the live stream
  already flips the page for the ordinary case. What remains is the cheap, honest version: the
  page counts refused check-ins per gathering, and at the third — three refusals cannot be three
  frozen students — replaces the third toast with one banner, "This gathering isn't letting you
  check in — see Who's on", with the sheet one tap away. It says what it knows and nothing more.
- **The header select demotes, never hides**: locked gatherings sit in an `<optgroup>` labelled
  "Not yours" at the foot, with a lock, and choosing one opens the "Who's on" sheet in place
  (P6) — who can add you, and the ask — rather than a page, so the night being worked is never
  unmounted. A demoted option **never changes the select's value**: it fires the sheet and the
  select goes on reading the night being worked, because a select reading "Sunday School" over a
  Friday roster for even a moment is the one mistake the app is built around.

### P16 — Housekeeping the seams

`Suspended`, `(you)` and the raw role strings in the sheet and the locked page are translated
alongside `'Everyone'`; the catch-up tail's locked page knows the errand it was reached with ("You
came to take last Friday's register; you are not on this gathering"); the core member demoted
mid-edit reads "This was open to you a minute ago — your role changed" when the profile stream
just changed it, not "Core team only".

### P17 — One mailbox, one key (A1, C1)

Gmail ignores dots in the local part, treats a `+tag` as an alias of the same mailbox, and treats
`googlemail.com` as `gmail.com`. Google's token carries the address as the account registered it,
and `emailKey` matched exactly, so `josmith@gmail.com` typed on Tuesday failed `jo.smith@gmail.com`
signing in on Sunday. That is a documented property of consumer Gmail, not a guess; for every other
domain — Google Workspace included — dots are significant, and a rule that merged them would merge
two real staff.

So `emailKey` gains a canonical form **for `gmail.com` and `googlemail.com` only**: lowercase,
dots and `+tag` stripped from the local part, the domain mapped to `gmail.com`; every other domain
is lowercased and nothing else. It applies everywhere the app asks "is this address already on the
team", which round 6 found is more than two call sites — the invitation's document id, the sign-in
lookup, the Team screen's pending filter, the "already has access" guard, and the Arrived tail —
because a plain `toLowerCase()` compare anywhere would re-open the exact bug the pending filter's
own docstring was written about. The Team screen shows the address as typed. For invitations
written before the change, the sign-in lookup tries the legacy exact key and, on a hit, moves the
document to its canonical key, and the pending list dedupes on the canonical form so one mailbox
never shows as two live rows.

---

## 5. What this proposal will not build, and why

- **Delete a person.** Orphans attribution on every register; re-provisions from the stale
  invitation at the old rank. Fold instead (P12).
- **Delete a kiosk's device row.** Same argument, for a custody record: retiring marks the row
  (P11), and there is no sweep.
- **Multi-use invite links, or links that grant more than counselor.** A link that works twice is
  a password to the children's roster pasted in a group chat; a link that grants core opens the
  register and Settings to whoever a screenshot reaches. Written down here so neither is added
  later as a convenience.
- **Keeping refused sign-in attempts.** Dropped (P3); the link and the canonical key remove the
  need, and Tally holds nothing about people who never got in.
- **An `eventAccess` cleanup job, or orphan-ACL tidying.** Read-time filtering (P6, P7) is the
  fix; membership survives suspension so un-suspending restores it.
- **Shared-account support.** One sentence where the mistake is made (P2); the supported answer
  to "a device several people use" is the kiosk.
- **Email or push from Tally.** A link the inviter shares however they already share things
  (P2); an ask that is a row on a screen the right people already hold (P7), never a notification.
- **A held check-in queue for locked gatherings.** P7, declined, with the volunteer's agreement.
- **Machinery for losing access mid-shift.** The guard on Remove, the `lastChange` map, the
  captured count, the `checkAccess` callable and its burst rule, the kiosk's lost-identity phase
  (P8, P11, P15): the owner judged the class too rare to design for, and round 6 found nothing
  broken by leaving it plain.
- **A general activity feed.** Three stamps on the profile (P9) answer the safeguarding question
  that can honestly be answered.
- **Per-gathering membership history.** The claim is narrowed instead (P9).
- **Address normalisation beyond Gmail's own rules.** P17 canonicalises only what Gmail itself
  treats as one mailbox.
- **Naming admins on the refusal screen.** P1; the director's decision.
- **A presence signal beyond `lastSeenAt`.** P8; a listener on every phone on every screen.
- **A permanent lane on the roster for the ask, or a sticky toast kind in the provider.** P7.

---

## 6. Sequencing

1. **Correctness and copy, no new surfaces.** P1; P11 (the kiosk's own identity, the device row,
   the refused-write re-read, the migration sentence, the demoted chooser); P13; P14; P17; the
   filtering of suspended members in P6 and P7; P15's optgroup, sheet-in-place, banner sentence and
   three-refusals banner.
2. **The invitation as a hand-off.** P2 (links, QR, the join page), P4, P5.
3. **The Team screen answers for people.** P9 with its backfill, P10, P12, the find field, the
   only-admin line.
4. **The door.** P7's ask, P8's copy, P16.

---

## 7. The owner's review, and what it changed

After the loop converged the owner read the proposal and asked four things. They were put to the
same three consultants as a sixth round, with the proposed answers; the round returned two majors
(both in the new shapes, both folded in above) and fourteen minors, and nothing that reopened the
sixteen changes.

| question | answer, in one sentence | what it changed |
| --- | --- | --- |
| Losing access mid-shift is unlikely; keep it just-not-broken | The live stream already flips the page; keep the copy honest and drop the machinery | P8 reduced to copy; `checkAccess`, held refusals, the kiosk's lost-identity phase and its debounce dropped (P15, P11); a three-refusals banner is the cheap remainder |
| Gmail ignores dots — how should Tally handle that? | Canonicalise for `gmail.com`/`googlemail.com` only, everywhere the app compares addresses | New P17; P3 no longer needed |
| How can onboarding be easier — link, QR? | Single-use links and same-room QRs, counselor-only, named on the row, with the account confirmed before the token is spent | P2 rewritten; P3 dropped; P5 gains the redemption |
| Must kiosk authorisation be tied to a person? | No — a kiosk is a room; it holds its own identity, its reach is the room it stands in, retiring marks the row | P11 rewritten; P9 loses its kiosk clause; P10's kiosk list gains live state and an armed Retire |

The director's four earlier decisions stand where they still apply: core may invite counselors
(P4); the refusal screen does not name admins (P1); the kiosk service identity, recorded then as a
direction, is now built (P11). The one on keeping refused attempts is moot (P3).

Two things the round asked for that are worth repeating to whoever implements this: the invite
link's safety rests on the redeemer being named to the minter, so a redeemed invitation is an
audit record and never deletable; and a kiosk must notice retirement on the refused write, not on
a timer, or five minutes of a nursery morning go green with nothing recorded.

And one the loop could not settle because it is a matter of taste rather than journey: the chip's
exact words (**Who's on · 3**), the join page, and the ask toast's shape are the things here that a
rendered-frame round — `uxr-visual-critic` and `uxr-design-critic` over the real screens — should
look at as they are built.

---

## 8. The rendered-frame round

Section 7 closed by naming what the paper could not settle — the chip's exact words, the join page,
the ask's shape — and handing them to a round over real screens. That round has now run:
`e2e/access-walkthrough.spec.ts` photographs thirteen states from the live app against the
emulators, and `uxr-visual-critic` and `uxr-design-critic` read the desktop and phone frames once
each.

What the frames caught that the paper could not:

**Two things the screen was saying that were not true.** The QR's caption promised ten minutes
under a fortnight-long link, because *Show QR* on a link draws that link and only the row's **QR**
button re-mints; the sentence is now the lifetime's rather than the square's. And a ten-minute
token's header read "Good until in 10 minutes", a relative time poured into an absolute sentence.

**Three acts that were one tap.** *Clear* on an ask sat thirteen unbordered pixels from *Add*, and
writes the one thing the design went out of its way to avoid saying by accident — that somebody
looked and said no. **Everyone on the team** sat eight pixels above the option a thumb aims at to
leave things alone, and threw a gathering's whole list away, on every gathering in the repeat, with
no undo. Both are armed now, in the shape P9 already established. The third was quieter: a
one-field form whose keyboard **Go** key minted a link with no gathering ticked, silently, on the
screen where the ticks sit at the keyboard line — the form now says what an untouched fieldset
means before the press rather than after the weekend.

**Two places a value was unreadable.** The link truncated mid-token against its own right edge,
with no ellipsis, on the one screen in the app that says out loud the value can never be shown
again; it wraps now. And the gathering select on the roster header collapsed to "S." at 390px,
because the row was held to one line unconditionally — a second line at a width is cheaper than a
control with no label.

**One thing that was said as if it were furniture.** "Your name is on the Add list." was one grey
line set exactly like the directory of people above it — no date, nobody named, nothing to separate
the reader's own outcome from a list about other people. It now says when, who will see it and
where, and that nothing is queued.

Two findings were answered by re-shooting rather than by changing the app: the fence chapter was
photographed from somebody who is on every gathering, so the step titled "the ones that are not
yours" contained none; and the pending list was shot with the phone's disclosure shut. One was
answered by a wider window: the member row is a container query that lays out as a table above
672px of card, which a 1280px capture never reached, so the desktop frames are taken at 1440×900.

One finding is recorded and not acted on. At 1280×720 the Team screen's 60/40 split cannot give the
member list the 672px its row layout needs *and* leave the invitation column room — the two columns
want roughly 1,060px between them and have 992. Narrowing the rail makes the overflowing column
worse; stacking puts eleven members between an admin and the invitations they came for. It wants a
layout decision rather than a fraction, and taking one in the last hour of this campaign would be
the wrong time to make it.

### Round two

The re-shot frames went back to the same four critics. What round one had not been able to see
— because it was reading a 1280px capture, a fence photographed from somebody who is on every
gathering, and a spinner captioned as a refusal — round two could.

**The sentence that was wrong in the other direction.** Section 5 records a deliberate decision
that the suspension's computed consequence carries no kiosk clause: a kiosk holds its own identity,
so suspending whoever paired the lobby tablet stops nothing, and the sentence that used to say
otherwise was frightening people out of a correct act. The opening clause still read *on every
device* — and in the frame it sits sixty pixels above a panel saying the hall tablet is recording
right now. An admin who believes it walks away from a kiosk that goes on filing attendance. It
says *on every phone they have signed in on*, which is what it does.

**The sheet did not lead with the ask.** P6 says it does, and the walkthrough caption says it does,
and it was third — under a scope switch that throws a gathering's list away — with an empty
directory search below it wearing an autofocus ring brighter than the primary action. The ask is
first now, `Modal` takes an opt-out on the focus, *Add* and *Clear* sit at opposite edges of the
card rather than seven pixels apart in the middle of thumb territory, and the widening confirm
renders under both options instead of between them, where it moved the safe one out from under a
thumb already travelling.

**Two things said where nobody could read them.** The QR's lifetime sentence sat under the square,
and on a phone the square's bottom edge lands on the tab bar — so the line distinguishing a
ten-minute code from a fortnight-long credential was never on screen while somebody was holding the
phone out. It is above the square now, and the square is a step smaller. And the invite form's
"nothing ticked" line sits under the keyboard while the form's one field has focus, on a form whose
submit is the keyboard's own **Go** key: the minted panel now restates what the link grants, where
it cannot be missed and before the link has been sent.

**The locked row on the chooser was the least interactive-looking thing on the screen** — no
surface, no chevron, on a rail of carded history rows — which is a strange way to draw the one item
that opens the page that can help.

Smaller, and all of a piece: the role select stops spending brand on a value, so brand goes on
meaning *you can press this*; *Retire* matches the *Add* above it at thumb height; the still-to-do
badge stops wrapping mid-phrase; *Change* moves off the chip that opens a sheet; the locked card's
two sentences come in to a readable measure; and the join screen's button says the act while the
paragraph above it goes on carrying the reassurance.

Four things are recorded and not acted on, all of them layout decisions larger than this campaign:
the Team screen's 60/40 split, which at 1440 gives the member table the 672px its row layout needs
and leaves the invitation rail overflowing beside a quarter-screen of empty page; the roster's two
*Regulars* counts, 17 in the filter chip and 27 in the section heading, which are both correct as
implemented and contradictory as read; the roster grid's column gutter equalling its row gap, which
makes a column-major list read as rows; and the amber budget in the roster header, where a status
chip, a closed-window sentence and the asking dot share one accent.

### Round three

The third pass was a verdict rather than a quota: the critics were asked to say whether each journey
can be completed on its frame, and to report only what was blocking, major, or a round-two fix that
had not landed. Three of the four returned the same blocker, and it was not a design question.

**The app was showing a reader its own source.** A `/* … */` in JSX *children* position is not a
comment — React renders it as text — and the note explaining why the locked chooser row deserves a
surface and a chevron was drawn as body copy on the screen a stranded volunteer lands on. On a phone
it was the entire fold below the divider, so the row it was written about, and the name of the person
who can add them, were pushed off the screen. It is now braced, and `eslint.config.js` carries a
`no-restricted-syntax` selector so that a block comment in JSX children fails the lint rather than
shipping.

Three rounds of critique read past it — which is the honest reason the guard is in the lint rather
than in a reviewer's head.

**One round-two fix had displaced its own problem.** Moving the QR's lifetime sentence above the
square made the sentence readable and pushed the square's bottom third under the tab bar — so the
thing being held out to somebody was a code missing a finder pattern, which will not decode. The
panel now scrolls the square into view when it draws, which is the right lever: 192px is already
near the floor for a camera at conversational distance.

Two minors were taken because they were cheap: the `62ch` cap set at 79 characters against lowercase
running text rather than the 65 it was meant to buy, and the role select was still marking elevation
by reweighting one of four identical controls — first in brand, then in contrast. The select says
"Core team"; the word is the mark.

With those, the set is converged: every frame's journey can be completed on it, and what remains is
queued minors and the four layout decisions recorded above.
