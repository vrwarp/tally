/**
 * One card per question the Review screen asks, and per way it can be answered.
 *
 * The corrections harness next door (`../review-live/`) holds a single family
 * wrong in every way a real one is wrong, because its subject is a *sequence* —
 * one card corrected step by step. This one's subject is a *set*: three
 * questions the card asks about every family, and the handful of shapes each
 * answer comes in. So each journey is its own registration, arranged so the
 * thing worth looking at is the only thing that differs between it and the one
 * before.
 *
 * Every fixture is the real payload shape. The card reads
 * `upstreamCandidates`, `households` and `linkedTo` from the callable, and a
 * fixture that invented a friendlier shape would be a walkthrough of a screen
 * that does not exist.
 */
import type {
  AdultCandidate,
  PendingRegistration,
  PendingRegistrationChild,
  ReviewStudentSummary,
  StudentCandidate,
} from '@/services/functions';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Anchored to the clock rather than to a date: the card prints "Registered 2
 * days ago" and counts down to the sweep, and a fixture pinned to a fixed
 * evening drifts into a state no ministry would ever see.
 */
const now = Date.now();

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

function child(overrides: Partial<PendingRegistrationChild> = {}): PendingRegistrationChild {
  return {
    firstName: 'Michael',
    lastName: 'Lee',
    grade: 8,
    studentId: 'held-1',
    pendingReview: true,
    mergedIntoStudentId: null,
    mergedInto: null,
    allergies: null,
    possibleDuplicates: [],
    upstreamCandidates: [],
    upstreamPersonId: null,
    linkedTo: null,
    typedAs: null,
    ...overrides,
  };
}

function registration(overrides: Partial<PendingRegistration> = {}): PendingRegistration {
  return {
    registrationId: 'reg',
    source: 'kiosk',
    eventId: 'friday-today',
    registeredAt: now - 2 * DAY,
    expiresInMs: 28 * DAY,
    guardian: { firstName: 'Dana', lastName: 'Lee', phone: '5550103344' },
    typedGuardianName: null,
    phoneCorrected: false,
    last4: '3344',
    children: [child()],
    anchors: [],
    guardianCandidates: [],
    sameFamily: [],
    settled: false,
    lastError: null,
    lastErrorKind: null,
    ...overrides,
  };
}

/** The roster row a merge would fold into — Tally's own document. */
const ROSTER_MICHAEL: ReviewStudentSummary = {
  studentId: 'pco_4471',
  firstName: 'Michael',
  lastName: 'Lee',
  grade: 8,
  known: true,
  status: 'active',
  sharesFamilyDigits: true,
};

const ROSTER_MICHAEL_OTHER: ReviewStudentSummary = {
  studentId: 'pco_5512',
  firstName: 'Michael',
  lastName: 'Lee',
  grade: 7,
  known: true,
  status: 'active',
  sharesFamilyDigits: false,
};

/** Somebody the church has and Tally's roster does not. */
function upstream(overrides: Partial<StudentCandidate> = {}): StudentCandidate {
  return { personId: '901', name: 'Michael Lee', grade: 8, wouldMatch: true, ...overrides };
}

