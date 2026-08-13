# Design Document

## Overview

This is a behavior-preserving cleanup, not a feature. There is no new runtime component and no new module in the shipped application. The "system" being designed is the **procedure**: an ordered sequence of removal steps, each fenced by a verification gate, plus the detection techniques used to find removal candidates and the invariant checks used to prove nothing else moved.

Two facts shape the whole design:

1. **The analyzers are being deleted, so they cannot be used.** `analysis-tools/` exists precisely to find unused exports, unreferenced CSS selectors, dead DOM handlers and duplicated helpers. Requirement 1 removes it. Requirement 2 then asks for exactly the findings those tools produced. The design therefore specifies a manual detection method per Dead_Code category using `grep`/`rg` plus targeted inspection, and treats the analyzers as unavailable from step one. (They are not run "one last time": their reports are stale generated artifacts, running them would reintroduce `analysis-tools/reports/` output, and their own executors — `dead-code-remover.js`, `execute-dead-code-cleanup.js` — perform automated edits that this cleanup deliberately does by hand.)

2. **The test suite is the behavioral oracle.** 23 colocated Vitest files, several driving the real `public/app.js` under jsdom via `await import('./app.js')` and the real server over Socket.IO, are the only mechanism that can detect a behavior change. Their value depends on the *set of passing tests* being identical before and after, which is why the procedure starts by capturing that set exactly rather than relying on "npm test was green".

Detected stack: JavaScript ESM (Node + Express + Socket.IO server, vanilla ESM browser modules, Vitest + fast-check + jsdom). Code examples below are JavaScript and shell.

## Architecture

### Risk-ordered pipeline

Steps run lowest-risk first, so the risky work (editing `server.js` and `public/app.js`) happens against a known-green, already-simplified baseline. Every arrow is a verification gate.

```
Phase 0  Baseline capture ......... no repository change; produces manifests
   |
Phase 1  Analysis_Tooling removal .. isolated directory delete + orphaned artifacts
   |                                 (zero references from runtime or tests)
Phase 2  Config hygiene ............ package.json deps, .gitignore, lockfile
   |
Phase 3  Documentation ............. abandoned specs deleted, README added
   |
Phase 4  Dead code removal ......... Application_Source, one category per step
   |                                 (the only phase that can change behavior)
Phase 5  Final verification ........ full gate + npm start smoke check
```

Rationale for the ordering:

