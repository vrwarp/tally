# The scene: `kiosk-setup`, and the journey it has to serve

A companion to `BRIEF.md`, for one scene only. Read both.

## The moment

**Friday, 6:40pm.** Dana is the first person in the building. She carries the
lobby iPad out of the cupboard, wedges it into the stand by the door, and opens
Tally on it. The iPad shows six characters, 96px tall, and one sentence:

> A leader enters this code in Tally under **Settings → Pair a kiosk**.

Doors open at seven. She has her phone in her other hand.

Nothing about this moment is leisurely, and nothing about it is annual either —
a kiosk is re-paired every time the iPad is wiped, replaced, restored, handed to
a different campus, or installed to the home screen on iOS, which gives the
installed app its own storage and therefore its own second pairing.

## Who is standing there

Not always Dana. The person who arrives first is whoever arrives first, and on
most Fridays that is a counselor — the role that exists precisely because
somebody has to be at the door early. The kiosk's own screen tells them to open
*Settings → Pair a kiosk*.

## What the app does with that today

| # | Step | What it costs |
| --- | --- | --- |
| 1 | Tap the account chip | Top-right corner of a 390px phone — the one place a thumb does not reach |
| 2 | Tap **Settings** | Only appears for core team and admins |
| 3 | Wait for Settings | It is a lazy chunk behind two live Firestore reads |
| 4 | Scroll past **Predictive roster** | Four steppers and a live preview panel |
| 5 | Scroll past **Appearance** | A colour picker |
| 6 | Read the **Check-in kiosk** paragraph | Four lines of prose, on a phone |
| 7 | Tap **Pair a kiosk** | An underlined phrase *inside a sentence*, mid-paragraph |
| 8 | Second screen: type the code, approve | The only step that is the job |

Seven steps of furniture in front of one step of work, and the seventh is a
text link with a ~20px hit box wedged between two other lines of text.

### And for a counselor, step 2 does not exist

`RequireRole role="core"` guards `/settings`, and the account menu only renders
**Team** and **Settings** when `can('core')`. `/pair-kiosk` itself is open to any
active member — deliberately, and the callable behind it agrees — but **nothing
in the app links to it for a counselor**. The one screen that tells them to go
there is the kiosk's, and the instruction it gives them names a screen they
cannot open.

A counselor's only route to a kiosk that is asking to be paired is to type a URL
nobody has told them, or to phone an admin. At 6:40pm on a Friday, that is the
end of the journey.

## The job, stated plainly

> **Get from anywhere in Tally to a field that accepts six characters, on a
> phone, in one hand, in under fifteen seconds — whoever you are.**

And then, because the same person will be back here when it goes wrong:

> **Find out why a kiosk that has a code is not signing itself in.**

That second job is a core-team job — the answer is a project IAM grant — and it
currently lives on a different screen from the first one, which is the screen
the kiosk's own error message points at.

## What must not change

Beyond `BRIEF.md`'s list:

- **Any active member may pair a kiosk.** This is a product decision with a
  reason: the person setting up the lobby screen on a Friday evening is a
  counselor. The screen may show a counselor *less*, but it must not refuse them
  the code field.
- **The diagnostics stay core-team.** `getKioskStatus` reports on project
  configuration and is guarded by `requireCoreTeam` on the server. A counselor
  must not be shown a call that will be refused.
- **Nothing here may claim a kiosk is healthy.** The status answers one
  question — can this deployment sign kiosk tokens — and it must not be dressed
  up as "the lobby screen is fine".

## The scenes

| id | who | the job |
| --- | --- | --- |
| `kiosk-menu` | admin | Find where kiosks live at all, from any screen in the app. |
| `kiosk-setup` | admin | Type six characters off a screen across the room and know it landed. |
| `kiosk-setup-counselor` | counselor | The same, for the person who is actually holding the iPad — no rail, no core-team controls. |
| `kiosk-setup-denied` | admin | The kiosk has a code and will not pair: find out why, and get the fix. |
