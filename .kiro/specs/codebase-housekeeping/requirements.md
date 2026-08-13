# Requirements Document

## Introduction

FLAPS is a Node/Express/Socket.IO planning-poker application with a vanilla JavaScript frontend and a Vitest test suite. The repository has accumulated a self-contained static-analysis tooling directory that no runtime or test code references, stale generated report artifacts, abandoned spec folders, unused dependencies, and dead code inside the application sources.

This feature performs a behavior-preserving housekeeping pass: removal of the unused analysis tooling and its orphaned artifacts, moderate dead code removal in the application sources, minimal adjustment of tests that reference removed code, deletion of abandoned spec documentation, and addition of a README describing how to run the application and the test suite. No module splitting or architectural restructuring of `server.js` or `public/app.js` is in scope.

## Glossary

- **Repository**: The FLAPS workspace rooted at the directory containing `package.json`, `server.js`, and `public/`.
- **Application_Source**: The runtime source files of the application: `server.js`, `public/app.js`, `public/session-identity.js`, `public/session-machine.js`, `public/story-revote.js`, `public/index.html`, `public/styles.css`.
- **Analysis_Tooling**: The `analysis-tools/` directory and all of its contents, including `analysis-tools/reports/`, `analysis-tools/integration-test.js`, and `analysis-tools/test-infrastructure.js`.
- **Orphaned_Artifact**: A file or directory whose only producer or consumer was Analysis_Tooling, specifically `.kiro/changes/changes.json` and the empty `.kiro/backups/` directory.
- **Test_Suite**: All Vitest test files in the Repository, executed by the `npm test` script (`vitest --run`).
- **Verification_Gate**: A successful, non-failing execution of `npm test` with the same set of passing tests as before the change, excluding tests deleted or edited under Requirement 4.
- **Dead_Code**: Code in Application_Source that cannot affect observable behavior: unreferenced functions, unreferenced variables, unused imports, unreferenced CSS selectors, event handlers bound to non-existent DOM elements, commented-out code blocks, leftover debug logging, and unreachable legacy compatibility branches.
- **Redundant_Helper**: Two or more functions in the same file or module scope within Application_Source that perform identical logic and can be replaced by a single shared function.
- **Abandoned_Spec**: A spec folder under `.kiro/specs/` that contains no documents or only a `.config.kiro` file, specifically `bold-section-titles`, `story-queue-ui-fixes`, `codebase-cleanup-analysis`, `codebase-optimization`, and `https-support`.
- **Preserved_Spec**: A spec folder that must remain unchanged: `clear-revote-finalized-story`, `create-join-flow-overhaul`, `session-persistence-on-tab-inactive`, and `codebase-housekeeping`.
- **Observable_Behavior**: The HTTP responses, Socket.IO events and payloads, persisted session state, and rendered user interface produced by the application for a given sequence of user and client actions.

## Requirements

### Requirement 1: Removal of unused analysis tooling

**User Story:** As a maintainer, I want the unused static-analysis tooling and its generated artifacts removed from the repository, so that the codebase contains only code that serves the running application or its tests.

#### Acceptance Criteria

1. THE Repository SHALL contain no `analysis-tools/` directory and no files formerly under `analysis-tools/`.
2. THE Repository SHALL retain every file outside `analysis-tools/` that existed before the removal, except for files explicitly removed under Requirements 1, 4, and 5.
3. THE Repository SHALL contain no `.kiro/changes/changes.json` file and no `.kiro/backups/` directory.
4. THE `package.json` file SHALL list neither `@babel/parser` nor `@babel/generator` as a dependency or devDependency.
5. WHEN dependencies are removed from `package.json`, THE Repository SHALL contain a `package-lock.json` regenerated from the updated `package.json` such that `npm ci` completes without a lockfile mismatch error.
6. THE `.gitignore` file SHALL contain no entry referencing `analysis-tools/`.
7. THE `package.json` scripts SHALL contain no command referencing a path under `analysis-tools/`.

### Requirement 2: Dead code removal in application sources

**User Story:** As a maintainer, I want dead and redundant code removed from the application sources, so that the code that remains is the code that runs.

#### Acceptance Criteria

1. THE Application_Source SHALL contain no Dead_Code.
2. WHERE a Redundant_Helper exists in Application_Source, THE Application_Source SHALL define the shared logic once and route all call sites to the single definition.
3. THE Application_Source SHALL retain its existing file set, with `server.js` and `public/app.js` remaining single modules that are not split into additional files.
4. THE Application_Source SHALL retain all exported symbols that are imported by any file in the Test_Suite that is not deleted under Requirement 4.
5. IF a candidate for removal is referenced dynamically, by string key, by `index.html`, or by any file in the Test_Suite, THEN THE Application_Source SHALL retain that candidate.
6. THE `public/styles.css` file SHALL retain every selector that matches an element, class, or attribute produced by `public/index.html` or by any Application_Source file.

### Requirement 3: Behavior preservation and verification

**User Story:** As a maintainer, I want the cleanup verified at every step, so that no functionality changes as a result of housekeeping.

#### Acceptance Criteria

1. THE Observable_Behavior of the application after the cleanup SHALL match the Observable_Behavior before the cleanup for every user and client action supported before the cleanup.
2. WHEN a removal step is completed, THE Repository SHALL satisfy the Verification_Gate before the next removal step begins.
3. IF `npm test` reports a failing test after a removal step, THEN THE cleanup SHALL restore the removed code or correct the removal until the Verification_Gate is satisfied, before any further removal step begins.
4. WHEN all cleanup steps are complete, THE Repository SHALL satisfy the Verification_Gate.
5. WHEN all cleanup steps are complete, THE `npm start` command SHALL start the server and serve the application entry page over HTTP without an unhandled error.
6. THE cleanup SHALL make no change to the public HTTP routes, Socket.IO event names, Socket.IO payload shapes, or persisted session state field names used by the application.

### Requirement 4: Test suite maintenance

**User Story:** As a maintainer, I want only the tests that break because of the cleanup to be touched, so that existing coverage is preserved.

#### Acceptance Criteria

1. THE Test_Suite SHALL retain every test file that passes both before and after the cleanup, including the exploration, preservation, and reproduction test files.
2. WHERE a test file asserts behavior of code removed under Requirement 2, THE cleanup SHALL edit or delete only the assertions and test cases that reference the removed code.
3. THE cleanup SHALL make no change to test cases that do not reference code removed under Requirements 1 or 2.
4. THE cleanup SHALL perform no consolidation or merging of test files that overlap in coverage.
5. WHEN a test file is edited, THE edited file SHALL retain every test case that passes against the cleaned Application_Source.

### Requirement 5: Documentation cleanup

**User Story:** As a maintainer, I want stale documentation removed and a README added, so that a newcomer can run the application and its tests without reading the source.

#### Acceptance Criteria

1. THE `.kiro/specs/` directory SHALL contain no Abandoned_Spec folder.
2. THE `.kiro/specs/` directory SHALL contain every Preserved_Spec folder with its documents unchanged.
3. THE Repository SHALL contain a `README.md` file at the Repository root.
4. THE `README.md` file SHALL state the command that starts the application, the command that runs the Test_Suite, the Node.js version requirement, and the default URL at which the application is served.
5. WHERE a code comment in Application_Source describes code removed under Requirement 2, THE cleanup SHALL delete or correct that comment so the comment describes only code that remains.
6. THE `README.md` file SHALL describe only commands that are defined in the `scripts` section of `package.json`.