- Phases 1–3 cannot change `Observable_Behavior` at all. `analysis-tools/` contains no `*.test.js` file (verified: only `integration-test.js` and `test-infrastructure.js`, neither matching Vitest's default `*.test.js` glob and neither imported by anything outside the directory), so deleting it does not change the test inventory either. That makes them safe warm-up steps that shrink the search space Phase 4 has to reason about.
- Phase 2 follows Phase 1 because `@babel/parser` and `@babel/generator` are only justified by files Phase 1 deletes. Removing the dependency first would leave the directory temporarily broken.
- Phase 3 precedes Phase 4 so that the README (a fixed deliverable) is not competing for attention with the judgment-heavy work, and so the abandoned-spec deletion is committed before any source edit.
- Phase 4 is subdivided by Dead_Code category rather than by file. Each category has a different detection method and a different false-positive profile, so keeping the gate boundary at the category level makes a failure immediately attributable.

### Rollback and checkpointing

Git is the rollback mechanism. There is no custom backup step, and `.kiro/backups/` (the old tooling's backup directory) is being deleted rather than reused.

- Each phase, and each category-step inside Phase 4, ends in its own commit with the gate green.
- Recovery from a red gate is `git checkout -- <touched paths>` (uncommitted work) or `git revert`/`git reset --hard HEAD` back to the last green commit, then re-run the gate to confirm green before retrying with a narrower removal.
- The working tree must be clean before Phase 0 so that "uncommitted changes" is always exactly "the current step's work".

## Data Models

### The baseline manifests

Phase 0 writes five manifests to a scratch directory **outside the repository** (`/tmp/flaps-housekeeping/`) so the cleanup adds no tracked artifacts of its own. Each is regenerated after a step and compared.

| Manifest | Content | Used by |
| --- | --- | --- |
| `files.txt` | `git ls-files` output, sorted | Property 1 |
| `tests.txt` | Every test id (file + full test name) reported by the suite, sorted | Property 2 |
| `interface.json` | HTTP route paths, Socket.IO event names with payload key sets, persisted session-state field names | Property 6 |
| `css-tokens.txt` | Live id/class/attribute vocabulary from `index.html` + JS-produced class names, and the baseline `styles.css` selector list | Property 5 |
| `removals.md` | Append-only removal log: one row per removed symbol/selector/block with file, identifier, and the evidence that it was unreferenced | Properties 3 and 4, and the Requirement 4.2 diff review |

Capture commands:

```bash
mkdir -p /tmp/flaps-housekeeping
git ls-files | sort > /tmp/flaps-housekeeping/files.txt

# Full test inventory, not just the pass/fail summary. Reporter output is parsed
# into "<file> :: <full test name>" lines so the comparison is exact.
npx vitest --run --reporter=json --outputFile=/tmp/flaps-housekeeping/tests.json
node -e "
  const r = JSON.parse(require('fs').readFileSync('/tmp/flaps-housekeeping/tests.json','utf8'));
  const ids = r.testResults.flatMap(f =>
    f.assertionResults.map(a => f.name.replace(process.cwd()+'/','') + ' :: ' + a.fullName + ' :: ' + a.status));
  require('fs').writeFileSync('/tmp/flaps-housekeeping/tests.txt', ids.sort().join('\n') + '\n');
"
```

The inventory is compared with `diff`, not eyeballed. A step is green only when `diff baseline/tests.txt current/tests.txt` is empty, or its every line is justified by an entry in the Requirement 4 edit allowlist (a short list appended to `removals.md`, one line per intentionally edited or deleted test case).

`interface.json` is built from grep inventories rather than by hand:

```bash
# HTTP routes
rg -o "app\.(get|post|put|delete|use)\(\s*[\"'][^\"']+" server.js
# Socket.IO event names (both directions, server and client)
rg -o "(socket|io|s)\.(on|emit|to\([^)]*\)\.emit)\(\s*[\"'][^\"']+" server.js public/app.js
# Persisted state field names
rg -o "(localStorage|sessionStorage)\.(get|set|remove)Item\(\s*[\"'][^\"']+" public/*.js
rg -n "STATE_FILE|JSON\.stringify\(" server.js
```

## Components and Interfaces

The procedure has two kinds of component: the **detection scanners** (one per Dead_Code category, each a grep technique plus a confirmation rule) and the **phase steps** that consume them. The interfaces that must not change are the application's external ones — HTTP routes, Socket.IO event names and payload shapes, persisted state field names — inventoried in `interface.json` and asserted by Property 6.

### Detection scanners: dead code without the analyzers

One subsection per Dead_Code category from the glossary. Each gives the search technique, the retention signals that veto a removal, and the false positives to expect. Nothing is removed on the strength of a single grep: every candidate is confirmed by reading its call sites.

**Retention signals (apply to every category).** A candidate is retained, no matter how dead it looks, if any of these hold:

- It is reached dynamically: `obj[name]`, `window[name]`, computed property access, `eval`, or a handler looked up from a map keyed by a string.
- Its name appears as a string literal anywhere — a Socket.IO event name, a `getElementById`/`querySelector` argument, a `localStorage`/`sessionStorage` key, a CSS class assembled in a template literal.
- It is referenced by `public/index.html` (an `id`, a `class`, an inline handler, a `<script>` src).
- It is imported, spied on, or named by any file in the Test_Suite — including the mirror tests (`bootstrap.pbt.test.js`, `join-guard.pbt.test.js`, `reconnect-payload.pbt.test.js`) whose comments name `public/app.js` functions they reimplement locally; those comments are documentation of intent and a removal that contradicts them needs justification in `removals.md`.
- It is part of the exported surface in `server.js`'s `export { ... }` block, which exists specifically for the tests.

#### 1. Unused exports

`server.js` ends in an explicit `export { ... }` block; `public/session-identity.js`, `session-machine.js` and `story-revote.js` export named bindings. For each exported name:

```bash
rg -n "\bsymbolName\b" --glob '!analysis-tools/**' .
```

Keep it if any hit is outside the defining file. `story-revote.js` is a special case: it is imported by `server.js` *and* served to the browser, so both consumers must be checked. Note that no test imports `public/app.js` bindings — every jsdom test loads it for its top-level side effects (`await import('./app.js')`) — so app.js has no export surface to audit, and conversely nothing in app.js is kept alive by an import.

#### 2. Unused local functions

Enumerate declarations per file, then count references:

```bash
rg -n "^(async )?function \w+|^const \w+ = (async )?\(|^const \w+ = (async )?function" public/app.js
rg -c "\bfunctionName\b" public/app.js   # 1 == declaration only == candidate
```

A count of 1 means the declaration is the only occurrence. Before removing, confirm the name is not used as a string (`rg "'functionName'"`), not attached to `window`, and not an event handler passed by reference from `index.html`. Removing a function may orphan its own helpers, so the scan is re-run after each removal until it reaches a fixed point.

#### 3. Unused variables and constants

Same reference-count technique, restricted to module-scope `const`/`let` and to obviously local declarations inside long functions. Two traps specific to this codebase: constants used only inside template literals still show up in the count (safe), and constants whose only use was in code removed earlier in this phase become candidates only on the re-scan. Destructured bindings (`const { a, b } = payload`) are left alone unless the whole statement is dead — trimming a destructure changes nothing observable but adds diff noise for no benefit.

#### 4. Unused imports

Cheap and near-zero risk, so this is the first step of Phase 4:

```bash
rg -n "^import " server.js public/*.js
```

For each named/default binding, count non-import references in the same file. `server.js` imports `fs`, `path`, `http`, `fileURLToPath`, `express`, `compression`, `Server`, `applyRevote` — each is checked individually. Side-effect-only imports (`import './x.js'`) are never removed.

#### 5. Unreferenced CSS selectors

Build the live token vocabulary first, then subtract:

```bash
# ids and classes present in the served markup
rg -o "id=\"[^\"]+\"|class=\"[^\"]+\"" public/index.html
# classes the JS creates or toggles at runtime
rg -o "classList\.(add|remove|toggle)\(\s*[\"'][^\"']+|className\s*=\s*[\"'][^\"']+|class=\\\\\"[^\"]+" public/*.js
# template-literal class names (highest-risk source of false positives)
rg -n "class=\\\$\{|\`[^\`]*class=" public/app.js
# selector list from the stylesheet
rg -o "^[.#][A-Za-z0-9_-]+" public/styles.css
```

A selector is removed only if none of its tokens appears in the live vocabulary. Pseudo-classes, media queries, `:root` custom properties, keyframes, and any selector whose class is assembled dynamically are retained. Custom properties (`--var`) are checked with `rg -c "var\(--name\)"` before removal, and `:root` is never emptied. Given that class names in this app are built inside template literals in `app.js`, the bias here is strongly toward retention: an unremoved rule costs nothing, a wrongly removed rule silently breaks rendering that no test asserts.

#### 6. Handlers bound to non-existent DOM elements

```bash
rg -o "getElementById\(\s*[\"'][^\"']+|querySelector(All)?\(\s*[\"'][^\"']+" public/app.js
```

For each id, check `rg -n "id=\"theId\"" public/index.html`. A miss means either dead wiring (remove the lookup and its handler) or a runtime-created element (search for `createElement` plus an `id =` assignment, and for ids assembled from template literals such as `` `story-${id}` `` — those are legitimate and stay). The jsdom tests inject the real `index.html` body, so a wrongly removed handler that any test drives will fail the gate immediately; handlers no test drives are the ones requiring manual care.

#### 7. Commented-out code blocks

```bash
rg -n "^\s*// *(const|let|function|if|return|socket|await|document)" server.js public/*.js
rg -n "/\*" server.js public/*.js
```

Distinguish commented-out *code* (removed) from explanatory prose (kept). This codebase has substantial, genuinely useful narrative comments — the persistence rationale block in `server.js`, the `isMainModule` explanation, the harness notes in the tests. Those stay. Requirement 5.5 also lands here: any comment that describes a symbol removed in this phase is deleted or corrected in the same step, which is why the dangling-reference scan (Property 3) greps raw file text rather than parsed code.

#### 8. Leftover debug logging

```bash
rg -n "console\.(log|debug|dir|trace)" server.js public/*.js
```

Intentional operational logging is kept (startup messages, error paths, shutdown). Removed: transient developer traces — logs inside render loops, logs printing payload dumps, logs whose message text is a bare label. If any test asserts on console output, the log stays; the gate would catch it, but a pre-check avoids the churn.

#### 9. Unreachable legacy compatibility branches

The judgment-heaviest category, and last in Phase 4. Candidates are branches guarding against shapes the current protocol cannot produce: `if (typeof x === 'string')` where `x` is now always an object, fallbacks for fields that are always populated, `payload.oldName || payload.newName` compatibility reads. Each candidate needs positive evidence from the other side of the wire — the emitting site in `server.js` for a client-side branch, the client emit for a server-side branch — recorded in `removals.md`. Absent that evidence the branch is retained. Defensive checks on user input, on `localStorage` contents, and on reconnect payloads are not legacy branches and are retained regardless of how unreachable they look from the happy path.

### Phase execution

#### Phase 1: Analysis_Tooling and orphaned artifacts

```bash
git rm -r analysis-tools
git rm .kiro/changes/changes.json
rmdir .kiro/backups 2>/dev/null || true   # empty; untracked, so git rm does not apply
```

Pre-check that nothing outside the directory references it (expected: zero hits):

```bash
rg -n "analysis-tools" --glob '!analysis-tools/**' --glob '!.kiro/specs/codebase-housekeeping/**' .
```

`.kiro/changes/` is removed entirely if `changes.json` was its only content. Gate: `npm test` inventory identical to baseline.

#### Phase 2: Config hygiene

- Remove `@babel/generator` and `@babel/parser` from `devDependencies`.
- Add an `engines` field. Requirement 5.4 needs a Node version to state in the README, and `package.json` currently declares none, so the floor is derived from the installed toolchain's own constraints rather than invented: Vitest 4 and jsdom 29 both require `^20.19.0 || >=22.12.0`, and the development machine runs v26.2.0. The design records `>=20.19.0` as the floor and the README states it. `engines` is advisory in npm by default, so adding it cannot break an existing install.

```json
{
  "engines": { "node": ">=20.19.0" },
  "scripts": { "start": "node server.js", "test": "vitest --run" }
}
```

- Remove the `# Generated analysis output` / `analysis-tools/reports/` stanza from `.gitignore`.
- Regenerate the lockfile with `npm install` (not `npm ci`, which validates against the old lockfile and would fail), then confirm with `npm ci`.
- Scripts need no change: neither `start` nor `test` references `analysis-tools/`. Verified for Requirement 1.7 rather than edited.

Gate: `npm test` inventory identical, plus `npm ci` exits 0.

#### Phase 3: Documentation

Delete the five Abandoned_Spec folders (`bold-section-titles`, `story-queue-ui-fixes`, `codebase-cleanup-analysis`, `codebase-optimization`, `https-support`) with `git rm -r`. Touch nothing under the four Preserved_Spec folders — verified by `git diff --stat` over those paths being empty.

Add `README.md` at the repository root. Content plan, mapped to Requirement 5:

| Section | Content | Satisfies |
| --- | --- | --- |
| What it is | One paragraph: FLAPS is a planning-poker / story-estimation app; Express + Socket.IO server, vanilla ESM browser client | context |
| Requirements | Node.js 20.19 or later (matches the `engines` field) | 5.4 |
| Install | `npm install` | — |
| Run | `npm start`, then open `http://localhost:3000` (default port 3000, overridable with the `PORT` environment variable — read from `server.js`) | 5.3, 5.4 |
| Test | `npm test` (Vitest, single run) | 5.4 |
| Layout | Short table: `server.js`, `public/`, colocated `*.test.js` | context |

The README names only `npm install`, `npm start` and `npm test`. `start` and `test` are both defined in `scripts`; `install` is an npm built-in, not a project command, so Requirement 5.6 holds. No `npm run <custom>` command is documented, because none exists.

Gate: `npm test` inventory identical.

#### Phase 4: Dead code removal

One commit per category, in this order — ascending risk, and each earlier step shrinks the noise the later scans see:

1. Unused imports (category 4)
2. Commented-out code blocks (category 7)
3. Debug logging (category 8)
4. Unused exports (category 1)
5. Unused local functions, to a fixed point (category 2)
6. Unused variables and constants (category 3)
7. Redundant helper consolidation (Requirement 2.2)
8. Handlers on non-existent elements (category 6)
9. Unreferenced CSS selectors (category 5)
10. Unreachable legacy branches (category 9)

Each step: scan → confirm candidates by reading call sites → record in `removals.md` → edit → dangling-reference scan (Property 3) → `npm test` → inventory diff → commit. `server.js` and `public/app.js` stay single modules; no code moves between files, and consolidation of a Redundant_Helper keeps the surviving definition in the file where its call sites live.

Requirement 4 handling: a test edit is permitted only when a test references a symbol removed in this phase. The preferred response is to reconsider the removal — a test reference is a retention signal. If the removal stands (e.g. the test asserted a debug log), the smallest possible edit is made, only the assertions naming the removed symbol are touched, and the change is appended to the edit allowlist so the inventory diff stays justified. No test file is merged, split, or reorganized.

#### Phase 5: Final verification

```bash
npm test                      # full gate, inventory diff empty modulo allowlist
npm start &                   # smoke check
curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/   # expect 200
curl -sS http://localhost:3000/ | rg -c "<div id="              # app shell present
kill %1
```

Also re-run the interface inventory extraction and diff it against `interface.json` (Property 6), and confirm the final `git ls-files` diff against `files.txt` contains exactly the allowlisted removals plus the added `README.md` (Property 1).

## Error handling

| Failure | Response |
| --- | --- |
| Gate red after a step | Do not proceed. `git checkout -- <paths>` to discard the step, re-run the gate to confirm green, then retry with a smaller removal set to isolate the offending change. |
| Test inventory gained or lost a test unexpectedly | Treat as red even if all tests pass. A vanished test is a silently disabled test; a new test means something was added that this cleanup did not intend. |
| A removal candidate turns out to be referenced mid-step | Restore it, and record the retention signal in `removals.md` so the same candidate is not re-proposed on the next scan. |
| `npm ci` reports lockfile mismatch | Re-run `npm install` to regenerate, commit the lockfile, retry. |
| `npm start` fails or the entry page 404s | Revert to the last green commit; the failure is in Phase 4 wiring (a removed handler or a removed static-route setup), so bisect by category commit. |
| Dangling-reference scan finds a removed identifier still present | The removal was incomplete. Finish it (usually a comment or a call site in a rarely-read branch) before the gate is considered green. |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

A cleanup has no generated input space, so these properties are universally quantified over finite, mechanically extractable sets — the tracked file list, the test inventory, the removal log, the interface vocabulary — and are checked exhaustively by enumeration rather than by random sampling. No fast-check generators are introduced by this feature. The repository's existing property-based tests remain the behavioral oracle and are covered by Property 2.

### Property 1: File manifest changes exactly as intended

*For any* path in the pre-cleanup tracked file manifest, that path exists in the post-cleanup manifest if and only if it is not under `analysis-tools/`, is not `.kiro/changes/changes.json`, and is not under an Abandoned_Spec folder; and *for any* path in the post-cleanup manifest that is absent from the pre-cleanup manifest, that path is `README.md`.

**Validates: Requirements 1.1, 1.2, 1.3, 2.3, 4.1, 4.4, 5.1**

### Property 2: The passing test inventory is invariant

*For any* test id (file path plus full test name) that passes before the cleanup, that test id passes after every cleanup step, unless it appears in the documented Requirement 4 edit allowlist; and *for any* test id that passes after the cleanup, it is either in the pre-cleanup passing set or in that allowlist. No test id is in a non-passing state at any gate.

**Validates: Requirements 3.1, 3.2, 3.4, 4.1, 4.3, 4.5**

### Property 3: No dangling reference to removed code

*For any* identifier, selector, or comment subject recorded as removed in `removals.md`, zero occurrences of it remain in Application_Source, in `public/index.html`, or in the Test_Suite — including occurrences inside comments and string literals.

**Validates: Requirements 2.1, 5.5**

### Property 4: Every referenced symbol is retained

*For any* symbol reference in the pre-cleanup repository reaching Application_Source through any of these channels — a named import in a Test_Suite file, a string literal passed to `getElementById`/`querySelector`, a `localStorage`/`sessionStorage` key, a Socket.IO event name literal, a computed or bracket-indexed access, or an `id`/`class`/inline-handler attribute in `public/index.html` — the referenced symbol still exists in Application_Source after the cleanup.

**Validates: Requirements 2.4, 2.5**

### Property 5: Every live style token keeps its rules

*For any* id, class, or attribute token in the live vocabulary of `public/index.html` and the Application_Source JavaScript (including class names assembled in template literals and toggled via `classList`), every `public/styles.css` rule that mentioned that token before the cleanup is still present after the cleanup.

**Validates: Requirements 2.6**

### Property 6: The external interface vocabulary is unchanged

*For any* HTTP route path, Socket.IO event name, Socket.IO payload key, or persisted session-state field name present in the pre-cleanup Application_Source, that same name is present in the post-cleanup Application_Source, in the same role, with the same payload key set for its event.

**Validates: Requirements 3.1, 3.6**

### Property 7: Every declared dependency is justified

*For any* package listed in `package.json` `dependencies` or `devDependencies` after the cleanup, at least one retained file imports it or a retained tool configuration requires it; and neither `@babel/parser` nor `@babel/generator` is listed.

**Validates: Requirements 1.4, 1.7**

### Property 8: Every documented command exists

*For any* command shown in `README.md`, that command is either an npm built-in or a key defined in the `scripts` section of `package.json`; and `README.md` states the start command, the test command, a Node.js version floor, and the default URL.

**Validates: Requirements 5.3, 5.4, 5.6**

## Testing Strategy

No new test files are added to the repository. This feature's verification is the existing suite plus a set of one-off checks run from the shell during the cleanup, with manifests held in `/tmp/flaps-housekeeping/`.

**Existing suite (the behavioral oracle).** `npm test` after every step, compared by test id against the baseline inventory. This covers the fast-check property tests over the server handlers, the revote core, the session machine and identity, and the jsdom tests that load the real `public/app.js` against the real `public/index.html`. Their continued success across generated inputs is the strongest available evidence for Requirement 3.1.

**Invariant checks (Properties 1–8).** Run as shell/`node -e` one-liners at the gates, per the commands in the manifest and detection sections. Each is a set comparison, so its output is either "empty diff" (green) or an explicit list of unexpected changes.

**Smoke checks.** `npm ci` once after the lockfile regeneration; `npm start` plus an HTTP GET of `http://localhost:3000/` once at the end. Both are single-execution by design: they exercise npm and the OS network stack, not application logic that varies with input.

**Manual review.** Two things have no oracle and are reviewed by hand against `removals.md`: whether the remaining code is genuinely free of Dead_Code (Requirement 2.1's completeness direction — the properties above only prove the removals were safe, not that they were exhaustive), and whether each test-file hunk in the diff touched only assertions naming removed code (Requirement 4.2). The scope is deliberately MODERATE: when a candidate's deadness is uncertain, it is retained and noted, not removed.
