# ADR-0001: Use HTTP over a Unix Domain Socket for Local TTS

- Status: Proposed
- Date: 2026-08-25
- Decider: Greg Jennings
- Scope: `kokoro-edge`, `localknowledge-core`, `lk-desktop`, and readcast

## Summary

The Local Knowledge ecosystem will use HTTP/1.1 over a Unix domain socket (UDS) as the
default transport between Python applications and `kokoro-edge`. The existing TTS HTTP
wire API remains unchanged. This ADR changes the transport and consolidates endpoint and
lifecycle ownership.

The canonical socket path is:

```text
~/.localknowledge/run/kokoro-edge.sock
```

`localknowledge-core` will own the Python client and daemon-lifecycle contract. Readcast
and `lk-desktop` will consume that shared implementation rather than independently
constructing URLs, probing ports, or launching `kokoro-edge`.

The readcast browser UI will continue to use HTTP on `127.0.0.1:8765`. WebSockets,
dynamic TCP ports, browser API authentication, and CORS hardening are not part of this
decision.

## Context

### Incident that prompted this decision

On 2026-08-25, readcast failed to synthesize newly ingested articles even though both
readcast and `kokoro-edge` appeared to be running.

The live state was:

```text
readcast client target:       http://127.0.0.1:7777
kokoro-edge listener:         [::1]:7777
GET http://127.0.0.1:7777:    connection refused
GET http://localhost:7777:    200 OK
GET http://[::1]:7777:        200 OK
```

The immediate cause was an IPv4/IPv6 loopback mismatch. `lk-desktop` launched
`kokoro-edge serve` without a host argument, so `kokoro-edge` used its `localhost`
default and Hummingbird bound the daemon to IPv6 loopback. Readcast and Local Knowledge
health checks used the IPv4 literal `127.0.0.1`.

The underlying architectural cause was duplicated endpoint and lifecycle ownership:

| Component | Current responsibility |
|---|---|
| readcast | Stores a TTS URL, probes health, starts/stops the daemon, and sends HTTP requests |
| `localknowledge-core` | Stores another TTS URL, probes health, starts/stops the daemon, and sends HTTP requests |
| `lk-desktop` | Defines a third start command and a separate TCP health URL |
| `kokoro-edge` | Defaults to `localhost`, owns a PID file, and exposes both HTTP and WebSocket APIs |

These implementations can disagree about hostnames, address families, ports, daemon
state, or configuration. A protocol change alone would not solve that ownership problem.

### Platform constraint

The ecosystem is intentionally limited to macOS 15 or newer on Apple Silicon.
Cross-platform IPC is not a requirement for this decision. This allows use of a Unix
domain socket without adding a Windows named-pipe abstraction.

### Security context

A fixed loopback TCP port is not inherently unsafe, but it has properties that are
unnecessary for the TTS boundary:

- Any process running as any local user can attempt to connect to the port.
- Browser JavaScript can attempt requests to loopback services.
- CORS is not an authentication mechanism and does not protect non-browser clients.
- Hostname resolution and IPv4/IPv6 binding can differ.
- Port collisions do not identify which process owns the endpoint.

A filesystem-backed socket can be restricted to the current macOS user and is not
directly reachable from browser JavaScript. It also eliminates host resolution and port
selection from this boundary.

The socket does not protect against malicious code already running as the same macOS
user. That is outside the threat model.

## Decision

### 1. Preserve HTTP and change only the transport

The TTS API will continue to use HTTP/1.1 with the existing routes:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/status` | Readiness, version, model, and voice inventory |
| `GET` | `/v1/voices` | Voice metadata |
| `POST` | `/v1/audio/speech` | Synthesize text and return WAV bytes |

Clients will connect through the Unix domain socket instead of opening a TCP connection.
Python clients may use a synthetic HTTP base URL such as `http://kokoro-edge`; the host
is not resolved when an `httpx` UDS transport is configured.

No new serialization format, request envelope, streaming protocol, or WebSocket client
will be introduced.

### 2. Use one canonical socket path

The default path is:

```text
~/.localknowledge/run/kokoro-edge.sock
```

The path is owned by Local Knowledge configuration and passed explicitly to
`kokoro-edge`. `kokoro-edge` must not hard-code knowledge of `~/.localknowledge`.

The following filesystem requirements apply:

