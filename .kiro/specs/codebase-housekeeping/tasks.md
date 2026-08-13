# Implementation Plan: Codebase Housekeeping

## Overview

Behavior-preserving cleanup executed as the risk-ordered pipeline from the design: baseline capture → tooling removal → config hygiene → documentation → dead code removal by category → final verification. Language is JavaScript (ESM) plus shell; no new source modules and no new test files are created.

Every removal step ends with a verification gate: `npm test` plus a test-inventory `diff` against the Phase 0 baseline, per Requirement 3.2. A gate is green only when the inventory diff is empty (or every line is justified in the Requirement 4 edit allowlist in `removals.md`). Manifests live in `/tmp/flaps-housekeeping/` so the cleanup adds no tracked artifacts. Git is the rollback mechanism: one commit per step, `git checkout -- <paths>` to discard a red step.

Property numbers below refer to the Correctness Properties in `design.md`. They are checked by enumeration with shell/`node -e` one-liners at the gates, not by generated tests.

**Resume point.** Phases 0–3 and task 6.1 are complete and committed: `09ab73e` (Phase 0 baseline, 186 tests all passing), `a87bfe6` (Phase 1 removals), `1e16aeb` (Phase 2 config hygiene), `802c495` (Phase 3 documentation, current `HEAD`). Tasks 6.1 and 6.2 both produced **zero removals** — every import binding in Application_Source is referenced outside its import line, and every comment is explanatory prose or JSDoc — so neither added a commit and the working tree is byte-identical to `802c495`. Both audits are recorded in `removals.md`, and both gates are green (186/186, empty inventory diff). The `/tmp/flaps-housekeeping/` manifests survive, including the `gate6.1` and `gate6.2` captures, so no re-baselining is needed. Next task is 6.3.

## Tasks

- [x] 1. Phase 0 — baseline manifest capture
  - [x] 1.1 Confirm clean working tree and create the scratch directory
    - Run `git status --porcelain` and require empty output, so "uncommitted changes" always means "the current step's work"
    - Create `/tmp/flaps-housekeeping/`
    - _Requirements: 3.2_

  - [x] 1.2 Capture the file and test inventories
    - Write `git ls-files | sort` to `/tmp/flaps-housekeeping/files.txt`
    - Run `npx vitest --run --reporter=json --outputFile=/tmp/flaps-housekeeping/tests.json`, then reduce it with the `node -e` script from the design into sorted `<file> :: <fullName> :: <status>` lines in `tests.txt`
    - Confirm every captured test id has status `passed` before treating the baseline as usable
    - **Establishes baselines for Property 1 and Property 2**
    - _Requirements: 3.2, 4.1_

  - [x] 1.3 Capture the interface and style-token inventories and open the removal log
    - Build `interface.json` from the grep inventories: HTTP route paths in `server.js`, Socket.IO event names with payload key sets in `server.js` and `public/app.js`, persisted session-state field names (`localStorage`/`sessionStorage` keys, `STATE_FILE` shape)
    - Build `css-tokens.txt`: live id/class/attribute vocabulary from `public/index.html` plus JS-produced class names, and the baseline `public/styles.css` selector list
    - Save the extractions as re-runnable scripts (`extract-interface.mjs`, `extract-css-tokens.mjs`) next to the manifests, so the Phase 4 and Phase 5 re-diffs are mechanical rather than retyped
    - Create `removals.md` with the removal-log table header, a retained-candidates table, and an empty Requirement 4 edit allowlist section
    - **Establishes baselines for Property 5 and Property 6**
    - _Requirements: 3.6, 2.6_

