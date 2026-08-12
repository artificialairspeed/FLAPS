# Implementation Plan: Codebase Housekeeping

## Overview

Behavior-preserving cleanup executed as the risk-ordered pipeline from the design: baseline capture → tooling removal → config hygiene → documentation → dead code removal by category → final verification. Language is JavaScript (ESM) plus shell; no new source modules and no new test files are created.

Every removal step ends with a verification gate: `npm test` plus a test-inventory `diff` against the Phase 0 baseline, per Requirement 3.2. A gate is green only when the inventory diff is empty (or every line is justified in the Requirement 4 edit allowlist in `removals.md`). Manifests live in `/tmp/flaps-housekeeping/` so the cleanup adds no tracked artifacts. Git is the rollback mechanism: one commit per step, `git checkout -- <paths>` to discard a red step.

Property numbers below refer to the Correctness Properties in `design.md`. They are checked by enumeration with shell/`node -e` one-liners at the gates, not by generated tests.

## Tasks

- [ ] 1. Phase 0 — baseline manifest capture
  - [x] 1.1 Confirm clean working tree and create the scratch directory
    - Run `git status --porcelain` and require empty output, so "uncommitted changes" always means "the current step's work"
    - Create `/tmp/flaps-housekeeping/`
    - _Requirements: 3.2_

  - [-] 1.2 Capture the file and test inventories
    - Write `git ls-files | sort` to `/tmp/flaps-housekeeping/files.txt`
    - Run `npx vitest --run --reporter=json --outputFile=/tmp/flaps-housekeeping/tests.json`, then reduce it with the `node -e` script from the design into sorted `<file> :: <fullName> :: <status>` lines in `tests.txt`
    - Confirm every captured test id has status `passed` before treating the baseline as usable
    - **Establishes baselines for Property 1 and Property 2**
    - _Requirements: 3.2, 4.1_

  - [-] 1.3 Capture the interface and style-token inventories and open the removal log
    - Build `interface.json` from the grep inventories: HTTP route paths in `server.js`, Socket.IO event names with payload key sets in `server.js` and `public/app.js`, persisted session-state field names (`localStorage`/`sessionStorage` keys, `STATE_FILE` shape)
    - Build `css-tokens.txt`: live id/class/attribute vocabulary from `public/index.html` plus JS-produced class names, and the baseline `public/styles.css` selector list
    - Create `removals.md` with the removal-log table header and an empty Requirement 4 edit allowlist section
    - **Establishes baselines for Property 5 and Property 6**
    - _Requirements: 3.6, 2.6_

- [ ] 2. Phase 1 — remove Analysis_Tooling and orphaned artifacts
  - [~] 2.1 Pre-check that nothing outside the directory references it
    - Run `rg -n "analysis-tools" --glob '!analysis-tools/**' --glob '!.kiro/specs/codebase-housekeeping/**' .` and require zero hits outside `.gitignore` and `package.json` devDeps (both handled in Phase 2)
    - Confirm `analysis-tools/` contains no file matching Vitest's `*.test.js` glob, so the test inventory cannot change
    - _Requirements: 1.1, 3.2_

  - [~] 2.2 Delete the `analysis-tools/` directory
    - `git rm -r analysis-tools`, including `reports/`, `integration-test.js`, and `test-infrastructure.js`
    - _Requirements: 1.1_

  - [~] 2.3 Delete the orphaned artifacts
    - `git rm .kiro/changes/changes.json`, and remove `.kiro/changes/` entirely if that was its only content
    - `rmdir .kiro/backups` (untracked and empty, so `git rm` does not apply)
    - _Requirements: 1.3_

  - [~] 2.4 Gate Phase 1 and commit
    - Run `npm test`; diff the regenerated test inventory against `tests.txt` and require an empty diff
    - Diff `git ls-files` against `files.txt` and require that every missing path is under `analysis-tools/` or is `.kiro/changes/changes.json`, with no added paths
    - **Verifies Property 1 and Property 2**
    - _Requirements: 1.1, 1.2, 1.3, 3.2, 4.1_