| Item | Requirement |
|---|---|
| Parent directory | Created as `0700` when absent; an owned existing directory is reduced to `0700`, and a foreign-owned directory is rejected |
| Socket | Created with effective mode `0600` |
| Owner | Current effective user |
| Symlinks | Rejected for the socket path |
| Regular files | Never removed automatically |
| Maximum path | At most 103 UTF-8 bytes, leaving one byte for the NUL terminator in macOS's 104-byte `sun_path` |
| Temporary directory | Do not place the default socket in `/tmp` |

All path validation operates on the expanded absolute path. Error messages must include
a display-safe endpoint such as `unix:/Users/greg/.localknowledge/run/kokoro-edge.sock`.

### 3. Make `localknowledge-core` the Python integration boundary

`localknowledge-core` will expose the only production Python implementation of the TTS
client and lifecycle controller. The intended public surface is:

```python
from typing import Literal


@dataclass(slots=True)
class TTSConfig:
    transport: Literal["unix", "tcp"] = "unix"
    socket_path: str = "~/.localknowledge/run/kokoro-edge.sock"
    server_url: str | None = None  # Required only for explicit TCP mode.
    model: str = "kokoro-82m"
    voice: str = "af_sky"
    speed: float = 1.0
    language: str = "en-us"
    binary: str = "kokoro-edge"
    auto_start: bool = True
    startup_timeout_sec: int = 30


class TTSClient:
    def server_status(self) -> dict: ...
    def fetch_voices(self) -> list[dict]: ...
    def synthesize_text(
        self,
        text: str,
        *,
        model: str | None = None,
        voice: str | None = None,
        speed: float | None = None,
        language: str | None = None,
        response_format: str = "wav",
    ) -> bytes: ...


class TTSRuntime:
    def ensure_running(self) -> dict: ...
    def start(self) -> dict: ...
    def stop(self) -> bool: ...
```

These public names, responsibilities, and dependency directions are normative. Internal
helper organization may differ.

`TTSClient` owns HTTP transport construction and API calls. `TTSRuntime` owns binary
resolution, startup, readiness polling, race handling, and shutdown. Callers do not
construct a UDS-enabled `httpx.Client` themselves.

### 4. Keep synthesis policy in readcast

Readcast retains article-specific synthesis behavior:

- Structural and TTS chunking
- Voice and speed overrides
- Retry and failed-text subdivision
- WAV segment persistence
- ffmpeg concatenation
- Audio metadata and output management

Readcast will not retain transport or daemon-management behavior. In particular,
`readcast.core.synthesizer` will no longer call `httpx` directly or invoke the
`kokoro-edge` binary.

`ReadcastService` will receive a `TTSClient` and `TTSRuntime`, with injectable fakes for
tests. CLI and FastAPI code will delegate status/start/stop operations through the
service layer.

### 5. Give `kokoro-edge` ownership of its runtime artifacts

`kokoro-edge` owns creation and cleanup of the socket after Local Knowledge supplies the
path. It also continues to own its PID file and daemon log.

The CLI will add a `--socket <path>` option to `serve`, `status`, and `doctor`.
`--socket` is mutually exclusive with `--host` and `--port`.

Examples:

```bash
kokoro-edge serve -d --socket "$HOME/.localknowledge/run/kokoro-edge.sock"
kokoro-edge status --socket "$HOME/.localknowledge/run/kokoro-edge.sock"
kokoro-edge doctor --socket "$HOME/.localknowledge/run/kokoro-edge.sock"
kokoro-edge stop
```

TCP support remains available when explicitly selected for development or compatibility.
For the first UDS-capable release, the existing no-argument standalone behavior remains
TCP on `localhost:7777` to avoid breaking direct `kokoro-edge` users. Local Knowledge and
readcast must always pass the selected endpoint explicitly. Changing the standalone
default requires a later ADR or a major-version compatibility decision.

The server will use Hummingbird's existing bind-address support:

```swift
.unixDomainSocket(path: socketPath)
```

The HTTP router and synthesis implementation remain shared between TCP and UDS modes.

### 6. Use deterministic lifecycle behavior

Startup follows this sequence:

1. Expand and validate the configured endpoint.
2. Probe `/v1/status` through that endpoint.
3. Return the status immediately when a compatible daemon is ready.
4. Resolve and capability-check the `kokoro-edge` binary.
5. Ask `kokoro-edge` to start as a detached daemon on the configured socket.
6. Poll the same socket until ready or until `startup_timeout_sec` expires.
7. If another caller wins a concurrent startup race, re-probe and treat a healthy daemon as success.