- [x] 2. Phase 1 — remove Analysis_Tooling and orphaned artifacts
  - [x] 2.1 Pre-check that nothing outside the directory references it
    - Run `rg -n "analysis-tools" --glob '!analysis-tools/**' --glob '!.kiro/specs/codebase-housekeeping/**' .` and require zero hits outside `.gitignore` and `package.json` devDeps (both handled in Phase 2)
    - Confirm `analysis-tools/` contains no file matching Vitest's `*.test.js` glob, so the test inventory cannot change
    - _Requirements: 1.1, 3.2_

  - [x] 2.2 Delete the `analysis-tools/` directory
    - `git rm -r analysis-tools`, including `reports/`, `integration-test.js`, and `test-infrastructure.js`
    - _Requirements: 1.1_

  - [x] 2.3 Delete the orphaned artifacts
    - `git rm .kiro/changes/changes.json`, and remove `.kiro/changes/` entirely if that was its only content
    - `rmdir .kiro/backups` (untracked and empty, so `git rm` does not apply)
    - _Requirements: 1.3_

  - [x] 2.4 Gate Phase 1 and commit
    - The gate's test run is already captured: `/tmp/flaps-housekeeping/gate1-tests.json` reports 186 total / 186 passed / 0 failed. Reduce it with the same `node -e` reducer as task 1.2 into `gate1-tests.txt`, then `diff /tmp/flaps-housekeeping/tests.txt /tmp/flaps-housekeeping/gate1-tests.txt` and require empty output. Re-run `npm test` first if the working tree has moved since that capture
    - Diff `git ls-files` against `files.txt` and require that every missing path is under `analysis-tools/` or is `.kiro/changes/changes.json`, with no added paths. `.kiro/backups/` and the now-empty `.kiro/changes/` are untracked directories, so they correctly produce no line in this diff — confirm their absence with a filesystem check instead
    - Commit the staged deletions as the Phase 1 commit, then confirm `git status --porcelain` is clean apart from this spec's own files
    - **Verifies Property 1 and Property 2**
    - _Requirements: 1.1, 1.2, 1.3, 3.2, 4.1_

- [x] 3. Phase 2 — config hygiene
  - [x] 3.1 Update `package.json`
    - Remove `@babel/generator` and `@babel/parser` from `devDependencies`, leaving `fast-check`, `jsdom`, `socket.io-client`, `vitest`; `dependencies` (`compression`, `express`, `socket.io`) is unchanged and all three are imported by `server.js`
    - Add `"engines": { "node": ">=20.19.0" }`, the floor derived from Vitest 4 and jsdom 29 requiring `^20.19.0 || >=22.12.0`
    - Verify no entry in `scripts` references a path under `analysis-tools/` — confirmed to be `"start": "node server.js"` and `"test": "vitest --run"`, so this is a check, not an edit
    - **Verifies Property 7**
    - _Requirements: 1.4, 1.7_

  - [x] 3.2 Update `.gitignore`
    - Remove the two-line stanza `# Generated analysis output` / `analysis-tools/reports/`, and the blank line it leaves behind
    - Leave every other entry intact (`node_modules/`, `.DS_Store`, `**/.DS_Store`, `*.log`, `.env`, `.env.local`, `coverage/`, `.vite-temp/`, and the `.rooms-state.json` runtime-state entry with its comment)
    - Confirm `rg -n "analysis-tools" .gitignore` returns nothing
    - _Requirements: 1.6_

  - [x] 3.3 Regenerate and validate the lockfile
    - Run `npm install` to regenerate `package-lock.json` from the updated manifest (not `npm ci`, which validates against the stale lockfile and would fail)
    - Confirm the lockfile diff drops the `@babel/*` trees and adds nothing beyond the `engines` echo
    - Run `npm ci` and require exit 0 with no lockfile-mismatch error; on mismatch, re-run `npm install`, commit the lockfile, and retry
    - _Requirements: 1.5_

  - [x] 3.4 Gate Phase 2 and commit
    - Run `npm test`; require an empty test-inventory diff against baseline. `npm ci` reinstalls `node_modules`, so run the suite after it, not before
    - Confirm every remaining `dependencies`/`devDependencies` entry is imported by a retained file or required by a retained tool config (`vitest.config.js` for `vitest`/`jsdom`, the `*.pbt.test.js` files for `fast-check`, the integration tests for `socket.io-client`)
    - **Verifies Property 2 and Property 7**
    - _Requirements: 1.4, 1.5, 3.2_

