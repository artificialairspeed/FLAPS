/**
 * Session_State_Machine core — create/join flow overhaul.
 *
 * The single client-side authority for the create/join UI lifecycle. This
 * module contains the pure, DOM-free core: the frozen state and event sets and
 * the total `transition(state, event)` function. Keeping this logic pure makes
 * it unit- and property-testable without a DOM and lets `public/app.js` remain a
 * thin wiring layer over the socket and DOM.
 *
 * Requirements: 1.1, 2.1, 2.3, 3.1, 3.3, 7.2, 8.1, 8.2, 8.3
 */

/**
 * The six states of the Session_State_Machine, and nothing else (Req 1.1).
 * @readonly
 */
export const STATES = Object.freeze({
  INITIAL: 'INITIAL',
  CREATING: 'CREATING',
  JOINING: 'JOINING',
  JOINED: 'JOINED',
  DISCONNECTED: 'DISCONNECTED',
  RESUMING: 'RESUMING'
});

/**
 * The events the machine understands.
 * @readonly
 */
export const EVENTS = Object.freeze({
  CREATE_CLICK: 'CREATE_CLICK', // facilitator activates Create
  ROOM_CREATED: 'ROOM_CREATED', // server room:created
  JOIN_CLICK: 'JOIN_CLICK', // participant activates Join (name valid)
  ROOM_STATE: 'ROOM_STATE', // server room:state (membership confirmed)
  SOCKET_DISCONNECT: 'SOCKET_DISCONNECT', // socket connection lost
  RECONNECT_ATTEMPT: 'RECONNECT_ATTEMPT', // reconnect begins / foreground
  BOOTSTRAP_RESUME: 'BOOTSTRAP_RESUME', // load with stored joined session
  BOOTSTRAP_FRESH: 'BOOTSTRAP_FRESH' // load with no stored session
});

/**
 * Pure, total transition function.
 *
 * Returns the next Session_State for the given `(state, event)` pair following
 * the transition table in design.md. Any unhandled pair (including unknown
 * states or events) returns the current state unchanged, so stray or duplicate
 * events cannot corrupt the UI (no illegal jumps).
 *
 * @param {string} state - the current Session_State
 * @param {string} event - the event to apply
 * @returns {string} the resulting Session_State
 */
export function transition(state, event) {
  switch (state) {
    case STATES.INITIAL:
      if (event === EVENTS.CREATE_CLICK) return STATES.CREATING;
      if (event === EVENTS.JOIN_CLICK) return STATES.JOINING;
      if (event === EVENTS.BOOTSTRAP_RESUME) return STATES.RESUMING;
      return state;
    case STATES.CREATING:
      if (event === EVENTS.ROOM_CREATED) return STATES.JOINED;
      return state;
    case STATES.JOINING:
      if (event === EVENTS.ROOM_STATE) return STATES.JOINED;
      return state;
    case STATES.JOINED:
      if (event === EVENTS.SOCKET_DISCONNECT) return STATES.DISCONNECTED;
      return state;
    case STATES.DISCONNECTED:
      if (event === EVENTS.RECONNECT_ATTEMPT) return STATES.RESUMING;
      if (event === EVENTS.ROOM_STATE) return STATES.JOINED; // fast reconnect
      return state;
    case STATES.RESUMING:
      if (event === EVENTS.ROOM_STATE) return STATES.JOINED;
      if (event === EVENTS.SOCKET_DISCONNECT) return STATES.DISCONNECTED;
      return state;
    default:
      return state;
  }
}

/**
 * Pure control-derivation function — the single mapping from Session_State to
 * the visibility/enabled configuration of every create/join control.
 *
 * Rendering reads only this output; it never inspects the legacy
 * `joinButtonClicked`, `userJoined`, or `roomCreated` flags (Req 1.4). The
 * function is pure in `(state, ctx)`: equal inputs always yield equal configs
 * (Req 1.2, 1.3). It returns a fully specified config for the Create, Name,
 * Join, and emoji controls, plus a top-level `moderatorControls` flag.
 *
 * Mapping (design.md "Control derivation"):
 *  - INITIAL → pre-join config (Req 1.5).
 *  - CREATING → pre-join with Create disabled + 'Creating…' label (Req 2.2).
 *  - JOINING → pre-join with Name and Join visible-but-disabled (Req 3.2).
 *  - JOINED / DISCONNECTED / RESUMING → in-session config; Name and Join
 *    hidden/disabled, never reverting to pre-join, moderator controls iff
 *    facilitator (Req 2.4, 3.4, 7.3, 8.5).
 *  - default (unknown state) → pre-join config.
 *
 * @param {string} state - the current Session_State
 * @param {{role: (string|null), hasRoomInUrl: boolean, hasModKey: boolean}} ctx - render context
 * @returns {object} the fully specified control configuration
 */