Socket recovery follows these rules:

| PID state | Socket state | Action |
|---|---|---|
| Live managed PID | Healthy endpoint | Reuse daemon |
| Live managed PID | Unresponsive endpoint | Fail with diagnostics; do not unlink |
| No live managed PID | Missing socket | Start normally |
| No live managed PID | Owned Unix socket that refuses connections | Remove stale socket, then start |
| Any state | Symlink or non-socket filesystem entry | Fail; never remove it |
| Any state | Socket owned by another user | Fail; never remove it |

On graceful shutdown, `kokoro-edge` removes the socket only if it still refers to the
endpoint created by that daemon. Abrupt termination can leave a stale socket; the next
safe startup handles it according to the table above.

### 7. Make `lk-desktop` use the shared lifecycle controller

The desktop supervisor must stop launching TTS through the static command
`kokoro-edge serve` and probing `http://127.0.0.1:7777/v1/status`.

TTS becomes an externally managed daemon service backed by `TTSRuntime`:

| Supervisor operation | TTS implementation |
|---|---|
| Start | `TTSRuntime.ensure_running()` |
| Probe | `TTSClient.server_status()` |
| Stop | `TTSRuntime.stop()` |
| Dependency readiness | Successful UDS status response |

Do not solve this by adding a second hard-coded socket path to `ServiceDef`. The desktop
must load the shared `~/.localknowledge/config.toml` value.

The current foreground-process/PID mismatch must also disappear: the desktop must not
launch a foreground process and then stop a different PID through `kokoro-edge stop`.

### 8. Do not silently fall back to TCP

When `transport = "unix"`, a missing or unusable socket is an actionable runtime error.
Clients must not retry `localhost:7777` or `127.0.0.1:7777` automatically. Silent fallback
would reintroduce split-brain daemon state and make security behavior configuration-dependent.

TCP is selected only with:

```toml
[tts]
transport = "tcp"
server_url = "http://127.0.0.1:7777"
```

TCP mode must use an IP literal by default. `localhost` is not a supported generated
default because it can resolve to different address families.

### 9. Keep the browser-facing readcast server on loopback TCP

Browsers cannot connect directly to a Unix domain socket. The readcast FastAPI server
therefore remains on `127.0.0.1:8765`.

Restricting readcast's current wildcard CORS policy, validating host headers, and adding
browser/extension authentication are important but separate decisions. Mixing those
changes into the TTS transport migration would make rollout and rollback harder.

### 10. Use filesystem access control for UDS authorization

The UDS endpoint will not require a bearer token. The `0700` runtime directory and
current-user ownership are the authorization boundary for this single-user macOS system.
Adding a token would introduce secret distribution and rotation without protecting
against malicious code already running as the same user.

Explicit TCP compatibility mode does not provide equivalent user isolation and must not
be described as the secure default. A future multi-user or remote-access requirement
must revisit authentication in a separate ADR.

## Configuration and Migration

### Canonical Local Knowledge configuration

The persisted configuration becomes:

```toml
[tts]
transport = "unix"
socket_path = "~/.localknowledge/run/kokoro-edge.sock"
model = "kokoro-82m"
voice = "af_sky"
speed = 1.0
language = "en-us"
binary = "kokoro-edge"
auto_start = true
startup_timeout_sec = 30
```

`server_url` is omitted when `transport = "unix"`. The serializer must not write
irrelevant TCP settings into newly created configuration files. If `transport = "tcp"`,
`server_url` is required and configuration loading fails with a targeted error when it is
missing.

### Existing Local Knowledge configuration

When `[tts].transport` is absent:

| Existing value | Migration result |
|---|---|
| Missing `server_url` | Select UDS default |
| `http://127.0.0.1:7777` | Select UDS default |
| `http://localhost:7777` | Select UDS default |
| Any other explicit URL | Preserve it as `transport = "tcp"` and emit a deprecation warning |

The migration must be deterministic and unit tested. It remains in memory until the next
explicit configuration save; config loading must not perform an unrelated write. The
next save writes `transport` and `socket_path` and omits a legacy default `server_url`.

### Existing readcast configuration

Readcast's `[kokoro_edge]` section becomes deprecated because runtime endpoint and binary
settings move to Local Knowledge configuration.

Migration behavior is:

