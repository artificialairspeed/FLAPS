/**
 * Property-Based Tests — Client Identity Persistence (Property 7)
 * Spec: create-join-flow-overhaul  (Task 4.2)
 * Tag: Feature: create-join-flow-overhaul, Property 7
 *
 * Property 7: Client identity persists and is stable.
 *
 *   For any initial storage condition, `getClientId()`:
 *     - returns a non-empty identifier,
 *     - persists that identifier to sessionStorage (per-tab identity),
 *     - returns the SAME identifier on every subsequent call (idempotence),
 *     - mints a new one ONLY when none already exists.
 *
 * Validates: Requirements 5.1, 5.2, 5.4
 *
 * Notes on the harness:
 *   `session-identity.js` caches the resolved clientId in a module-level
 *   variable (`cachedClientId`). To exercise BOTH the fresh-mint path and the
 *   persisted-reuse path deterministically, each generated case resets the
 *   module registry with `vi.resetModules()` and re-imports the module via a
 *   dynamic `import()`, starting from a clean module cache.
 *
 *   The module reads/writes the global `localStorage`. Rather than depend on a
 *   real browser store, each case installs a minimal in-memory `localStorage`
 *   stub on `globalThis` and optionally pre-seeds it, giving full control over
 *   the initial storage condition (absent key, empty value, or existing id).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

const NUM_RUNS = 100;
const MODULE_PATH = '../session-identity.js';

/**
 * Create a minimal in-memory localStorage stub implementing the subset of the
 * Web Storage API that `session-identity.js` uses (getItem/setItem), plus
 * clear/removeItem for test hygiene.
 *
 * @param {Record<string,string>} [seed] - initial key/value pairs.
 * @returns {Storage-like} the stub.
 */
function makeLocalStorageStub(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
  };
}

/**
 * Freshly load the module under a clean module registry so its in-module
 * `cachedClientId` starts unset, with a fresh localStorage stub installed.
 *
 * @param {string|null} preSeed - value to store under the module's clientId
 *   key before import, or `null` to leave the key unset.
 * @returns {Promise<object>} the freshly evaluated module exports.
 */
async function loadFresh(preSeed) {
  vi.resetModules();
  // Install a bare stub first so we can discover the exact key name the module
  // uses, then re-install a correctly seeded stub for the real import. Client
  // identity is now PER-TAB (sessionStorage), so the stub is installed there.
  globalThis.sessionStorage = makeLocalStorageStub();
  const probe = await import(MODULE_PATH);
  const key = probe.CLIENT_ID_KEY;

  const seed = preSeed !== null ? { [key]: preSeed } : {};
  globalThis.sessionStorage = makeLocalStorageStub(seed);

  // Reset again so the probe import's cached id does not leak into the case.
  vi.resetModules();
  return import(MODULE_PATH);
}

beforeEach(() => {
  // Identity lives in sessionStorage (per-tab); remembered defaults in localStorage.
  globalThis.localStorage = makeLocalStorageStub();
  globalThis.sessionStorage = makeLocalStorageStub();
});