- [x] 4. Phase 3 — documentation
  - [x] 4.1 Delete the abandoned spec folders
    - Three of the five contain a tracked `.config.kiro` and nothing else — `git rm -r .kiro/specs/codebase-cleanup-analysis .kiro/specs/codebase-optimization .kiro/specs/https-support`
    - Two are empty and entirely untracked, so `git rm -r` has nothing to remove and will error — use `rmdir .kiro/specs/bold-section-titles .kiro/specs/story-queue-ui-fixes`
    - Expected tracked-file effect: exactly three removed paths, one `.config.kiro` per tracked folder
    - _Requirements: 5.1_

  - [x] 4.2 Verify the preserved specs are untouched
    - Run `git diff --stat HEAD -- .kiro/specs/clear-revote-finalized-story .kiro/specs/create-join-flow-overhaul .kiro/specs/session-persistence-on-tab-inactive` and require empty output
    - `.kiro/specs/codebase-housekeeping/` is exempt from the diff check because this cleanup updates its own `tasks.md`; confirm instead that only `tasks.md` changed within it
    - **Verifies Property 1 for the Preserved_Spec paths**
    - _Requirements: 5.2_

  - [x] 4.3 Add the root `README.md`
    - Sections per the design's content plan: what FLAPS is (Express + Socket.IO planning-poker server with a vanilla ESM browser client); Node.js 20.19 or later, matching the `engines` field added in 3.1; `npm install`; `npm start` then `http://localhost:3000`, noting the `PORT` environment variable override (`const PORT = process.env.PORT || 3000` in the `isMainModule` block of `server.js`); `npm test` (Vitest, single run); a short layout table covering `server.js`, `public/`, and the colocated `*.test.js` files
    - Document only `npm install`, `npm start`, and `npm test` — no `npm run <custom>` command, because none exists
    - _Requirements: 5.3, 5.4, 5.6_

  - [x] 4.4 Verify the documented commands
    - Check each command shown in `README.md` is either an npm built-in or a key in `package.json` `scripts`
    - Check the README states the start command, the test command, the Node version floor, and the default URL
    - **Verifies Property 8**
    - _Requirements: 5.3, 5.4, 5.6_

  - [x] 4.5 Gate Phase 3 and commit
    - Run `npm test`; require an empty test-inventory diff against baseline
    - Diff `git ls-files` against `files.txt`: the only added path so far must be `README.md`, and the only removals the Phase 1 set plus the three `.config.kiro` files
    - **Verifies Property 1 and Property 2**
    - _Requirements: 3.2, 5.1, 5.2_

- [x] 5. Checkpoint — pre-source-edit baseline
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm Phases 1–3 are committed green before any Application_Source edit begins.

- [ ] 6. Phase 4a — dead code removal, lowest-risk categories
  - [x] 6.1 Remove unused imports
    - Scan `rg -n "^import " server.js public/*.js`; for each named/default binding count non-import references in the same file. `server.js`'s eight are `express`, `compression`, `http`, `fs`, `path`, `fileURLToPath`, `Server`, `applyRevote` — check each individually
    - Never remove side-effect-only imports (`import './x.js'`)
    - Apply the retention signals (dynamic access, string-literal name, `index.html` reference, Test_Suite reference, `server.js` export block); log each removal with its evidence in `removals.md`; edit; run the dangling-reference scan over Application_Source, `public/index.html`, and the Test_Suite; run `npm test` and diff the inventory; commit
    - **Verifies Property 2, Property 3, Property 4**
    - _Requirements: 2.1, 2.4, 2.5, 3.2_

  - [x] 6.2 Remove commented-out code blocks
    - Scan `rg -n "^\s*// *(const|let|function|if|return|socket|await|document)" server.js public/*.js` and `rg -n "/\*" server.js public/*.js`
    - Remove commented-out code; retain explanatory prose. Named keepers in `server.js`: the persistence-rationale block above the state-file code (the moderatorKey/restart narrative), the `isMainModule` testability-guard explanation, the "Exported for testing" note above the `export { ... }` block, the pure-core comment above the `applyRevote` import, and the security-header comments in the middleware
    - Delete or correct any comment that describes a symbol removed in this phase (Requirement 5.5)
    - Log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3**
    - _Requirements: 2.1, 3.2, 5.5_

  - [ ] 6.3 Remove leftover debug logging
    - Scan `rg -n "console\.(log|debug|dir|trace)" server.js public/*.js`
    - Retain intentional operational logging (startup, error paths, shutdown); remove transient traces (logs in render loops, payload dumps, bare-label messages)
    - Pre-check whether any test asserts on console output or stubs `console`; if so, retain the log rather than editing the test
    - Log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3**
    - _Requirements: 2.1, 3.2, 4.3_