| Readcast value | Behavior |
|---|---|
| Known default URL/binary/autostart values | Ignore and omit on the next readcast config save |
| Custom binary with default Local Knowledge binary | Present a migration warning identifying the Local Knowledge key to set |
| Custom URL | Present a migration warning; do not silently mutate another config file |
| TTS model, voice, speed, language, chunk size, and audio format | Keep as readcast synthesis policy |

No article, audio, database, or queue migration is required.

### Existing TCP daemon during upgrade

The upgrade path must not leave both TCP and UDS daemons running.

The runtime migration sequence is:

1. Probe the configured UDS endpoint.
2. If absent, probe the two known legacy loopback endpoints only during migration.
3. Verify the `Server: kokoro-edge` response header and the expected status payload schema.
4. If `kokoro-edge` owns the PID, stop it through the PID-managed shutdown path.
5. If `lk-desktop` owns a foreground child, stop that exact recorded child process.
6. If ownership cannot be established, stop migration with an actionable error instead of killing the listener.
7. Start the UDS daemon.
8. Never kill an arbitrary process merely because it owns port 7777.

This legacy probe is migration logic, not a permanent fallback transport. Retain it for
one Local Knowledge minor release after UDS becomes the default, emitting a deprecation
log when used. Its removal is a later cleanup and is not part of the initial implementation.

## Compatibility and Rollout

The change must roll out in this order:

1. Release `kokoro-edge` with additive UDS server and CLI support while preserving explicit TCP support.
2. Release `localknowledge-core` with UDS configuration, client transport, lifecycle management, and migration logic.
3. Update `lk-desktop` to use the shared lifecycle implementation.
4. Update readcast to inject the shared client/runtime and remove direct daemon management.
5. Update packaging so the Local Knowledge/readcast release requires a UDS-capable `kokoro-edge`.

The first UDS-capable engine version is `kokoro-edge` 0.2.0. Packaging must require
`kokoro-edge >=0.2.0`. During editable development only, capability checking may fall
back to confirming that `kokoro-edge serve --help` advertises `--socket`. Installed
builds must report a clear upgrade error when the binary is older than 0.2.0.

Rollback does not require a data migration. Set `transport = "tcp"`, explicitly bind
`kokoro-edge` to `127.0.0.1`, stop the UDS daemon, and restart the services.

## Repository Work Packages

The packages below are intentionally separated so multiple implementation agents can
work from this ADR without redefining the contract.

### Coordination contract

| Work package | Can begin | Integration dependency | File ownership |
|---|---|---|---|
| A: `kokoro-edge` | Immediately | None | `kokoro-mlx` only |
| B: shared Python client/runtime | Immediately against this ADR | A for live integration tests | `local-knowledge/packages/core` only |
| C: desktop integration | After B's public API is fixed, or against a faithful test fake | B | `local-knowledge/packages/desktop` only |
| D: readcast integration | After B's public API is fixed, or against a faithful test fake | B | `transcriber` source/tests only |
| E: packaging/docs | After versions and APIs from A-D are known | A-D | Packaging and documentation files only |

Agents must not independently rename the normative `TTSConfig`, `TTSClient`, or
`TTSRuntime` surface. If implementation proves that contract impossible, stop and amend
this ADR before creating incompatible APIs. Each work package must land with its own
unit tests; cross-repository integration failures are resolved only after the owning
unit suites pass.

### Work Package A: `kokoro-edge` UDS support

Repository: `kokoro-mlx`

Primary files:

```text
Sources/KokoroEdge/CLI/ServeCommand.swift
Sources/KokoroEdge/CLI/StatusCommand.swift
Sources/KokoroEdge/CLI/DoctorCommand.swift
Sources/KokoroEdge/Server/ServerApp.swift
Sources/KokoroEdge/Support/DaemonRuntime.swift
Sources/KokoroEdge/Support/KokoroEdgePaths.swift
Tests/KokoroEdgeTests/
```

Required output:

- Add mutually exclusive TCP and UDS endpoint parsing.
- Bind Hummingbird to `.unixDomainSocket(path:)` in UDS mode.
- Implement status and doctor probes over UDS.
- Enforce path type, ownership, path-length, and permission rules.
- Handle safe stale-socket cleanup and graceful cleanup.
- Pass `--socket` through detached-daemon arguments.
- Keep the existing HTTP routes and explicit TCP mode working.
- Add unit and integration tests for lifecycle edge cases.