function adult(overrides: Partial<AdultCandidate> = {}): AdultCandidate {
  return {
    personId: '700',
    name: 'Dana Lee',
    reachable: true,
    corroborated: true,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* The journeys                                                                */
/* -------------------------------------------------------------------------- */

export interface Journey {
  id: string;
  question: 'adult' | 'child' | 'household' | 'corrections' | 'together';
  title: string;
  /** What a reviewer is looking at, in one line. */
  situation: string;
  /** What the screen did before this work. */
  before: string;
  /** What it does now, and why that is the right answer. */
  now: string;
  /** Anything worth trying with the mouse. */
  tryIt?: string;
  row: PendingRegistration;
}

export const JOURNEYS: Journey[] = [
  /* ---- Q1: who is the adult? -------------------------------------------- */
  {
    id: 'adult-new',
    question: 'adult',
    title: 'A family nobody has met',
    situation:
      'Dana Lee registered her son at the lobby kiosk on Friday. The church has never heard of either of them.',
    before:
      'Approving created a person and a household. Correct, and the card said nothing about it either way.',
    now:
      'Still correct, and still silent — deliberately. An empty candidate list is “we did not find out”, not “she is new”, so the card claims nothing and the caption promises nothing. This is the baseline every other journey should be read against.',
    row: registration({ registrationId: 'adult-new' }),
  },
  {
    id: 'adult-corroborated',
    question: 'adult',
    title: 'She is already on file, under the number she typed',
    situation:
      'A second child, two years after the first. Planning Center already has Dana Lee, and the mobile she typed at the kiosk is the one on her record.',
    before:
      'The backend joined her — correctly — and the card never mentioned that a decision was being made. A reviewer pressed Approve and found out afterwards, from the church’s database.',
    now:
      'She is pre-selected, because that is exactly what the push was going to do anyway. The caption under the button names her and says *why*: “whose number matches”. Pressing nothing agrees; the id is still sent, so if she is merged away between now and the press the backend refuses rather than inventing a second Dana.',
    tryIt: 'Press “Approve and add” to read the sentence the reviewer is agreeing to.',
    row: registration({
      registrationId: 'adult-corroborated',
      guardianCandidates: [adult()],
    }),
  },
  {
    id: 'adult-new-number',
    question: 'adult',
    title: 'She changed her number last year',
    situation:
      'The church has Dana Lee. The mobile on her record is the one she had before she switched carriers, so nothing corroborates the name.',
    before:
      'Unreachable. No amount of matching gets to “yes, that is her, she has a new phone” — so the backend created a **second** Dana Lee, and a household to go with her.',
    now:
      'The default is honest about itself: “Add as new” sits selected, because that is what would happen unaided. The candidate is offered beside it with the evidence stated plainly — “a different number on file” — and one press turns the guess into a decision no rule could have reached.',
    tryIt: 'Press “Same person”, then “Approve and add”, and watch the caption change from “is added as a new person” to “joins Dana Lee, who the church already has”.',
    row: registration({
      registrationId: 'adult-new-number',
      guardianCandidates: [adult({ corroborated: false })],
    }),
  },
  {
    id: 'adult-ambiguous',
    question: 'adult',
    title: 'Two Dana Lees, and both hold that number',
    situation:
      'A shared family mobile, on file against mother and daughter both. The name matches twice and the number matches twice.',
    before:
      'The rule is “exactly one corroborated match”. Two is not one, so it fell through and created a **third** Dana Lee — silently, on a screen that showed no chooser at all.',
    now:
      'The bad default is in front of the reviewer before the press, not behind it. “Add as new” is selected and says so, both candidates are listed with their evidence, and a single press settles which of them it actually is.',
    tryIt: 'Notice that neither candidate is pre-selected — the screen will not pick between them, and it no longer pretends there was nothing to pick.',
    row: registration({
      registrationId: 'adult-ambiguous',
      guardianCandidates: [
        adult({ personId: '700', name: 'Dana Lee' }),
        adult({ personId: '701', name: 'Dana Lee' }),
      ],
    }),
  },

  /* ---- Q2: who is the child? -------------------------------------------- */
  {
    id: 'child-roster',
    question: 'child',
    title: 'That name is already on Tally’s roster',
    situation:
      'Michael Lee was registered at the door. Two Michael Lees are already on the roster — one in 8th grade who answers to this family’s phone digits, one in 7th who does not.',
    before:
      'This much already worked: the candidates are the comparison, so they are on screen before anybody presses anything, and the approve button is held until somebody answers.',
    now:
      'Unchanged in behaviour, and now under a heading that says what is being asked — **Who is Michael?** — because the same block has a second group underneath it whenever the church knows somebody the roster does not.',
    tryIt: 'Choose a row. The merge goes to the server immediately and can be undone; the approve button releases.',
    row: registration({
      registrationId: 'child-roster',
      children: [child({ possibleDuplicates: [ROSTER_MICHAEL, ROSTER_MICHAEL_OTHER] })],
    }),
  },
  {
    id: 'child-upstream',
    question: 'child',
    title: 'The church has him. Tally’s roster does not',
    situation:
      'Michael is in the church’s database already — a sibling of somebody, or a child whose grade sits outside the band Tally pulls. Nothing on Tally’s roster shares his name.',
    before:
      '**Invisible.** The duplicate scan reads Tally’s students only, so the card looked clean and the approve button was live. The push then found him by name and grade and linked to him anyway, silently — and the reviewer’s “this child is new” never reached the server at all.',
    now:
      'He is offered under his own heading, pre-selected, because he is what the push was going to link to. One candidate is not ambiguity, so the button is not held — the screen states the answer rather than demanding one.',
    tryIt: 'Press “None of them — Michael is new” to override it; that now genuinely suppresses the backend’s own match instead of only unlocking the button.',
    row: registration({
      registrationId: 'child-upstream',
      children: [child({ upstreamCandidates: [upstream()] })],
    }),
  },
  {
    id: 'child-ambiguous',
    question: 'child',
    title: 'Two children, one name, one grade',
    situation:
      'The church has two Michael Lees in 8th grade. Neither is on Tally’s roster.',
    before:
      'Lowest id won. A new visitor could be filed onto a stranger’s record — inheriting their household, their allergies and their parent’s phone number — and nothing anywhere said a choice had been made.',
    now:
      'The approve button is **held**. This is the one case where the rule was a coin toss, so the screen stops and asks. Neither is pre-selected; the reviewer picks, or says he is new.',
    tryIt: 'Try pressing “Approve and add” — it is disabled, and the caption above it says whose row is holding it.',
    row: registration({
      registrationId: 'child-ambiguous',
      children: [
        child({
          upstreamCandidates: [
            upstream({ personId: '901', wouldMatch: true }),
            upstream({ personId: '902', wouldMatch: false }),
          ],
        }),
      ],
    }),
  },
  {
    id: 'child-linked',
    question: 'child',
    title: 'A counselor took the parent’s details at the door',
    situation:
      'Michael was quick-added at the door on Friday and pushed upstream by the ordinary trigger minutes later. Only the adult is waiting on a decision.',
    before:
      'The card showed a child with no question attached and no explanation — it looked like a screen that had never asked.',
    now:
      'It reports what happened while nobody was looking: “Linked automatically to Michael Lee in the church’s database.” No control, because there is nothing left to decide — but no silence either.',
    row: registration({
      registrationId: 'child-linked',
      source: 'counselor',
      children: [
        child({
          pendingReview: false,
          upstreamPersonId: '901',
          linkedTo: { personId: '901', name: 'Michael Lee' },
        }),
      ],
      guardianCandidates: [adult()],
    }),
  },

  /* ---- Q3: which family? ------------------------------------------------ */
  {
    id: 'household-two',
    question: 'household',
    title: 'Dana heads two families, and both are called “Lee Household”',
    situation:
      'A household built twice over the same adult — the residue of a bug since fixed, and the shape any second registration used to leave behind.',
    before:
      'The child went into whichever household had the lower id. Deterministic, arbitrary from where the reviewer sits, and unsaid: the result message read “Put the child in Dana Lee’s household”, singular, naming neither.',
    now:
      'A picker, drawn only because there is genuinely something to choose. The oldest is pre-selected — the same one the rule would have taken — and each is named **by its members**, because Planning Center calls both of them the same thing.',
    tryIt: 'Pick the other family, or start a new one entirely — an answer no rule could reach.',
    row: registration({
      registrationId: 'household-two',
      guardianCandidates: [
        adult({
          households: [
            { id: '10', name: 'Lee Household', memberNames: ['Ada Lee', 'Bo Lee'] },
            { id: '11', name: 'Lee Household', memberNames: ['Cy Lee'] },
          ],
        }),
      ],
    }),
  },
  {
    id: 'household-anchor',
    question: 'household',
    title: 'The family named a sibling the church already has',
    situation:
      'Dana said on the kiosk form that Ada is already at this church. Ada’s household is the family’s real one.',
    before: 'The sibling’s household was joined and no second one invented — this already worked.',
    now:
      'And **no picker is drawn**, even though Dana heads two households. The backend files the child into the sibling’s family and returns before the household is ever chosen, so a control here would be offering a decision that is not taken. Absence is the honest answer.',
    row: registration({
      registrationId: 'household-anchor',
      anchors: [
        {
          studentId: 'pco_9',
          firstName: 'Ada',
          lastName: 'Lee',
          grade: 10,
          known: true,
          status: 'active',
          sharesFamilyDigits: true,
        },
      ],
      guardianCandidates: [
        adult({
          households: [
            { id: '10', name: 'Lee Household', memberNames: ['Ada Lee'] },
            { id: '11', name: 'Lee Household', memberNames: ['Cy Lee'] },
          ],
        }),
      ],
    }),
  },

  /* ---- Where the questions collide -------------------------------------- */
  {
    id: 'together',
    question: 'together',
    title: 'All three at once — and the one that can undo the others',
    situation:
      'A returning family: the adult is on file, one child collides with the roster, another is somebody only the church knows, and Dana heads two households.',
    before:
      'One question of the three was asked. The other two were decided by rules, elsewhere, after the press.',
    now:
      'Every decision is on one card, in dependency order, each pre-selected with what would have happened anyway. And the caption at the bottom names the interaction nobody could see coming: **linking a child to somebody the church already has can discard the adult and household answers entirely**, because the backend refuses to add a second adult to a family that has one.',
    tryIt:
      'Answer the held child, then read the sentence above “Approve and add”. It names every consequence of the press in one breath.',
    row: registration({
      registrationId: 'together',
      children: [
        child({
          studentId: 'held-1',
          firstName: 'Michael',
          possibleDuplicates: [ROSTER_MICHAEL],
        }),
        child({
          studentId: 'held-2',
          firstName: 'Bo',
          grade: 6,
          upstreamCandidates: [upstream({ personId: '905', name: 'Bo Lee', grade: 6 })],
        }),
      ],
      guardianCandidates: [
        adult({
          households: [
            { id: '10', name: 'Lee Household', memberNames: ['Ada Lee'] },
            { id: '11', name: 'Lee Household', memberNames: ['Cy Lee'] },
          ],
        }),
      ],
    }),
  },

  /* ---- Corrections: the operation that invalidates the answers ----------- */
  {
    id: 'corrections',
    question: 'corrections',
    title: 'A correction changes the evidence the answers were made against',
    situation:
      'The parent misspelled her own son on a glass keyboard: “Micheal”. The door’s duplicate scan matched on the name as typed and found nobody, so the card looks clean.',
    before:
      'Approving wrote the misspelling into a database with no delete. The only alternative was “Not ours”, which loses a real family.',
    now:
      'Correcting re-asks the roster in the same breath — and the corrected spelling collides with a child the church already has, so the card comes back with the candidate offered and the approve button held. A correction is also the one thing that **drops the answers above it**: they were made against a name and a number that have just changed.',
    tryIt:
      'Press Edit on the child, change “Micheal” to “Michael”, and save. The collision the fix created appears, and the approve button shuts.',
    row: registration({
      registrationId: 'corrections',
      guardian: { firstName: 'MOM', lastName: 'Lee', phone: '5550163344' },
      last4: '3344',
      children: [child({ firstName: 'Micheal', grade: 5 })],
      guardianCandidates: [adult({ corroborated: false, name: 'Dana Lee' })],
    }),
  },
];

/** The roster this harness's fake scan knows about, for the corrections journey. */
export const SCAN_TARGET = ROSTER_MICHAEL;
