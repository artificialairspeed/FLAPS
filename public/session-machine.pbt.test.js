/**
 * Property-Based Tests — Session_State_Machine `transition`
 * Spec: create-join-flow-overhaul (Task 1.2)
 *
 * Feature: create-join-flow-overhaul, Property 4
 *
 * Property 4: The transition function is total and follows the specified
 * transition table.
 *
 *   For any Session_State and any event, `transition` returns a member of the
 *   state set (totality for known states), and returns the input state
 *   unchanged for unhandled pairs. The specified edges hold:
 *     INITIAL      + CREATE_CLICK      -> CREATING
 *     CREATING     + ROOM_CREATED      -> JOINED
 *     INITIAL      + JOIN_CLICK        -> JOINING
 *     JOINING      + ROOM_STATE        -> JOINED
 *     JOINED       + SOCKET_DISCONNECT -> DISCONNECTED
 *     DISCONNECTED + RECONNECT_ATTEMPT -> RESUMING
 *     RESUMING     + ROOM_STATE        -> JOINED
 *   Any unspecified (state, event) pair leaves the state unchanged.
 *
 * Validates: Requirements 2.1, 2.3, 3.1, 3.3, 7.2, 8.1, 8.2, 8.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { STATES, EVENTS, transition, deriveControls } from './session-machine.js';

const NUM_RUNS = 100;

/** The complete set of known states as an array. */
const STATE_VALUES = Object.values(STATES);
/** The complete set of known events as an array. */
const EVENT_VALUES = Object.values(EVENTS);

/**
 * The specified transition table. Every entry that is present is an edge the
 * machine MUST follow; every (state, event) pair NOT present here must leave
 * the state unchanged.
 */
const SPECIFIED_EDGES = {
  [STATES.INITIAL]: {
    [EVENTS.CREATE_CLICK]: STATES.CREATING,
    [EVENTS.JOIN_CLICK]: STATES.JOINING,
    [EVENTS.BOOTSTRAP_RESUME]: STATES.RESUMING
  },
  [STATES.CREATING]: {
    [EVENTS.ROOM_CREATED]: STATES.JOINED
  },
  [STATES.JOINING]: {
    [EVENTS.ROOM_STATE]: STATES.JOINED
  },
  [STATES.JOINED]: {
    [EVENTS.SOCKET_DISCONNECT]: STATES.DISCONNECTED
  },
  [STATES.DISCONNECTED]: {
    [EVENTS.RECONNECT_ATTEMPT]: STATES.RESUMING,
    [EVENTS.ROOM_STATE]: STATES.JOINED
  },
  [STATES.RESUMING]: {
    [EVENTS.ROOM_STATE]: STATES.JOINED,
    [EVENTS.SOCKET_DISCONNECT]: STATES.DISCONNECTED
  }
};

/** Reference oracle: what the transition SHOULD produce for known state/event. */
function expectedTransition(state, event) {
  const edges = SPECIFIED_EDGES[state];
  if (edges && Object.prototype.hasOwnProperty.call(edges, event)) {
    return edges[event];
  }
  return state; // unspecified pair -> unchanged
}