describe('Feature: create-join-flow-overhaul, Property 7 — client identity persists and is stable', () => {
  // Over arbitrary initial storage conditions (no key, empty-string key, or a
  // pre-existing non-empty id) plus an arbitrary number of repeat calls:
  //   - the returned id is always a non-empty string,
  //   - it is persisted to localStorage,
  //   - repeated calls are idempotent,
  //   - a pre-existing non-empty id is reused (never re-minted).
  //
  // Validates: Requirements 5.1, 5.2, 5.4
  it('getClientId is non-empty, persisted, idempotent, and reuses an existing id', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary initial storage condition:
        //   null            -> key absent (fresh mint expected)
        //   ''              -> falsy stored value (treated as absent -> mint)
        //   non-empty string-> persisted identity (reuse expected)
        fc.oneof(
          fc.constant(null),
          fc.constant(''),
          fc.uuid(),
          fc.string({ minLength: 1, maxLength: 40 })
        ),
        // Number of additional getClientId() calls to check idempotence.
        fc.integer({ min: 0, max: 8 }),
        async (preSeed, repeats) => {
          const { getClientId, CLIENT_ID_KEY } = await loadFresh(preSeed);

          const first = getClientId();

          // Always a non-empty string identifier (Req 5.2 / general contract).
          expect(typeof first).toBe('string');
          expect(first.length).toBeGreaterThan(0);

          const hadExisting = typeof preSeed === 'string' && preSeed.length > 0;
          if (hadExisting) {
            // A pre-existing, non-empty id is reused rather than re-minted (Req 5.4).
            expect(first).toBe(preSeed);
          }

          // The resolved id is persisted to sessionStorage (per-tab) — either
          // the freshly minted one or the reused existing one.
          expect(sessionStorage.getItem(CLIENT_ID_KEY)).toBe(first);

          // Idempotence: every subsequent call returns the same identifier
          // and never changes what is persisted.
          for (let i = 0; i < repeats; i++) {
            expect(getClientId()).toBe(first);
            expect(sessionStorage.getItem(CLIENT_ID_KEY)).toBe(first);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Focused example: fresh mint when storage starts empty — a new non-empty id
  // is generated and written to localStorage (Req 5.1, 5.2).
  it('mints and persists a new id when none exists (fresh mint)', async () => {
    const { getClientId, CLIENT_ID_KEY } = await loadFresh(null);
    expect(sessionStorage.getItem(CLIENT_ID_KEY)).toBeNull();

    const id = getClientId();
    expect(id.length).toBeGreaterThan(0);
    expect(sessionStorage.getItem(CLIENT_ID_KEY)).toBe(id);
  });

  // Focused example: an existing stored id is reused verbatim, never re-minted
  // (Req 5.4).
  it('reuses the persisted id across a fresh load', async () => {
    const stored = 'existing-client-id-1234';
    const { getClientId } = await loadFresh(stored);
    expect(getClientId()).toBe(stored);
    // A second fresh load with the same store still returns the same id.
    const { getClientId: getClientId2 } = await loadFresh(stored);
    expect(getClientId2()).toBe(stored);
  });
});

/**
 * Property-Based Tests — Remembered Defaults Round-Trip (Property 9)
 * Spec: create-join-flow-overhaul  (Task 4.4)
 * Tag: Feature: create-join-flow-overhaul, Property 9
 *
 * Property 9: Remembered defaults round-trip.
 *
 *   For any name and emoji pair, saving them via `saveDefaults(name, emoji)`
 *   and then reading them back via `loadDefaults()` returns the same name and
 *   emoji.
 *
 * Validates: Requirements 6.1, 6.2
 *
 * Notes on the harness:
 *   These functions are stateless with respect to the module registry (they do
 *   not cache), so no module reset is needed between cases. Each case installs
 *   a fresh in-memory `localStorage` stub on `globalThis` (reusing the
 *   `makeLocalStorageStub` helper above) so save/load operate against a clean,
 *   isolated store.
 *
 *   Implementation nuances the assertions must respect:
 *     - `saveDefaults` only persists `name` when truthy, so an empty/blank name
 *       is never written. To keep the round-trip meaningful for the name we
 *       constrain the generated name to a non-empty string; `loadDefaults`
 *       would otherwise fall back to '' for an absent name.
 *     - `emoji` is always persisted (nullish coalesced to ''), so the emoji
 *       round-trips exactly, including the empty string.
 */

import { saveDefaults, loadDefaults } from '../session-identity.js';

describe('Feature: create-join-flow-overhaul, Property 9 — remembered defaults round-trip', () => {
  // Over arbitrary non-empty names and arbitrary emoji strings (including ''),
  // saving then loading returns exactly the saved pair.
  //
  // Validates: Requirements 6.1, 6.2
  it('saveDefaults then loadDefaults returns the same name and emoji', () => {
    fc.assert(
      fc.property(
        // Non-empty name: saveDefaults only persists a truthy name (Req 6.1).
        fc.string({ minLength: 1, maxLength: 40 }),
        // Emoji: any string, including '' which is persisted as-is (Req 6.1).
        fc.string({ maxLength: 8 }),
        (name, emoji) => {
          // Fresh, isolated store per case.
          globalThis.localStorage = makeLocalStorageStub();

          saveDefaults(name, emoji);
          const loaded = loadDefaults();

          expect(loaded.name).toBe(name);
          expect(loaded.emoji).toBe(emoji);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Focused example: a typical name/emoji pair round-trips cleanly.
  it('round-trips a typical name and emoji pair', () => {
    globalThis.localStorage = makeLocalStorageStub();
    saveDefaults('Ada', '🦊');
    expect(loadDefaults()).toEqual({ name: 'Ada', emoji: '🦊' });
  });

  // Focused example: an empty emoji is persisted and loaded as '' (Req 6.1).
  it('round-trips an empty emoji as empty string', () => {
    globalThis.localStorage = makeLocalStorageStub();
    saveDefaults('Grace', '');
    expect(loadDefaults()).toEqual({ name: 'Grace', emoji: '' });
  });
});

/**
 * Property-Based Tests — Name Gating (Property 5)
 * Spec: create-join-flow-overhaul  (Task 4.6)
 * Tag: Feature: create-join-flow-overhaul, Property 5
 *
 * Property 5: Join is enabled exactly when the name has a non-whitespace character.
 *
 *   For any value, `isJoinable(value)` returns true iff the value is a string
 *   containing at least one non-whitespace character. Empty strings,
 *   whitespace-only strings, and non-string values (null, undefined, numbers)
 *   all return false. Consequently the Join control is enabled for joinable
 *   names and disabled otherwise.
 *
 * Validates: Requirements 4.1, 4.2
 *
 * Notes on the harness:
 *   `isJoinable` is a pure, DOM-free predicate with no storage dependency, so
 *   each case simply evaluates it against a generated value and compares to a
 *   simple oracle: (typeof s === 'string' && s.trim().length > 0).
 */

import { isJoinable } from '../session-identity.js';

/** Oracle for the joinable predicate, expressed independently of the impl. */
const expectedJoinable = (s) => typeof s === 'string' && s.trim().length > 0;

/** Whitespace characters used to build whitespace-only strings. */
const WS_CHARS = [' ', '\t', '\n', '\r', '\f', '\v'];

describe('Feature: create-join-flow-overhaul, Property 5 — join enabled iff name has a non-whitespace character', () => {
  // Over arbitrary strings, `isJoinable` agrees with the trim-based oracle.
  //
  // Validates: Requirements 4.1, 4.2
  it('matches the trim-based oracle for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(isJoinable(s)).toBe(expectedJoinable(s));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Whitespace-only strings (any mix/length of spaces, tabs, newlines) are
  // never joinable (Req 4.1).
  it('rejects whitespace-only strings', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...WS_CHARS), { minLength: 1, maxLength: 20 }),
        (chars) => {
          const s = chars.join('');
          expect(isJoinable(s)).toBe(false);
          expect(isJoinable(s)).toBe(expectedJoinable(s));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Content surrounded by arbitrary leading/trailing whitespace is joinable,
  // because at least one non-whitespace character remains after trimming
  // (Req 4.2).
  it('accepts content with leading/trailing whitespace', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...WS_CHARS), { maxLength: 10 }),
        // A core guaranteed to contain a non-whitespace character.
        fc.string({ minLength: 1, maxLength: 20 }).map((core) => `x${core}`),
        fc.array(fc.constantFrom(...WS_CHARS), { maxLength: 10 }),
        (lead, core, trail) => {
          const s = `${lead.join('')}${core}${trail.join('')}`;
          expect(isJoinable(s)).toBe(true);
          expect(isJoinable(s)).toBe(expectedJoinable(s));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Non-string values are never joinable (Req 4.1): null, undefined, numbers,
  // booleans, objects, arrays.
  it('rejects non-string values', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.double(),
          fc.boolean(),
          fc.object(),
          fc.array(fc.anything())
        ),
        (v) => {
          expect(isJoinable(v)).toBe(false);
          expect(isJoinable(v)).toBe(expectedJoinable(v));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Focused examples pinning the boundary behavior.
  it('handles representative examples', () => {
    expect(isJoinable('')).toBe(false); // empty string
    expect(isJoinable('   ')).toBe(false); // spaces only
    expect(isJoinable('\t\n')).toBe(false); // tabs/newlines only
    expect(isJoinable('Ada')).toBe(true); // plain name
    expect(isJoinable('  Ada  ')).toBe(true); // padded name
    expect(isJoinable(null)).toBe(false);
    expect(isJoinable(undefined)).toBe(false);
    expect(isJoinable(42)).toBe(false);
  });
});

/**
 * Property-Based Tests — Emit Payload Carries clientId (Property 8)
 * Spec: create-join-flow-overhaul  (Task 4.8)
 * Tag: Feature: create-join-flow-overhaul, Property 8
 *
 * Property 8: Every create/join emit carries the stored clientId.
 *
 *   Every `room:create` / `room:join` / resume payload is built through the
 *   single `joinPayload(extra)` helper, which always attaches the durable
 *   per-browser identity. Therefore, for any `extra` object:
 *     - `joinPayload(extra).clientId === getClientId()`, and
 *     - every other field from `extra` is preserved verbatim,
 *     - even when `extra` itself contains a `clientId` key (it is always
 *       overridden by `getClientId()` and can never leak through).
 *
 * Validates: Requirements 5.3
 *
 * Notes on the harness:
 *   `joinPayload` is a pure, DOM-free helper whose only side channel is the
 *   module-level clientId resolved by `getClientId()`. Because both helpers are
 *   imported from the same module instance, they share the same cached
 *   clientId, so `joinPayload(extra).clientId` and `getClientId()` observe the
 *   same value. Each case installs a fresh in-memory `localStorage` stub (via
 *   the `makeLocalStorageStub` helper above) so identity resolution has a
 *   well-defined store to read/write.
 */

import { joinPayload, getClientId } from '../session-identity.js';

describe('Feature: create-join-flow-overhaul, Property 8 — every create/join emit carries the stored clientId', () => {
  // Over arbitrary `extra` objects, the built payload's clientId equals
  // getClientId() and all other fields from `extra` are preserved.
  //
  // Validates: Requirements 5.3
  it('joinPayload attaches getClientId() and preserves other extra fields', () => {
    fc.assert(
      fc.property(fc.object(), (extra) => {
        // Fresh, isolated store per case.
        globalThis.localStorage = makeLocalStorageStub();

        const payload = joinPayload(extra);

        // clientId is always sourced from getClientId() (Req 5.3).
        expect(payload.clientId).toBe(getClientId());
        expect(typeof payload.clientId).toBe('string');
        expect(payload.clientId.length).toBeGreaterThan(0);

        // Every field from `extra` other than clientId is preserved verbatim.
        for (const key of Object.keys(extra)) {
          if (key === 'clientId') continue;
          expect(payload[key]).toBe(extra[key]);
        }

        // The helper does not mutate its input.
        expect(extra).not.toBe(payload);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // clientId in `extra` can never override the stored identity: it is always
  // replaced by getClientId() (Req 5.3).
  it('overrides any clientId supplied in extra with getClientId()', () => {
    fc.assert(
      fc.property(
        fc.object(),
        // An arbitrary would-be clientId a caller might try to smuggle in.
        fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined)),
        (extra, smuggledId) => {
          globalThis.localStorage = makeLocalStorageStub();

          const payload = joinPayload({ ...extra, clientId: smuggledId });

          // The smuggled value is ignored; the durable identity always wins.
          expect(payload.clientId).toBe(getClientId());
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Focused example: a representative create/join payload carries clientId and
  // keeps its room/name/emoji/modKey fields intact.
  it('builds a representative join payload with clientId attached', () => {
    globalThis.localStorage = makeLocalStorageStub();
    const extra = { roomId: 'room-42', name: 'Ada', emoji: '🦊', modKey: 'secret' };
    const payload = joinPayload(extra);

    expect(payload.clientId).toBe(getClientId());
    expect(payload.roomId).toBe('room-42');
    expect(payload.name).toBe('Ada');
    expect(payload.emoji).toBe('🦊');
    expect(payload.modKey).toBe('secret');
  });

  // Focused example: joinPayload() with no argument still attaches clientId.
  it('attaches clientId even when called with no extra', () => {
    globalThis.localStorage = makeLocalStorageStub();
    const payload = joinPayload();
    expect(payload.clientId).toBe(getClientId());
    expect(payload.clientId.length).toBeGreaterThan(0);
  });
});