export function deriveControls(state, ctx) {
  const preJoin = {
    // INITIAL entry configuration (Req 1.5). The Name and emoji controls are
    // always visible in the pre-join view so a facilitator can set their own
    // name/emoji BEFORE creating a room (Req 2.5), and a participant can set
    // theirs before joining. The Create button shows only when there is no room
    // in the URL; the Join button shows only when there is (a room to join),
    // and Join stays gated on a non-empty name (Req 4).
    create: { visible: !ctx.hasRoomInUrl, enabled: true, label: 'Create Room' },
    name: { visible: true, enabled: true },
    join: { visible: ctx.hasRoomInUrl, enabled: false, label: 'Join' }, // gated by name (Req 4)
    emoji: { visible: true, enabled: true }
  };
  const inSession = {
    // JOINED / DISCONNECTED / RESUMING configuration. The Create button is a
    // non-interactive status indicator here ("Room Created"), so it is disabled
    // — mirroring the participant's disabled "Joined" button. Leaving it enabled
    // let a facilitator re-click it and emit a second room:create, spawning an
    // extra room.
    create: { visible: ctx.role === 'facilitator', enabled: false, label: 'Room Created' },
    name: { visible: false, enabled: false },
    // Participants keep the Join button visible after joining, relabelled
    // "Joined" and styled green — mirroring the facilitator's "Room Created"
    // button. Facilitators (who use the Create button) keep Join hidden.
    join: { visible: ctx.role === 'participant', enabled: false, label: 'Joined' },
    emoji: { visible: false, enabled: false },
    moderatorControls: ctx.role === 'facilitator'
  };
  switch (state) {
    case STATES.INITIAL:
      return preJoin;
    case STATES.CREATING:
      return {
        ...preJoin,
        create: { visible: true, enabled: false, label: 'Creating…' } // Req 2.2
      };
    case STATES.JOINING:
      return {
        ...preJoin,
        name: { visible: true, enabled: false }, // Req 3.2
        join: { visible: true, enabled: false, label: 'Join' }
      };
    case STATES.JOINED: // Req 2.4 (facilitator) / 3.4 (participant)
    case STATES.DISCONNECTED: // Req 8.5 — keep in-session config, do not revert
    case STATES.RESUMING: // Req 7.3 / 8.5 — name+join disabled, in-session config
      return inSession;
    default:
      return preJoin;
  }
}

/**
 * Thin stateful holder around the pure core.
 *
 * Owns the current Session_State and render context `{ role, hasRoomInUrl,
 * hasModKey }` and notifies a single `render` subscriber on every change. This
 * is the one place that drives all create/join control rendering (Req 1.3):
 * `dispatch` runs the pure `transition` and re-renders; `setContext` merges a
 * context patch and re-renders. The subscriber is invoked as
 * `render(deriveControls(state, ctx), state, ctx)`.
 *
 * `deriveControls` is the module-scoped pure derivation function added in task
 * 2.1; it is referenced here so the wiring is correct once it exists.
 *
 * @param {string} initialState - the starting Session_State
 * @param {{role: (string|null), hasRoomInUrl: boolean, hasModKey: boolean}} initialCtx - initial render context
 * @param {(controls: object, state: string, ctx: object) => void} render - the single render subscriber
 * @returns {{getState: () => string, setContext: (patch: object) => void, dispatch: (event: string) => void}}
 */
export function createSessionMachine(initialState, initialCtx, render) {
  let state = initialState;
  let ctx = { ...initialCtx }; // { role, hasRoomInUrl, hasModKey }

  function apply() {
    render(deriveControls(state, ctx), state, ctx);
  }

  return {
    getState: () => state,
    setContext: (patch) => {
      ctx = { ...ctx, ...patch };
      apply();
    },
    dispatch: (event) => {
      const next = transition(state, event);
      if (next !== state) {
        state = next;
      }
      apply(); // Req 1.3: one place updates all controls
    }
  };
}
