/**
 * Every Firestore path Tally writes, spelled out once.
 *
 * These strings are not an implementation detail. `firestore.rules` matches on
 * the same collection names, the Cloud Functions address the same documents
 * through the Admin SDK, and `firestore.indexes.json` names them again — none
 * of which this module can import or be imported by. So the only thing keeping
 * four copies of "eventAccess" honest is that a change here fails a test that
 * states the string, and the failure is the prompt to go and change the other
 * three.
 *
 * Asserted literally rather than composed from `COLLECTIONS`, for that reason:
 * a test written as `${COLLECTIONS.events}/e1` passes no matter what the
 * constant says, which is exactly the drift it would need to catch.
 */
import { describe, expect, it } from 'vitest';
import {
  A32_CONFIG_DOC_ID,
  BACKENDS_CONFIG_DOC_ID,
  COLLECTIONS,
  PCO_CONFIG_DOC_ID,
  SERIES_IDS,
  SETTINGS_DOC_ID,
  paths,
} from '@/lib/paths';

describe('the collection names', () => {
  it('are the ones firestore.rules matches on', () => {
    expect(COLLECTIONS).toEqual({
      users: 'users',
      invitations: 'invitations',
      eventSeries: 'eventSeries',
      students: 'students',
      events: 'events',
      config: 'config',
      skippedNights: 'skippedNights',
      upstreamEdits: 'upstreamEdits',
      eventAccess: 'eventAccess',
      transitions: 'transitions',
      attendance: 'attendance',
      rsvps: 'rsvps',
    });
  });

  it('names the config documents the functions read on every callable', () => {
    expect(SETTINGS_DOC_ID).toBe('settings');
    expect(PCO_CONFIG_DOC_ID).toBe('planningCenter');
    expect(A32_CONFIG_DOC_ID).toBe('attendees32');
    expect(BACKENDS_CONFIG_DOC_ID).toBe('backends');
  });

  it('names the two series the seed script writes', () => {
    expect(SERIES_IDS).toEqual({
      fridayFellowship: 'friday-fellowship',
      sundaySchool: 'sunday-school',
    });
  });
});

describe('top-level collections and their documents', () => {
  it('addresses users and invitations', () => {
    expect(paths.users()).toBe('users');
    expect(paths.user('uid-miriam')).toBe('users/uid-miriam');
    expect(paths.invitations()).toBe('invitations');
    // Keyed by `emailKey`, because an invitation predates the uid it grants.
    expect(paths.invitation('miriam-at-example-org')).toBe('invitations/miriam-at-example-org');
  });

  it('addresses the recurring templates', () => {
    expect(paths.eventSeries()).toBe('eventSeries');
    expect(paths.series('friday-fellowship')).toBe('eventSeries/friday-fellowship');
  });

  it('addresses students and events', () => {
    expect(paths.students()).toBe('students');
    expect(paths.student('pco_123')).toBe('students/pco_123');
    expect(paths.events()).toBe('events');
    expect(paths.event('event-1')).toBe('events/event-1');
  });

  it('addresses the two chain-keyed collections by chain, never by night', () => {
    // Both exist so that one document answers about a gathering rather than
    // one document per instance of it.
    expect(paths.skippedNights('friday-fellowship')).toBe('skippedNights/friday-fellowship');
    expect(paths.eventAccessCollection()).toBe('eventAccess');
    expect(paths.eventAccess('friday-fellowship')).toBe('eventAccess/friday-fellowship');
  });

  it('addresses upstream edits at the top level', () => {
    // Top level rather than under `students`, because the question is "which
    // edits need somebody" and nobody asking it knows the student.
    expect(paths.upstreamEdits()).toBe('upstreamEdits');
    expect(paths.upstreamEdit('edit-9')).toBe('upstreamEdits/edit-9');
  });
});

describe('the subcollections under an event', () => {
  it('keys attendance by student id, which is what makes check-in idempotent', () => {
    expect(paths.attendanceCollection('event-1')).toBe('events/event-1/attendance');
    expect(paths.attendance('event-1', 'pco_123')).toBe('events/event-1/attendance/pco_123');
  });

  it('keys RSVPs the same way', () => {
    expect(paths.rsvpCollection('event-1')).toBe('events/event-1/rsvps');
    expect(paths.rsvp('event-1', 'pco_123')).toBe('events/event-1/rsvps/pco_123');
  });

  it('puts a record under the event it belongs to and no other', () => {
    expect(paths.attendance('event-2', 'pco_123')).not.toBe(paths.attendance('event-1', 'pco_123'));
  });
});

describe('the config documents', () => {
  it('addresses each one under config', () => {
    expect(paths.settings()).toBe('config/settings');
    expect(paths.planningCenter()).toBe('config/planningCenter');
    expect(paths.attendees32()).toBe('config/attendees32');
    expect(paths.backends()).toBe('config/backends');
  });
});
