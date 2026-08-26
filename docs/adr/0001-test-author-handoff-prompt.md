# Handoff Prompt: Write the ADR-0001 Contract Tests

You are the test author for ADR-0001. Your task is to encode the accepted architecture as
executable tests before production implementation begins.

## Goal

Read the complete ADR at:

```text
/Users/greg/Documents/dev/transcriber/docs/adr/0001-unix-domain-socket-for-local-tts.md
```

Then add the test suites required by its Verification Plan and repository work packages.
The tests must define the observable contract for HTTP over a Unix domain socket, shared
TTS configuration/client/runtime behavior, desktop lifecycle integration, and readcast
delegation.

This is a test-only task. Do not implement the production feature.

## Working Directories

Use this as the primary working directory:

```text
/Users/greg/Documents/dev/transcriber
```

You may also inspect and edit test files in:

```text
/Users/greg/Documents/dev/local-knowledge
/Users/greg/Documents/dev/kokoro-mlx
```

Read each repository's `AGENTS.md` completely before acting. Follow the most local
instructions for every file you touch.

## Authorized Write Scope

You may create or edit only test code and test fixtures under these paths:

```text
/Users/greg/Documents/dev/kokoro-mlx/Tests/KokoroEdgeTests/
/Users/greg/Documents/dev/local-knowledge/packages/core/tests/
/Users/greg/Documents/dev/local-knowledge/packages/desktop/tests/
/Users/greg/Documents/dev/transcriber/tests/
```

If a test runner requires marker registration, you may propose the exact manifest/config
change in your final report, but do not make it during this task.

Do not edit:

- Production source files
- Package manifests, dependency files, or lockfiles
- CI workflows
- The ADR
- Documentation other than your final report
- Generated frontend bundles
- Existing user files outside the authorized test paths

Do not run destructive git commands, clean environments, delete runtime data, modify
`~/.localknowledge`, modify `~/.readcast`, or commit changes.

## Existing Workspace State

The readcast repository already contains unrelated untracked files, including the ADR,
`src/readcast/core/embedder.py`, `src/readcast/web/static/bundle.js`, and
`test-results/.last-run.json`. They are user-owned. Do not edit, remove, stage, or revert
them.

The readcast `.pixi` environment was observed in a damaged macOS File Provider state and
currently fails prefix-record parsing. Do not run `pixi clean`, remove `.pixi`, reinstall
dependencies, or otherwise repair it in this test-authoring task. Attempt the documented
test command once during preflight. If it fails for the known environment reason, record
the blocker and continue with static test authoring and the checks available in the other
repositories.

## Required Workflow

### 1. Establish baselines

Before editing, capture concise status and baseline test results in every repository:

```bash
git status --short --branch
```

Use the repository-native test commands:

```bash
cd /Users/greg/Documents/dev/kokoro-mlx && swift test
cd /Users/greg/Documents/dev/local-knowledge && pixi run test
cd /Users/greg/Documents/dev/transcriber && pixi run test
```

Do not repair unrelated baseline failures. Record them separately from failures introduced
by the new contract tests.

If you discover modifications overlapping an authorized test file, stop and report the
conflict instead of overwriting user work. Unrelated dirty files are not a reason to stop.

### 2. Read before designing

Read the ADR from beginning to end. Inspect the current production integration points and
existing test style, but do not edit production code. At minimum inspect:

```text
kokoro-mlx/Sources/KokoroEdge/CLI/ServeCommand.swift
kokoro-mlx/Sources/KokoroEdge/CLI/StatusCommand.swift
kokoro-mlx/Sources/KokoroEdge/CLI/DoctorCommand.swift
kokoro-mlx/Sources/KokoroEdge/Server/ServerApp.swift
kokoro-mlx/Sources/KokoroEdge/Support/DaemonRuntime.swift
local-knowledge/packages/core/src/localknowledge/tts.py
local-knowledge/packages/core/src/localknowledge/config.py
local-knowledge/packages/desktop/src/lk_desktop/services.py
local-knowledge/packages/desktop/src/lk_desktop/supervisor.py
transcriber/src/readcast/core/config.py
transcriber/src/readcast/core/synthesizer.py
transcriber/src/readcast/services.py
transcriber/src/readcast/cli/main.py
transcriber/src/readcast/api/app.py
```

### 3. Write contract-focused tests

Prefer tests of public behavior over private implementation details. Do not force a
particular helper class merely to make a test convenient. The public Python names in the
ADR (`TTSConfig`, `TTSClient`, and `TTSRuntime`) are normative and may be referenced
directly.