- [ ] 3. Phase 2 — config hygiene
  - [~] 3.1 Update `package.json`
    - Remove `@babel/parser` and `@babel/generator` from `devDependencies`
    - Add `"engines": { "node": ">=20.19.0" }`, the floor derived from Vitest 4 and jsdom 29 requiring `^20.19.0 || >=22.12.0`
    - Verify no entry in `scripts` references a path under `analysis-tools/` (expected: `start` and `test` already clean, so this is a check, not an edit)
    - **Verifies Property 7**
    - _Requirements: 1.4, 1.7_

  - [~] 3.2 Update `.gitignore`
    - Remove the `# Generated analysis output` / `analysis-tools/reports/` stanza
    - Confirm no remaining entry references `analysis-tools/`
    - _Requirements: 1.6_

  - [~] 3.3 Regenerate and validate the lockfile
    - Run `npm install` to regenerate `package-lock.json` from the updated manifest (not `npm ci`, which validates against the stale lockfile and would fail)
    - Run `npm ci` and require exit 0 with no lockfile-mismatch error; on mismatch, re-run `npm install`, commit the lockfile, and retry
    - _Requirements: 1.5_

  - [~] 3.4 Gate Phase 2 and commit
    - Run `npm test`; require an empty test-inventory diff against baseline
    - Confirm every remaining `dependencies`/`devDependencies` entry is imported by a retained file or required by a retained tool config
    - **Verifies Property 2 and Property 7**
    - _Requirements: 1.4, 1.5, 3.2_

- [ ] 4. Phase 3 — documentation
  - [~] 4.1 Delete the abandoned spec folders
    - `git rm -r` the five Abandoned_Spec folders: `bold-section-titles`, `story-queue-ui-fixes`, `codebase-cleanup-analysis`, `codebase-optimization`, `https-support`
    - _Requirements: 5.1_

  - [~] 4.2 Verify the preserved specs are untouched
    - Run `git diff --stat HEAD -- .kiro/specs/clear-revote-finalized-story .kiro/specs/create-join-flow-overhaul .kiro/specs/session-persistence-on-tab-inactive .kiro/specs/codebase-housekeeping` and require empty output
    - **Verifies Property 1 for the Preserved_Spec paths**
    - _Requirements: 5.2_

  - [~] 4.3 Add the root `README.md`
    - Sections per the design's content plan: what FLAPS is (Express + Socket.IO planning-poker server with a vanilla ESM browser client); Node.js 20.19 or later, matching the `engines` field; `npm install`; `npm start` then `http://localhost:3000` with the `PORT` environment variable override read from `server.js`; `npm test` (Vitest, single run); a short layout table covering `server.js`, `public/`, and the colocated `*.test.js` files
    - Document only `npm install`, `npm start`, and `npm test` — no `npm run <custom>` command, because none exists
    - _Requirements: 5.3, 5.4, 5.6_

  - [~] 4.4 Verify the documented commands
    - Check each command shown in `README.md` is either an npm built-in or a key in `package.json` `scripts`
    - Check the README states the start command, the test command, the Node version floor, and the default URL
    - **Verifies Property 8**
    - _Requirements: 5.3, 5.4, 5.6_

  - [~] 4.5 Gate Phase 3 and commit
    - Run `npm test`; require an empty test-inventory diff against baseline
    - Diff `git ls-files` against `files.txt`: the only added path so far must be `README.md`
    - **Verifies Property 1 and Property 2**
    - _Requirements: 3.2, 5.1, 5.2_

- [~] 5. Checkpoint — pre-source-edit baseline
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm Phases 1–3 are committed green before any Application_Source edit begins.