Do not change synthesis behavior, models, voices, chunking, or API payloads in this work
package.

### Work Package B: shared Python TTS client and runtime

Repository: `local-knowledge`

Primary files:

```text
packages/core/src/localknowledge/tts.py
packages/core/src/localknowledge/config.py
packages/core/tests/test_tts.py
packages/core/tests/test_config.py
```

Required output:

- Add `transport` and `socket_path` configuration with migration.
- Build UDS requests with `httpx.HTTPTransport(uds=...)`.
- Keep one request/payload implementation for UDS and explicit TCP modes.
- Add `TTSRuntime` for binary resolution and deterministic lifecycle behavior.
- Make client and subprocess factories injectable for unit tests.
- Normalize errors so socket absence, refusal, permissions, timeout, and incompatible binary are distinguishable.
- Export the stable client/runtime API consumed by readcast and `lk-desktop`.

Do not add readcast-specific article or audio behavior to `localknowledge-core`.

### Work Package C: desktop supervisor integration

Repository: `local-knowledge`

Primary files:

```text
packages/desktop/src/lk_desktop/services.py
packages/desktop/src/lk_desktop/supervisor.py
packages/desktop/tests/
```

Required output:

- Replace the TTS static command and TCP health URL with the shared runtime/client.
- Keep the generic handling of readcast, `lk-ui`, and `lk-mcp` unchanged.
- Ensure dependency ordering waits for a successful UDS status probe.
- Ensure stop targets the daemon started by the shared runtime.
- Test startup, already-running, concurrent-start, failed-start, restart-backoff, and shutdown behavior.

Do not hard-code the canonical socket path in the desktop package.

### Work Package D: readcast integration

Repository: `transcriber`

Primary files:

```text
src/readcast/core/config.py
src/readcast/core/synthesizer.py
src/readcast/services.py
src/readcast/cli/main.py
src/readcast/api/app.py
tests/test_config.py
tests/test_synthesizer.py
tests/test_services.py
tests/test_cli.py
tests/test_api.py
```

Required output:

- Inject the shared `TTSClient` and `TTSRuntime` through `ReadcastService`.
- Replace direct `httpx` calls with `TTSClient` calls.
- Replace direct subprocess lifecycle code with `TTSRuntime` calls.
- Keep retry, recursive split, progress, audio concatenation, and metadata behavior unchanged.
- Deprecate and migrate readcast's duplicated `[kokoro_edge]` configuration.
- Report the UDS endpoint and actionable socket errors in CLI and API status output.
- Update tests to fake the client/runtime at the service boundary rather than monkeypatching global `httpx` functions.

Do not change the readcast browser server transport or frontend behavior in this work
package.

### Work Package E: packaging and operational documentation

Repositories: `kokoro-mlx`, `local-knowledge`, and `transcriber`

Required output:

- Declare the minimum UDS-capable `kokoro-edge` version.
- Make setup scripts reject an incompatible binary with an upgrade command.
- Update service and troubleshooting documentation to use `curl --unix-socket`.
- Remove claims that port 7777 is the default ecosystem endpoint after migration.
- Document explicit TCP rollback.

## Verification Plan

### Unit tests

| Area | Required test |
|---|---|
| Config | Missing transport migrates known loopback defaults to UDS |
| Config | Custom TCP URL remains explicit TCP |
| Client | Status, voices, speech payload, timeout, and HTTP error handling work through an injected transport |
| Runtime | Healthy daemon is reused without spawning |
| Runtime | Concurrent startup race resolves to one healthy daemon |
| Runtime | Incompatible binary reports a clear upgrade error |
| Socket safety | Stale owned socket is removed |
| Socket safety | Live, foreign-owned, symlink, and regular-file paths are not removed |
| Permissions | Runtime directory is `0700` and socket is `0600` |
| Readcast | Existing synthesis retries and recursive splitting are unchanged |
| Desktop | TTS dependency readiness uses UDS and no TCP health URL |

### Integration tests

All integration tests run on macOS 15 or newer:

```bash
kokoro-edge serve -d --socket "$HOME/.localknowledge/run/kokoro-edge.sock"
curl --fail --unix-socket "$HOME/.localknowledge/run/kokoro-edge.sock" \
  http://kokoro-edge/v1/status
curl --fail --unix-socket "$HOME/.localknowledge/run/kokoro-edge.sock" \
  http://kokoro-edge/v1/voices
```