Tests must be deterministic and isolated:

- Use temporary directories and short socket paths.
- Never bind or probe the user's live socket.
- Never use TCP port 7777 in tests.
- Never download or load the real TTS model.
- Use a fake `TTSServing` implementation for Swift server tests.
- Use a small standard-library Unix-socket HTTP fixture or injected transport for Python tests.
- Inject clocks, subprocess runners, binary resolvers, ownership metadata, or clients when required to make lifecycle tests deterministic.
- Do not add arbitrary sleeps. Use bounded polling helpers only where a real process/socket integration test requires them.
- Keep slow process/socket tests separate from pure unit tests according to each repository's conventions.

It is acceptable and expected for newly added tests to fail because production APIs do
not exist yet. Do not skip, `xfail`, weaken, or comment out a test solely because the
feature is unimplemented. Every red test must fail for a specific missing ADR behavior,
not because of a syntax error, broken fixture, accidental network call, or incorrect
assumption about the current test framework.

## Required Test Coverage

### A. `kokoro-edge` tests

Add Swift tests that cover the externally observable UDS behavior from ADR Work Package A.

Required cases:

1. `serve --socket <path>` parses a UDS endpoint.
2. `--socket` is rejected when combined with `--host` or `--port`.
3. A 103-byte UTF-8 path is accepted and a longer path is rejected before bind.
4. Detached daemon arguments preserve `--socket` exactly.
5. `ServerAppFactory` serves `/v1/status` over a temporary UDS using a fake TTS service.
6. `/v1/voices` returns the fake inventory over UDS.
7. `/v1/audio/speech` returns deterministic fake WAV bytes over UDS.
8. Explicit TCP bind behavior remains available without loading a model.
9. A newly created runtime directory is mode `0700`.
10. A newly bound socket is mode `0600`.
11. A stale current-user socket can be removed and rebound.
12. A regular file at the socket path is rejected and preserved.
13. A symlink at the socket path is rejected and preserved.
14. A live managed PID plus an unresponsive socket is not unlinked.
15. Ownership-check behavior is testable without requiring root; use injected metadata if needed.
16. Graceful server shutdown removes only the socket created by that server.
17. `status --socket` reports a healthy fake server.
18. `doctor --socket` evaluates the UDS endpoint rather than a TCP port.
19. `stop` remains PID-targeted and does not inspect or kill a port owner.

Do not invoke the real model in unit tests. If one process-level smoke test is warranted,
make it opt-in according to the repository's existing integration-test convention.

### B. `localknowledge-core` tests

Add Python tests for ADR Work Package B.

Required configuration cases:

1. A new config defaults to `transport == "unix"` and the canonical socket path.
2. New UDS config serialization omits `server_url`.
3. Existing `http://127.0.0.1:7777` without `transport` migrates in memory to UDS.
4. Existing `http://localhost:7777` without `transport` migrates in memory to UDS.
5. A custom legacy URL migrates to explicit TCP with a deprecation warning.
6. Explicit TCP without `server_url` raises a targeted configuration error.
7. Loading migration does not write the config file.
8. The next explicit save writes the normalized transport fields.

Required `TTSClient` cases:

1. UDS status uses `httpx.HTTPTransport(uds=<expanded path>)` and the expected route.
2. UDS voice inventory decodes correctly.
3. UDS speech sends model, voice, speed, language, input, and response format exactly once.
4. TCP mode uses the explicit IP-literal URL and does not configure UDS transport.
5. Unix-socket missing, refused, permission-denied, timeout, malformed JSON, and non-2xx responses produce distinguishable `TTSError` messages containing a safe endpoint label.
6. Client calls never silently retry TCP while configured for UDS.

Required `TTSRuntime` cases:

1. A healthy daemon is reused without resolving or spawning the binary.
2. Auto-start disabled returns the original actionable health error.
3. UDS start invokes `kokoro-edge serve -d --socket <expanded path>`.
4. An incompatible binary below 0.2.0 reports the required upgrade error.
5. Editable-development capability detection accepts a binary advertising `--socket`.
6. Readiness polls the configured UDS and respects the configured timeout.
7. A concurrent-start loser re-probes and returns the winner's healthy status.
8. A failed spawn with no healthy winner remains an error.
9. Stop delegates to PID-managed `kokoro-edge stop` and verifies endpoint shutdown.
10. Runtime never uses `lsof`, kills a port owner, or falls back to a legacy endpoint outside the explicit migration path.
11. Legacy migration stops only a verified PID-managed daemon or an exact supervisor-owned child.
12. Unverifiable port ownership stops migration with an actionable error.