- [ ] 6. Phase 4a — dead code removal, lowest-risk categories
  - [~] 6.1 Remove unused imports
    - Scan `rg -n "^import " server.js public/*.js`; for each named/default binding count non-import references in the same file; check `fs`, `path`, `http`, `fileURLToPath`, `express`, `compression`, `Server`, `applyRevote` individually
    - Never remove side-effect-only imports (`import './x.js'`)
    - Apply the retention signals (dynamic access, string-literal name, `index.html` reference, Test_Suite reference, `server.js` export block); log each removal with its evidence in `removals.md`; edit; run the dangling-reference scan over Application_Source, `public/index.html`, and the Test_Suite; run `npm test` and diff the inventory; commit
    - **Verifies Property 2, Property 3, Property 4**
    - _Requirements: 2.1, 2.4, 2.5, 3.2_

  - [~] 6.2 Remove commented-out code blocks
    - Scan `rg -n "^\s*// *(const|let|function|if|return|socket|await|document)" server.js public/*.js` and `rg -n "/\*" server.js public/*.js`
    - Remove commented-out code; retain explanatory prose (the persistence rationale block in `server.js`, the `isMainModule` explanation, the test harness notes)
    - Delete or correct any comment that describes a symbol removed in this phase (Requirement 5.5)
    - Log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3**
    - _Requirements: 2.1, 3.2, 5.5_

  - [~] 6.3 Remove leftover debug logging
    - Scan `rg -n "console\.(log|debug|dir|trace)" server.js public/*.js`
    - Retain intentional operational logging (startup, error paths, shutdown); remove transient traces (logs in render loops, payload dumps, bare-label messages)
    - Pre-check whether any test asserts on console output; if so, retain the log rather than editing the test
    - Log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3**
    - _Requirements: 2.1, 3.2, 4.3_

- [~] 7. Checkpoint — after low-risk source edits
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm the test inventory is still identical to baseline before starting symbol-level removal.