The suite must also synthesize a short WAV through the socket, process a three-segment
readcast article, stop the daemon, verify socket cleanup, create a stale socket, and verify
successful recovery.

### End-to-end acceptance criteria

The decision is implemented only when all criteria below pass:

- `lk-desktop` starts exactly one `kokoro-edge` daemon.
- `readcast /api/status` reports TTS ready through the UDS endpoint.
- A queued article reaches `done` and produces playable audio.
- Voice inventory and voice changes work.
- `readcast server start`, `status`, and `stop` delegate to the shared runtime.
- Restarting `lk-desktop` does not produce repeated `already running` or `port in use` errors.
- No process listens on TCP port 7777 in the default configuration.
- A graceful daemon stop removes the socket.
- The socket is owned by the current user and has mode `0600`.
- A stale socket after forced termination is recovered without deleting unrelated files.
- Explicit TCP compatibility mode still works on `127.0.0.1`.
- Existing readcast unit tests for extraction, storage, chunking, synthesis retries, and audio metadata remain green.

Useful operational assertions include:

```bash
test -S "$HOME/.localknowledge/run/kokoro-edge.sock"
stat -f '%Su %Sp' "$HOME/.localknowledge/run/kokoro-edge.sock"
lsof -nP -iTCP:7777 -sTCP:LISTEN
```

The final command must produce no `kokoro-edge` listener in default UDS mode.

## Consequences

### Positive consequences

- Eliminates IPv4/IPv6 and hostname-resolution ambiguity for TTS.
- Eliminates default port 7777 collisions and accidental browser access to TTS.
- Restricts the endpoint to the current macOS user through filesystem permissions.
- Preserves the existing HTTP API and most server routing code.
- Creates one Python implementation for configuration, health, requests, and lifecycle.
- Makes startup and error behavior independently testable.

### Negative consequences

- Requires coordinated releases across three repositories.
- Requires a UDS-capable status client in the Swift CLI because `URLSession` does not expose this transport directly.
- Requires careful stale-socket and permission handling.
- Makes direct browser access to `kokoro-edge` unavailable in default mode.
- Retains an explicit TCP compatibility path that must receive basic tests for at least one Local Knowledge minor release after UDS becomes the default.

### Neutral consequences

- Audio generation remains sequential and file-based.
- The TTS HTTP payloads and responses do not change.
- The readcast web UI, podcast feed, database, and article storage do not change.
- Existing WebSocket support remains available in explicit TCP mode, but Local Knowledge and readcast do not use it.

## Alternatives Considered

### Explicit IPv4 loopback HTTP

Binding every process to `127.0.0.1:7777` would fix the immediate incident with the least
code. It does not remove endpoint duplication, browser reachability, or port collisions.
It remains the rollback and compatibility option, not the default architecture.

### WebSockets on loopback TCP

WebSockets retain the same host, address-family, port, and trust problems. They add
connection state and reconnection behavior without benefiting request/response TTS file
generation. Rejected as the primary transport.

### Dynamic TCP port with service discovery

An ephemeral port avoids fixed-port collisions but requires a secure discovery file,
lifecycle synchronization, and stale-state handling. Once a filesystem discovery
contract exists, a Unix socket is simpler and avoids TCP entirely. Rejected.

### Embed `kokoro-edge` in readcast

Embedding would couple ML dependencies and engine lifecycle to one product, preventing
other Local Knowledge clients from sharing the daemon. Rejected.

### Custom binary protocol

A custom protocol would discard the existing tested HTTP contract and require new
clients, framing, errors, and observability. HTTP over UDS provides the desired isolation
without a protocol rewrite. Rejected.

### Named pipes or a cross-platform IPC abstraction

This would be appropriate if Windows were in scope. The current platform is intentionally
macOS-only, so the abstraction would add design and testing cost without a consumer.
Deferred until cross-platform support becomes a committed requirement.

## Follow-up Decisions

The following concerns require separate, narrowly scoped ADRs or security changes:

- Restrict wildcard CORS on the readcast FastAPI server.
- Authenticate browser-extension requests to readcast.
- Validate loopback Host headers and address DNS-rebinding risk.
- Decide whether `kokoro-edge` should eventually remove TCP and WebSocket support.
- Decide whether other Local Knowledge services should adopt UDS.

They are deliberately not prerequisites for this TTS transport decision.