describe('Feature: create-join-flow-overhaul, Property 4: transition is total and follows the table', () => {
  // (a) Totality for known states: for any known state and ANY event (including
  // unknown events), transition returns a member of the STATES set.
  // Validates: Requirements 7.2, 8.3
  it('is total for known states: always returns a member of STATES (known + unknown events)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATE_VALUES),
        fc.oneof(fc.constantFrom(...EVENT_VALUES), fc.string()),
        (state, event) => {
          const next = transition(state, event);
          expect(STATE_VALUES).toContain(next);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // (a continued) Unhandled pairs leave the state unchanged. This covers
  // arbitrary events (including unknown/garbage events) against known states.
  // Validates: Requirements 8.3
  it('leaves state unchanged for any unspecified (state, event) pair', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATE_VALUES),
        fc.oneof(fc.constantFrom(...EVENT_VALUES), fc.string()),
        (state, event) => {
          const edges = SPECIFIED_EDGES[state];
          const isSpecified =
            edges && Object.prototype.hasOwnProperty.call(edges, event);
          if (!isSpecified) {
            expect(transition(state, event)).toBe(state);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Unknown states also return the input state unchanged (default branch).
  // Validates: Requirements 8.3
  it('returns unknown/unhandled states unchanged for any event', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !STATE_VALUES.includes(s)),
        fc.oneof(fc.constantFrom(...EVENT_VALUES), fc.string()),
        (unknownState, event) => {
          expect(transition(unknownState, event)).toBe(unknownState);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // (b) The full transition matches the specified table across all known
  // state/event combinations (this asserts every specified edge holds AND that
  // no extra edges exist).
  // Validates: Requirements 2.1, 2.3, 3.1, 3.3, 7.2, 8.1, 8.2
  it('matches the specified transition table for all known (state, event) pairs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATE_VALUES),
        fc.constantFrom(...EVENT_VALUES),
        (state, event) => {
          expect(transition(state, event)).toBe(expectedTransition(state, event));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // (b explicit) Each specified edge holds exactly as required. Explicit
  // assertions make the required transitions unmistakable and self-documenting.
  // Validates: Requirements 2.1, 2.3, 3.1, 3.3, 7.2, 8.1, 8.2
  it('honors each explicitly specified edge', () => {
    expect(transition(STATES.INITIAL, EVENTS.CREATE_CLICK)).toBe(STATES.CREATING);
    expect(transition(STATES.CREATING, EVENTS.ROOM_CREATED)).toBe(STATES.JOINED);
    expect(transition(STATES.INITIAL, EVENTS.JOIN_CLICK)).toBe(STATES.JOINING);
    expect(transition(STATES.JOINING, EVENTS.ROOM_STATE)).toBe(STATES.JOINED);
    expect(transition(STATES.JOINED, EVENTS.SOCKET_DISCONNECT)).toBe(STATES.DISCONNECTED);
    expect(transition(STATES.DISCONNECTED, EVENTS.RECONNECT_ATTEMPT)).toBe(STATES.RESUMING);
    expect(transition(STATES.RESUMING, EVENTS.ROOM_STATE)).toBe(STATES.JOINED);
  });
});

/**
 * Feature: create-join-flow-overhaul, Property 1
 *
 * Property 1: State machine defines exactly the six states.
 *
 *   The STATES set must contain exactly the six values INITIAL, CREATING,
 *   JOINING, JOINED, DISCONNECTED, and RESUMING — no more, no fewer.
 *
 * Validates: Requirements 1.1
 */
describe('Feature: create-join-flow-overhaul, Property 1: STATES defines exactly the six states', () => {
  it('exposes exactly the six specified state values, no more and no fewer', () => {
    const expectedStates = [
      'INITIAL',
      'CREATING',
      'JOINING',
      'JOINED',
      'DISCONNECTED',
      'RESUMING'
    ];

    // Exactly six entries — no extras, none missing.
    expect(Object.values(STATES).sort()).toEqual([...expectedStates].sort());

    // Keys map to their own name (self-consistent enumeration).
    expect(Object.keys(STATES).sort()).toEqual([...expectedStates].sort());
    for (const name of expectedStates) {
      expect(STATES[name]).toBe(name);
    }
  });
});

/**
 * Feature: create-join-flow-overhaul, Property 2
 *
 * Property 2: Control configuration is derived solely and deterministically
 * from state.
 *
 *   For any Session_State and render context, `deriveControls(state, ctx)`
 *   returns a fully specified visibility/enabled configuration for the Create,
 *   Name, Join, and emoji controls; is a pure function of `(state, ctx)` (equal
 *   inputs yield deep-equal configs, and repeated calls are deep-equal); and
 *   depends on no external mutable flag.
 *
 * Validates: Requirements 1.2, 1.3, 1.4
 */
describe('Feature: create-join-flow-overhaul, Property 2: deriveControls is pure and fully specified', () => {
  /** State generator: known states plus arbitrary unknown strings. */
  const stateArb = fc.oneof(fc.constantFrom(...STATE_VALUES), fc.string());

  /** Render context generator matching the design's ctx shape. */
  const ctxArb = fc.record({
    role: fc.constantFrom('facilitator', 'participant', null),
    hasRoomInUrl: fc.boolean(),
    hasModKey: fc.boolean()
  });

  /** Assert a control entry has boolean `visible` and `enabled` fields. */
  function expectControlShape(control) {
    expect(control).toBeTypeOf('object');
    expect(control).not.toBeNull();
    expect(typeof control.visible).toBe('boolean');
    expect(typeof control.enabled).toBe('boolean');
  }

  // (a) Determinism/purity: two independent calls with equal inputs are
  // deep-equal. Validates: Requirements 1.2, 1.3
  it('returns deep-equal configs for equal inputs (deterministic)', () => {
    fc.assert(
      fc.property(stateArb, ctxArb, (state, ctx) => {
        const first = deriveControls(state, { ...ctx });
        const second = deriveControls(state, { ...ctx });
        expect(first).toEqual(second);
        // Distinct object references (no shared mutable singleton leaking out).
        expect(first).not.toBe(second);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // (b) Fully specified: the returned object always has create/name/join/emoji
  // keys, each with boolean visible + enabled. Validates: Requirements 1.2
  it('always returns a fully specified config with boolean visible/enabled for every control', () => {
    fc.assert(
      fc.property(stateArb, ctxArb, (state, ctx) => {
        const config = deriveControls(state, ctx);
        expect(config).toBeTypeOf('object');
        expect(config).not.toBeNull();
        for (const key of ['create', 'name', 'join', 'emoji']) {
          expect(config).toHaveProperty(key);
          expectControlShape(config[key]);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // (c) No dependence on external mutable state, and mutating a returned config
  // does not affect subsequent output. A fresh call after mutation is
  // deep-equal to a fresh reference config. Validates: Requirements 1.3, 1.4
  it('does not depend on external mutable state or on mutations of prior output', () => {
    fc.assert(
      fc.property(stateArb, ctxArb, (state, ctx) => {
        // Reference config computed from a pristine input.
        const reference = deriveControls(state, { ...ctx });

        // First call, then aggressively mutate everything it returned.
        const first = deriveControls(state, { ...ctx });
        first.create.visible = !first.create.visible;
        first.create.enabled = !first.create.enabled;
        first.name.visible = !first.name.visible;
        first.join.enabled = !first.join.enabled;
        first.emoji.visible = !first.emoji.visible;
        first.moderatorControls = 'tampered';
        first.injected = 'tampered';

        // Mutate the caller's ctx object after the call too — output must not
        // retain a live reference to it.
        const mutableCtx = { ...ctx };
        deriveControls(state, mutableCtx);
        mutableCtx.role = mutableCtx.role === 'facilitator' ? 'participant' : 'facilitator';
        mutableCtx.hasRoomInUrl = !mutableCtx.hasRoomInUrl;
        mutableCtx.hasModKey = !mutableCtx.hasModKey;

        // A fresh call with equal input still matches the pristine reference.
        const afterMutation = deriveControls(state, { ...ctx });
        expect(afterMutation).toEqual(reference);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

/**
 * Feature: create-join-flow-overhaul, Property 3
 *
 * Property 3: State-to-control mapping matches the specified configuration for
 * every state.
 *
 *   For any Session_State and role, `deriveControls` yields the specified
 *   control configuration:
 *     - INITIAL presents the pre-join configuration.
 *     - CREATING disables the Create control (create.enabled false, create.visible true).
 *     - JOINING disables Name and Join (name.visible true & enabled false,
 *       join.visible true & enabled false).
 *     - JOINED / DISCONNECTED / RESUMING keep the in-session configuration with
 *       Name and Join hidden/disabled (name.visible false, join.visible false),
 *       never reverting to the pre-join configuration, and expose moderator
 *       controls iff role === 'facilitator'.
 *
 * Validates: Requirements 1.5, 2.2, 2.4, 3.2, 3.4, 7.3, 8.5
 */
describe('Feature: create-join-flow-overhaul, Property 3: state-to-control mapping matches the spec', () => {
  /** The three in-session states that must never revert to pre-join. */
  const IN_SESSION_STATES = [STATES.JOINED, STATES.DISCONNECTED, STATES.RESUMING];

  /** Render context generator matching the design's ctx shape. */
  const ctxArb = fc.record({
    role: fc.constantFrom('facilitator', 'participant', null),
    hasRoomInUrl: fc.boolean(),
    hasModKey: fc.boolean()
  });

  /** The pre-join reference config used to detect illegal reversion. */
  function preJoinConfig(ctx) {
    return {
      // Name and emoji are always visible in the pre-join view so a facilitator
      // can set their own name/emoji before creating and a participant before
      // joining (Req 2.5). Create shows only without a room in the URL; Join
      // only with one.
      create: { visible: !ctx.hasRoomInUrl, enabled: true, label: 'Create Room' },
      name: { visible: true, enabled: true },
      join: { visible: ctx.hasRoomInUrl, enabled: false, label: 'Join' },
      emoji: { visible: true, enabled: true }
    };
  }

  // INITIAL presents exactly the pre-join configuration. Validates: Req 1.5
  it('INITIAL presents the pre-join configuration', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const config = deriveControls(STATES.INITIAL, ctx);
        expect(config).toEqual(preJoinConfig(ctx));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // CREATING disables the Create control while keeping it visible. Validates: Req 2.2
  it('CREATING disables the Create control (visible, not enabled)', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const config = deriveControls(STATES.CREATING, ctx);
        expect(config.create.visible).toBe(true);
        expect(config.create.enabled).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // JOINING disables both Name and Join while keeping them visible. Validates: Req 3.2
  it('JOINING disables Name and Join (both visible, both disabled)', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const config = deriveControls(STATES.JOINING, ctx);
        expect(config.name.visible).toBe(true);
        expect(config.name.enabled).toBe(false);
        expect(config.join.visible).toBe(true);
        expect(config.join.enabled).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // JOINED / DISCONNECTED / RESUMING keep Name hidden/disabled and Join
  // disabled, and never revert to the pre-join name/join visibility, across
  // every role. Participants keep Join visible as the green "Joined" button;
  // facilitators (and unknown roles) keep it hidden.
  // Validates: Req 2.4, 3.4, 7.3, 8.5
  it('in-session states keep Name hidden/disabled and Join disabled and never revert to pre-join', () => {
    fc.assert(
      fc.property(fc.constantFrom(...IN_SESSION_STATES), ctxArb, (state, ctx) => {
        const config = deriveControls(state, ctx);

        // Name hidden/disabled and Join disabled in every in-session state.
        expect(config.name.visible).toBe(false);
        expect(config.name.enabled).toBe(false);
        expect(config.join.enabled).toBe(false);
        // Join is shown (relabelled "Joined") only for participants.
        expect(config.join.visible).toBe(ctx.role === 'participant');
        if (ctx.role === 'participant') {
          expect(config.join.label).toBe('Joined');
        }

        // Never reverts to the pre-join Name/Join visibility. The pre-join
        // config would make Name/Join visibility follow hasRoomInUrl; the
        // in-session config forces them hidden regardless of context.
        const preJoin = preJoinConfig(ctx);
        const revertedToPreJoin =
          config.name.visible === preJoin.name.visible &&
          config.name.enabled === preJoin.name.enabled &&
          config.join.visible === preJoin.join.visible &&
          config.join.enabled === preJoin.join.enabled &&
          preJoin.name.visible === true; // only a genuine reversion when pre-join showed them
        expect(revertedToPreJoin).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // moderatorControls is exposed iff the role is facilitator in the in-session
  // states. Validates: Req 2.4, 3.4
  it('in-session states expose moderatorControls iff role is facilitator', () => {
    fc.assert(
      fc.property(fc.constantFrom(...IN_SESSION_STATES), ctxArb, (state, ctx) => {
        const config = deriveControls(state, ctx);
        expect(config.moderatorControls).toBe(ctx.role === 'facilitator');
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