- [ ] 7. Checkpoint — after low-risk source edits
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm the test inventory is still identical to baseline before starting symbol-level removal.

- [ ] 8. Phase 4b — dead code removal, symbol level
  - [ ] 8.1 Remove unused exports
    - `server.js` exports 22 names (`io`, `rooms`, `ROOM_IDLE_TIMEOUT`, `CLEANUP_INTERVAL`, `DISCONNECT_GRACE_MS`, `getOrCreateRoom`, `isModerator`, `getUserKey`, `makeRoomState`, the nine `handle*` handlers, `handleDisconnect`, `startRoomCleanup`, `stopRoomCleanup`); `public/session-identity.js` exports 11, `public/session-machine.js` 4, `public/story-revote.js` 5. For each, run `rg -n "\bsymbolName\b" .` and retain if any hit is outside the defining file
    - Treat `story-revote.js` as dual-consumer (imported by `server.js` and served to the browser); treat the `server.js` export block as test surface, so a test-only consumer is a retention signal, not a removal candidate
    - Note that no test imports `public/app.js` bindings (jsdom tests load it for side effects only)
    - Test files that export their own helpers (`public/story-revote.pbt.test.js` exports shared fast-check arbitraries consumed by sibling tests) are Test_Suite, not Application_Source, so they are out of scope for Requirement 2 removal
    - Log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 4**
    - _Requirements: 2.1, 2.4, 2.5, 3.2_

  - [ ] 8.2 Remove unused local functions, iterating to a fixed point
    - Enumerate declarations with `rg -n "^(async )?function \w+|^const \w+ = (async )?\(|^const \w+ = (async )?function" public/app.js` (and `server.js`), then `rg -c "\bname\b"` per candidate; a count of 1 means declaration-only
    - Before removing, confirm the name is not used as a string, not attached to `window`, and not passed by reference from `index.html`
    - Re-run the scan after each removal until no new candidates appear, since removing a function can orphan its helpers
    - Log each removal with evidence; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 4**
    - _Requirements: 2.1, 2.4, 2.5, 3.2_

  - [ ] 8.3 Remove unused variables and constants
    - Apply the reference-count technique to module-scope `const`/`let` and clearly local declarations inside long functions
    - Retain constants used only inside template literals; re-check constants whose sole use was removed in 6.x or 8.2; leave destructured bindings alone unless the whole statement is dead
    - Frozen vocabulary objects (`STATES`, `EVENTS`, `REVOTE_REASONS`) are protocol surface: check their individual keys against `interface.json` before touching any member, and do not thin them on a reference count alone
    - Log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3**
    - _Requirements: 2.1, 3.2_

  - [ ] 8.4 Consolidate Redundant_Helper definitions
    - Identify functions in the same file or module scope with identical logic; keep the surviving definition in the file where its call sites live and route all call sites to it
    - Keep `server.js` and `public/app.js` as single modules; move no code between files. In particular, do not "consolidate" a `public/app.js` helper into `public/session-identity.js` or `public/story-revote.js` — that is module restructuring, which Requirement 2.3 excludes
    - Log the consolidation in `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 6**
    - _Requirements: 2.2, 2.3, 3.2, 3.6_

- [ ] 9. Phase 4c — dead code removal, DOM, CSS, and legacy branches
  - [ ] 9.1 Remove handlers bound to non-existent DOM elements
    - Scan `rg -o "getElementById\(\s*[\"'][^\"']+|querySelector(All)?\(\s*[\"'][^\"']+" public/app.js`; check each id against `public/index.html`
    - Retain lookups for runtime-created elements (`createElement` plus an `id =` assignment) and ids assembled from template literals such as `` `story-${id}` ``
    - Remove the lookup together with its handler when the wiring is genuinely dead; log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 4**
    - _Requirements: 2.1, 2.5, 3.2_

  - [ ] 9.2 Remove unreferenced CSS selectors
    - Re-run `extract-css-tokens.mjs` to rebuild the live token vocabulary (markup ids/classes, `classList.add|remove|toggle` and `className` literals, template-literal class names) against the post-9.1 sources, then subtract from the `public/styles.css` selector list
    - Remove a selector only when none of its tokens appears in the live vocabulary; retain pseudo-classes, media queries, keyframes, `:root` custom properties (check `rg -c "var(--name)"` first), and any dynamically assembled class; bias toward retention
    - Log to `removals.md`; edit; re-run the extractor and diff the surviving selector list against `css-tokens.txt` to confirm every live token kept its rules; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 5**
    - _Requirements: 2.1, 2.6, 3.2_

  - [ ] 9.3 Remove unreachable legacy compatibility branches
    - Candidates: type guards for shapes the current protocol cannot produce, fallbacks for always-populated fields, `payload.oldName || payload.newName` compatibility reads
    - Require positive evidence from the other side of the wire (the emitting site in `server.js` for a client branch, the client emit for a server branch) recorded in `removals.md`; retain the branch absent that evidence
    - Retain defensive checks on user input, `localStorage`/`sessionStorage` contents (the `safeLocal*`/`safeSession*` try/catch wrappers in `session-identity.js` are deliberate, not legacy), reconnect payloads, and the `ack` arity checks (`typeof ack === "function"`) that guard optional Socket.IO acknowledgements
    - Edit; dangling-reference scan; re-run `extract-interface.mjs` and diff against `interface.json`; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 6**
    - _Requirements: 2.1, 3.1, 3.6, 3.2_

- [ ] 10. Phase 5 — final verification
  - [ ] 10.1 Run the full gate
    - Run `npm test`; regenerate the test inventory and require the diff against `tests.txt` to be empty modulo the Requirement 4 edit allowlist in `removals.md`
    - Require the run to report 186 tests, all `passed`, unless the allowlist accounts for the difference
    - Treat a gained or lost test id as red even when all tests pass
    - **Verifies Property 2**
    - _Requirements: 3.4, 4.1, 4.3, 4.5_

  - [ ] 10.2 Re-diff the interface and file manifests
    - Re-run `extract-interface.mjs` (HTTP routes, Socket.IO event names with payload key sets, persisted field names) and diff against `interface.json`; require every pre-cleanup name present in the same role with the same payload key set
    - Diff final `git ls-files` against `files.txt`: removals must be exactly `analysis-tools/**`, `.kiro/changes/changes.json`, and the three tracked Abandoned_Spec `.config.kiro` files (`codebase-cleanup-analysis`, `codebase-optimization`, `https-support`); the two empty Abandoned_Spec folders (`bold-section-titles`, `story-queue-ui-fixes`) were untracked, so confirm their absence on the filesystem instead. The only addition is `README.md`
    - Against the pre-Phase-0 manifest `files.pre-repro-delete.txt` the removal list is that same set plus `public/repro-highlight.test.js`; `files.txt` was re-captured after that deletion, so the file does not appear in the primary diff
    - **Verifies Property 1 and Property 6**
    - _Requirements: 1.1, 1.2, 1.3, 2.3, 3.6, 5.1_

  - [ ] 10.3 Run the `npm start` smoke check
    - Start the server on a non-default port to avoid colliding with any instance already running (`PORT=3100 npm start` in the background), `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3100/` expecting 200, confirm the app shell is present in the response body (`curl -sS http://localhost:3100/ | rg -c "<div id="`), then stop the server
    - Require no unhandled error in the server output
    - _Requirements: 3.5_

  - [ ] 10.4 Manual review of the completeness and diff-shape claims
    - Review Application_Source against `removals.md` for remaining Dead_Code, retaining and noting anything uncertain (scope is MODERATE)
    - Review every test-file hunk in the full diff and confirm each touched only assertions naming removed code, with no merging, splitting, or reorganization of test files
    - Confirm the retained-candidates table in `removals.md` records each vetoed removal with the retention signal that fired
    - _Requirements: 2.1, 4.2, 4.4_

- [ ] 11. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm the working tree is committed and the gate is green.

## Notes

- No task creates a new test file. Verification is the existing Vitest suite plus the shell/`node -e` invariant checks, so Properties 1–8 are checked by enumeration at the gates rather than by generated tests.
- Verification sub-steps are not marked optional: Requirement 3.2 makes a green gate a precondition for the next removal step, so skipping one invalidates the phase that follows.
- A test reference is a retention signal. When a removal candidate is named by a test, reconsider the removal before editing the test; if the removal stands, make the smallest edit and append it to the Requirement 4 edit allowlist in `removals.md`.
- `public/repro-highlight.test.js` was deleted during Phase 0 by user decision: it was a failing abandoned bug-reproduction artifact (failing at the baseline commit, with leftover `console.log` traces and no fix ever made), so Requirement 4.1's retention guarantee — which covers tests that pass both before and after the cleanup — does not apply to it. The Phase 0 baseline was re-captured from the post-deletion tree and is therefore all-passing (186 tests, `npm test` exit 0), with the pre-deletion manifests preserved as `files.pre-repro-delete.txt` / `tests.pre-repro-delete.txt` and the deletion recorded in the Requirement 4 edit allowlist in `removals.md`.
- Manifests and their re-extractors currently in `/tmp/flaps-housekeeping/`: `files.txt`, `files.pre-repro-delete.txt`, `tests.txt` / `tests.json`, `tests.pre-repro-delete.txt`, `interface.json`, `css-tokens.txt`, `removals.md`, `extract-interface.mjs`, `extract-css-tokens.mjs`, plus the Phase 1 gate capture `gate1-tests.json` / `gate1-stdout.txt`. `/tmp` does not survive a reboot; if the manifests are gone, re-run task 1.2/1.3 against the last green commit before continuing.
- Recovery from a red gate: `git checkout -- <touched paths>`, re-run the gate to confirm green, then retry with a narrower removal set.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4"] },
    { "id": 5, "tasks": ["3.1", "3.2"] },
    { "id": 6, "tasks": ["3.3"] },
    { "id": 7, "tasks": ["3.4"] },
    { "id": 8, "tasks": ["4.1", "4.3"] },
    { "id": 9, "tasks": ["4.2", "4.4"] },
    { "id": 10, "tasks": ["4.5"] },
    { "id": 11, "tasks": ["6.1"] },
    { "id": 12, "tasks": ["6.2"] },
    { "id": 13, "tasks": ["6.3"] },
    { "id": 14, "tasks": ["8.1"] },
    { "id": 15, "tasks": ["8.2"] },
    { "id": 16, "tasks": ["8.3"] },
    { "id": 17, "tasks": ["8.4"] },
    { "id": 18, "tasks": ["9.1"] },
    { "id": 19, "tasks": ["9.2"] },
    { "id": 20, "tasks": ["9.3"] },
    { "id": 21, "tasks": ["10.1"] },
    { "id": 22, "tasks": ["10.2", "10.3"] },
    { "id": 23, "tasks": ["10.4"] }
  ]
}
```