Use injected collaborators rather than real subprocesses for unit tests. Add one isolated
UDS request/response fixture to prove that the HTTP transport works end to end without
loading ML dependencies.

### C. `lk-desktop` tests

Create the desktop test package if absent, following the monorepo pytest conventions.

Required cases:

1. TTS startup delegates to `TTSRuntime.ensure_running()`.
2. TTS health delegates to `TTSClient.server_status()`.
3. TTS shutdown delegates to `TTSRuntime.stop()`.
4. The desktop obtains endpoint configuration from shared Local Knowledge config.
5. No TTS service definition contains `localhost`, `127.0.0.1:7777`, or a hard-coded socket path.
6. Readcast dependency startup waits for successful UDS readiness.
7. Already-running TTS is treated as healthy rather than restarted.
8. Concurrent startup resolves to one daemon.
9. Failed startup enters existing bounded backoff behavior.
10. Shutdown cannot target a different PID from the managed daemon.
11. Existing command-managed behavior for readcast, `lk-ui`, and `lk-mcp` is unchanged.

Avoid broad source-text assertions when behavior can be tested through injected service
controllers. A narrow assertion forbidding the legacy TTS URL is acceptable as a
regression guard after behavioral coverage exists.

### D. readcast tests

Update or add tests for ADR Work Package D while preserving all existing synthesis-policy
coverage.

Required cases:

1. `ReadcastService` accepts injected `TTSClient` and `TTSRuntime` collaborators.
2. Processing calls runtime readiness once before processing a non-empty article batch.
3. Voice inventory delegates to the injected client.
4. Daemon status/start/stop delegates through service methods rather than CLI/API globals.
5. Speech requests delegate to the client with article voice/speed overrides and readcast model/language settings.
6. Existing retry-once behavior remains unchanged when the client returns a synthesis error.
7. Existing recursive text subdivision remains unchanged.
8. Progress callbacks, segment WAV persistence, ffmpeg concatenation, metadata, and output links remain unchanged.
9. Readcast's known-default `[kokoro_edge]` config is deprecated and omitted on explicit save.
10. A custom readcast endpoint or binary emits a migration warning without mutating Local Knowledge config.
11. CLI `server start`, `status`, and `stop` report a UDS endpoint and use `ReadcastService`.
12. API `/api/status` reports ready/offline UDS states with actionable socket errors.
13. Web startup no longer contains a separate pre-service TTS lifecycle call.
14. No readcast production-facing test needs to monkeypatch global `httpx.get`, `httpx.post`, or `subprocess.run` for TTS behavior.
15. Browser server tests continue to use `127.0.0.1:8765`; this ADR does not move FastAPI to UDS.

Tests may introduce small fake client/runtime classes under `tests/`. Do not add these
fakes to production modules.

## Test Quality Bar

Every test must satisfy all of the following:

- Its name states one behavior.
- Its setup uses temporary or injected state.
- It does not depend on test execution order.
- It does not access live user data or services.
- It has a clear expected failure against the pre-ADR production code.
- It does not assert private implementation details unless no public observation is possible.
- It remains useful after the production implementation passes.
- It maps to a specific ADR section or acceptance criterion.

Avoid giant scenario tests that obscure the failing contract. Prefer focused unit tests
plus one end-to-end UDS smoke test per relevant repository.

## Verification After Editing

Run the narrowest affected test files first, then each repository's standard suite. A
red result from missing production behavior is expected. Syntax errors, collection
errors caused only by guessed imports, broken fixtures, or regressions in unrelated
existing tests are not acceptable deliverables.

If a normative production class is not yet importable, structure the test module so the
failure clearly identifies the missing ADR API. Do not hide the requirement with a skip.

Also run formatting/lint checks that apply to test files without modifying production or
generated files.

## Deliverable

Leave the new and updated tests in the authorized test directories. Do not implement the
feature and do not commit.

Return a concise final report with exactly these sections:

```text
FILES CHANGED
- absolute path per file

COVERAGE ADDED
- ADR requirement -> test name(s)

COMMANDS RUN
- command -> pass/fail/blocker

EXPECTED RED FAILURES
- test -> missing production behavior it specifies

UNEXPECTED FAILURES
- test -> root cause, or "none"

PRODUCTION CONTRACT DEPENDENCIES
- any required API detail not fully fixed by ADR, or "none"

BLOCKERS
- blocker and evidence, or "none"
```

Stop after producing that report. Do not proceed from red tests into production
implementation.
