# A profile edit, from the button to the church database — a walkthrough

Eleven frames of the queue in [profile-edits.md](../../profile-edits.md), one per
state a leader can find themselves looking at, [as a single page](../edit-queue.html).

Every frame is the running application: the real components, real Firestore
(emulated), the real callables, and the real Planning Center client talking to
the simulator in `tools/pco-simulator/`. Nothing here is a mock-up, and no state
is posed — each one is arrived at by doing the thing that causes it.

## How the timing was arranged

Most of these states last a second or two, which is the whole reason the design
exists and the whole reason they are hard to photograph. Three levers hold each
one still long enough for a shutter:

| lever | what it holds | states |
| --- | --- | --- |
| `takeEditLease(studentId)` | the student, so no worker may claim the job | `queued` |
| `/_sim/hold` on the simulator | the HTTP request itself, mid-flight | `sending` |
| `planningCenter.fail` / `rateLimit` | what the far end answers, and how often | `waiting`, `refused`, `unreachable` |

Nothing is stubbed inside the app to make a frame appear. The `sending` shot is a
worker genuinely blocked on a `PATCH` that the simulator is refusing to answer
until the test says so; releasing the gate lets the same job carry on and land.

## Regenerating

```bash
npm run walkthrough:edit-queue          # capture, then build the page
```

The capture drives the queue through `drainUpstreamEditsNow` — the callable twin
of the scheduled sweep — rather than waiting on `onUpstreamEditCreated`, so it
produces the same eleven frames whether or not the trigger is registered in the
environment it runs in.
