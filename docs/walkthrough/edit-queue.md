# A profile edit, from the button to the church database — a walkthrough

Twenty-seven frames of the six journeys in [the brief](../../uxr/JOURNEY-profile-sync.md)
and every state in [profile-edits.md](../profile-edits.md), on both layouts and in
all three backend configurations, [as a single page](edit-queue.html).

> Kept here rather than inside `edit-queue/` on purpose: that directory is the
> frames, and clearing it before a capture is routine. This file was deleted by
> exactly that twice before it moved.

Every frame is the running application: the real components, real Firestore
(emulated), the real callables, and the real Planning Center client talking to
the simulator in `tools/pco-simulator/`. Nothing here is a mock-up, and no state
is posed — each one is arrived at by doing the thing that causes it.

## How the timing was arranged

Most of these states last a second or two, which is the whole reason the design
exists and the whole reason they are hard to photograph. The levers that hold
one still long enough for a shutter:

| lever | what it holds | states |
| --- | --- | --- |
| `takeEditLease(studentId)` | the student, so no worker may claim the job | `queued` |
| `/_sim/hold` on the simulator | the HTTP request itself, mid-flight | `sending` |
| `planningCenter.fail` | what the far end answers, and how often | `refused`, `unreachable` |
| `burySimulatorPerson` | a person deleted or merged upstream, behind Tally's back | `merged`, `no upstream record` |
| a seeded document | a clock, where the state *is* a clock | `waiting`, `still sending` |

Nothing is stubbed inside the app to make a frame appear. The `sending` shot is a
worker genuinely blocked on a `PATCH` that the simulator is refusing to answer
until the test says so; releasing the gate lets the same job carry on and land.

Two states are seeded rather than provoked, and their captions say so. `waiting`
and `still sending` are both defined by a *clock* — a backoff that has not
expired, a send that started two minutes ago — so provoking them honestly would
mean holding a request open for minutes. (A 429's `Retry-After` is honoured
*inside* the request, so arming a rate limit produces a long `sending`, not a
`waiting`.) Both are real documents that the real screen reads; what is arranged
is the time on them, not the meaning. Everything else is caused.

## All three deployment shapes

A church is in exactly one of them, and only two of them are settings.

| shape | how it is arranged |
| --- | --- |
| Planning Center only | the default: no `config/attendees32` document |
| both connected | the app's own Attendees switch, as a leader would use it |
| Attendees, no Planning Center | a second emulator, plus `functions/.env.local` |

The third is not a setting. There is deliberately no in-app switch for Planning
Center — which backends exist is decided by the credentials a deployment holds
— so a church that never connected it simply has no `PCO_APP_ID`. Two things
that look like they would arrange that do not: starting the emulator without
those variables changes nothing, because they come from
`functions/.env.demo-tally`; and setting them to empty strings in the
environment changes nothing either, because the file wins over the environment.
What works is `functions/.env.local`, which the CLI loads last and which is
git-ignored, so the override can never be committed by accident. The capture
script writes it, runs that pass, and removes it in a `finally`.

## Both layouts

Captured twice, by two Playwright projects, into two manifests that the build
merges. A phone is not a narrow laptop here: the roster row is a 64px card whose
job mark is the word alone, the strip stacks into full-width targets, and the
corridor — no signal, phone in hand — is the case the whole queue was built for
and cannot be photographed anywhere else.

## Regenerating

```bash
npm run walkthrough:edit-queue          # all four passes, then build both pages
```

It runs the Planning Center laptop and phone passes, the both-connected pass,
and then — after swapping the deployment underneath it — the Attendees-only
pass, and builds the file version and the publishable one from whatever
manifests exist. Any subset builds; the page simply has fewer sections.

The capture drives the queue through `drainStudentEdits` — the same callable the
browser fires after a save — rather than waiting on a schedule, so it produces
the same frames however the environment is paced.