- [ ] 8. Phase 4b — dead code removal, symbol level
  - [~] 8.1 Remove unused exports
    - For each name in `server.js`'s `export { ... }` block and in `public/session-identity.js`, `session-machine.js`, `story-revote.js`, run `rg -n "\bsymbolName\b" .` and retain if any hit is outside the defining file
    - Treat `story-revote.js` as dual-consumer (imported by `server.js` and served to the browser); treat the `server.js` export block as test surface
    - Note that no test imports `public/app.js` bindings (jsdom tests load it for side effects only)
    - Log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 4**
    - _Requirements: 2.1, 2.4, 2.5, 3.2_

  - [~] 8.2 Remove unused local functions, iterating to a fixed point
    - Enumerate declarations with `rg -n "^(async )?function \w+|^const \w+ = (async )?\(|^const \w+ = (async )?function" public/app.js` (and `server.js`), then `rg -c "\bname\b"` per candidate; a count of 1 means declaration-only
    - Before removing, confirm the name is not used as a string, not attached to `window`, and not passed by reference from `index.html`
    - Re-run the scan after each removal until no new candidates appear, since removing a function can orphan its helpers
    - Log each removal with evidence; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 4**
    - _Requirements: 2.1, 2.4, 2.5, 3.2_

  - [~] 8.3 Remove unused variables and constants
    - Apply the reference-count technique to module-scope `const`/`let` and clearly local declarations inside long functions
    - Retain constants used only inside template literals; re-check constants whose sole use was removed in 6.x or 8.2; leave destructured bindings alone unless the whole statement is dead
    - Log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3**
    - _Requirements: 2.1, 3.2_

  - [~] 8.4 Consolidate Redundant_Helper definitions
    - Identify functions in the same file or module scope with identical logic; keep the surviving definition in the file where its call sites live and route all call sites to it
    - Keep `server.js` and `public/app.js` as single modules; move no code between files
    - Log the consolidation in `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 6**
    - _Requirements: 2.2, 2.3, 3.2, 3.6_

- [ ] 9. Phase 4c — dead code removal, DOM, CSS, and legacy branches
  - [~] 9.1 Remove handlers bound to non-existent DOM elements
    - Scan `rg -o "getElementById\(\s*[\"'][^\"']+|querySelector(All)?\(\s*[\"'][^\"']+" public/app.js`; check each id against `public/index.html`
    - Retain lookups for runtime-created elements (`createElement` plus an `id =` assignment) and ids assembled from template literals such as `` `story-${id}` ``
    - Remove the lookup together with its handler when the wiring is genuinely dead; log to `removals.md`; edit; dangling-reference scan; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 4**
    - _Requirements: 2.1, 2.5, 3.2_

  - [~] 9.2 Remove unreferenced CSS selectors
    - Build the live token vocabulary (markup ids/classes, `classList.add|remove|toggle` and `className` literals, template-literal class names), then subtract from the `public/styles.css` selector list
    - Remove a selector only when none of its tokens appears in the live vocabulary; retain pseudo-classes, media queries, keyframes, `:root` custom properties (check `rg -c "var(--name)"` first), and any dynamically assembled class; bias toward retention
    - Log to `removals.md`; edit; re-diff the surviving selector list against `css-tokens.txt` to confirm every live token kept its rules; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 5**
    - _Requirements: 2.1, 2.6, 3.2_

  - [~] 9.3 Remove unreachable legacy compatibility branches
    - Candidates: type guards for shapes the current protocol cannot produce, fallbacks for always-populated fields, `payload.oldName || payload.newName` compatibility reads
    - Require positive evidence from the other side of the wire (the emitting site in `server.js` for a client branch, the client emit for a server branch) recorded in `removals.md`; retain the branch absent that evidence
    - Retain defensive checks on user input, `localStorage` contents, and reconnect payloads regardless of apparent unreachability
    - Edit; dangling-reference scan; re-extract the interface inventory and diff against `interface.json`; `npm test`; inventory diff; commit
    - **Verifies Property 2, Property 3, Property 6**
    - _Requirements: 2.1, 3.1, 3.6, 3.2_

- [ ] 10. Phase 5 — final verification
  - [~] 10.1 Run the full gate
    - Run `npm test`; regenerate the test inventory and require the diff against `tests.txt` to be empty modulo the Requirement 4 edit allowlist in `removals.md`
    - Treat a gained or lost test id as red even when all tests pass
    - **Verifies Property 2**
    - _Requirements: 3.4, 4.1, 4.3, 4.5_

  - [~] 10.2 Re-diff the interface and file manifests
    - Re-run the HTTP route, Socket.IO event/payload, and persisted-field extractions and diff against `interface.json`; require every pre-cleanup name present in the same role with the same payload key set
    - Diff final `git ls-files` against `files.txt`: removals must be exactly `analysis-tools/**`, `.kiro/changes/changes.json`, the five Abandoned_Spec folders, and `public/repro-highlight.test.js`; the only addition is `README.md`
    - **Verifies Property 1 and Property 6**
    - _Requirements: 1.1, 1.2, 1.3, 2.3, 3.6, 5.1_

  - [~] 10.3 Run the `npm start` smoke check
    - Start the server, `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/` expecting 200, confirm the app shell is present in the response body, then stop the server
    - Require no unhandled error in the server output
    - _Requirements: 3.5_

  - [~] 10.4 Manual review of the completeness and diff-shape claims
    - Review Application_Source against `removals.md` for remaining Dead_Code, retaining and noting anything uncertain (scope is MODERATE)
    - Review every test-file hunk in the full diff and confirm each touched only assertions naming removed code, with no merging, splitting, or reorganization of test files
    - _Requirements: 2.1, 4.2, 4.4_

- [~] 11. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Confirm the working tree is committed and the gate is green.

## Notes

- No task creates a new test file. Verification is the existing Vitest suite plus the shell/`node -e` invariant checks, so Properties 1–8 are checked by enumeration at the gates rather than by generated tests.
- Verification sub-steps are not marked optional: Requirement 3.2 makes a green gate a precondition for the next removal step, so skipping one invalidates the phase that follows.
- A test reference is a retention signal. When a removal candidate is named by a test, reconsider the removal before editing the test; if the removal stands, make the smallest edit and append it to the Requirement 4 edit allowlist in `removals.md`.
- `public/repro-highlight.test.js` was deleted during Phase 0 by user decision: it was a failing abandoned bug-reproduction artifact (failing at the baseline commit, with leftover `console.log` traces and no fix ever made), so Requirement 4.1's retention guarantee — which covers tests that pass both before and after the cleanup — does not apply to it. The Phase 0 baseline was re-captured from the post-deletion tree and is therefore all-passing (186 tests, `npm test` exit 0), with the pre-deletion manifests preserved as `files.pre-repro-delete.txt` / `tests.pre-repro-delete.txt` and the deletion recorded in the Requirement 4 edit allowlist in `removals.md`.
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
