/**
 * Property-Based Tests — Whitespace-only Join Rejection (Property 6)
 * Spec: create-join-flow-overhaul  (Task 5.3)
 * Tag: Feature: create-join-flow-overhaul, Property 6
 *
 * Property 6: Whitespace-only join attempts are rejected without changing state.
 *
 *   For any empty or whitespace-only name, attempting to join performs no
 *   transition and emits no `room:join`, leaving the Session_State unchanged.
 *   Conversely, for a joinable name the attempt transitions to JOINING and
 *   emits `room:join` exactly once.
 *
 * Validates: Requirements 4.3
 *
 * Notes on the harness:
 *   This is a pure model test at the state-machine + guard level rather than a
 *   brittle DOM harness. It composes the two shipped, DOM-free pure units:
 *     - `isJoinable(name)` from session-identity.js (the name gate), and
 *     - `transition(state, event)` from session-machine.js (the state table).
 *
 *   `attemptJoin(state, name, emit)` mirrors the Join click guard wired into
 *   `public/app.js` (task 5.2): if the name is not joinable it returns early
 *   without dispatching JOIN_CLICK and without emitting; otherwise it emits
 *   `room:join` and applies the JOIN_CLICK transition. Testing this guard
 *   directly validates Req 4.3 deterministically without a DOM.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { STATES, EVENTS, transition } from '../session-machine.js';
import { isJoinable } from '../session-identity.js';

const NUM_RUNS = 100;

/** The complete set of known states as an array. */
const STATE_VALUES = Object.values(STATES);

/** Whitespace characters used to build whitespace-only strings. */
const WS_CHARS = [' ', '\t', '\n', '\r', '\f', '\v'];

/**
 * The Join click guard, mirroring `public/app.js` (task 5.2).
 *
 * If the name is not joinable, return the current state unchanged and never
 * emit (Req 4.3). Otherwise emit `room:join` once and apply the JOIN_CLICK
 * transition.
 *
 * @param {string} state - the current Session_State
 * @param {unknown} name - the candidate display name from the Name_Field
 * @param {(event: string) => void} emit - the socket emit spy
 * @returns {string} the resulting Session_State
 */
function attemptJoin(state, name, emit) {
  if (!isJoinable(name)) return state;
  emit('room:join');
  return transition(state, EVENTS.JOIN_CLICK);
}

/** Generator for empty/whitespace-only names (non-joinable by Req 4.1). */
const nonJoinableNameArb = fc.oneof(
  fc.constant(''),
  fc.array(fc.constantFrom(...WS_CHARS), { minLength: 1, maxLength: 20 }).map((c) => c.join(''))
);

/**
 * Generator for joinable names: guaranteed to contain a non-whitespace char
 * even after arbitrary surrounding whitespace.
 */
const joinableNameArb = fc
  .tuple(
    fc.array(fc.constantFrom(...WS_CHARS), { maxLength: 8 }),
    fc.string({ minLength: 1, maxLength: 20 }).map((core) => `x${core}`),
    fc.array(fc.constantFrom(...WS_CHARS), { maxLength: 8 })
  )
  .map(([lead, core, trail]) => `${lead.join('')}${core}${trail.join('')}`);

describe('Feature: create-join-flow-overhaul, Property 6 — whitespace-only join attempts are rejected without changing state', () => {
  // Core property: for any empty/whitespace-only name and ANY starting state,
  // attemptJoin performs no transition (state unchanged) and never emits
  // room:join.
  //
  // Validates: Requirements 4.3
  it('empty/whitespace-only names never transition and never emit room:join', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATE_VALUES),
        nonJoinableNameArb,
        (state, name) => {
          const emitted = [];
          const emit = (event) => emitted.push(event);

          const next = attemptJoin(state, name, emit);

          // No transition: state is left exactly as it was (Req 4.3).
          expect(next).toBe(state);
          // No room:join emit occurred (Req 4.3).
          expect(emitted).toEqual([]);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Positive counterpart: for a joinable name from a join-eligible INITIAL
  // state, the attempt emits room:join exactly once and transitions to JOINING.
  // This confirms the guard is not vacuously rejecting everything.
  //
  // Validates: Requirements 4.3 (guard admits valid joins)
  it('joinable names from INITIAL emit room:join once and transition to JOINING', () => {
    fc.assert(
      fc.property(joinableNameArb, (name) => {
        const emitted = [];
        const emit = (event) => emitted.push(event);

        const next = attemptJoin(STATES.INITIAL, name, emit);

        expect(next).toBe(STATES.JOINING);
        expect(emitted).toEqual(['room:join']);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Non-string values (null, undefined, numbers, objects) are also rejected by
  // the guard: no transition, no emit, from any state.
  //
  // Validates: Requirements 4.3
  it('non-string name values never transition and never emit', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATE_VALUES),
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.double(),
          fc.boolean(),
          fc.object()
        ),
        (state, name) => {
          const emitted = [];
          const emit = (event) => emitted.push(event);

          const next = attemptJoin(state, name, emit);

          expect(next).toBe(state);
          expect(emitted).toEqual([]);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Focused examples pinning the boundary behavior.
  it('handles representative examples', () => {
    const run = (state, name) => {
      const emitted = [];
      const next = attemptJoin(state, name, (e) => emitted.push(e));
      return { next, emitted };
    };

    // Empty string from INITIAL: unchanged, no emit.
    expect(run(STATES.INITIAL, '')).toEqual({ next: STATES.INITIAL, emitted: [] });
    // Spaces only from INITIAL: unchanged, no emit.
    expect(run(STATES.INITIAL, '   ')).toEqual({ next: STATES.INITIAL, emitted: [] });
    // Tabs/newlines only: unchanged, no emit.
    expect(run(STATES.INITIAL, '\t\n')).toEqual({ next: STATES.INITIAL, emitted: [] });
    // Valid name: transitions and emits once.
    expect(run(STATES.INITIAL, 'Ada')).toEqual({ next: STATES.JOINING, emitted: ['room:join'] });
    // Padded valid name: transitions and emits once.
    expect(run(STATES.INITIAL, '  Ada  ')).toEqual({
      next: STATES.JOINING,
      emitted: ['room:join']
    });
  });
});
