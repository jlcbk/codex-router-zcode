# Porting notes: codex-plugin-cc → ZCode

A reference for anyone maintaining this adapter or bumping the
`codex-plugin-cc` submodule. Documents every Claude Code coupling point in
upstream and how we work around it on ZCode.

## The good news: the runtime is environment-agnostic

`codex-companion.mjs` and its `lib/` helpers do almost all the real work
(driving the Codex app-server, tracking jobs, rendering review output, broker
lifecycle). The runtime is plain Node.js and only knows about Codex + a few
env vars. **We vendor it as a submodule and modify zero source files.**

The Claude-specific assumptions cluster in three places: env vars, command
bodies, and the bundled subagent. Each is handled below.

## Coupling points and resolutions

### 1. `CLAUDE_PLUGIN_DATA` env var

**Upstream**: `lib/state.mjs` reads `process.env.CLAUDE_PLUGIN_DATA` to decide
where to persist job state.

**ZCode**: Spike-confirmed that ZCode sets **both** `ZCODE_PLUGIN_DATA` and
`CLAUDE_PLUGIN_DATA` (and `CLAUDE_PLUGIN_ROOT`) to the same values when running
plugin hooks. So inside a ZCode session, the runtime Just Works.

**Adapter (`zcode-adapter.mjs`) safety net**: for direct CLI invocation (when
env vars are not set), the adapter reads the marker file
(`~/.zcode/codex-router-zcode-root`, written by the SessionStart hook) and
reconstructs `CLAUDE_PLUGIN_DATA`, falling back to a tmp dir. This makes
`node zcode-adapter.mjs setup` work from a plain shell.

### 2. Command bodies: no `${...}` expansion, no inline `` !`cmd` ``

**Upstream**: command `.md` files embed `${CLAUDE_PLUGIN_ROOT}` and use
inline `` !`node ...` `` shell snippets (e.g. `/codex:status`,
`/codex:result`).

**ZCode**: command bodies do **not** expand template variables (only `$ARGUMENTS`/
`$1` are substituted) and inline `` !`cmd` `` is **rejected**. `${CLAUDE_PLUGIN_ROOT}`
would leak through literally.

**Resolution**: every command body is rewritten to a static-instruction form:

1. Read the marker file (`cat ~/.zcode/codex-router-zcode-root`) to get
   `PLUGIN_ROOT` (the hook wrote it; hooks *do* expand `${ZCODE_PLUGIN_ROOT}`).
2. Call the adapter: `node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" <subcommand> $ARGUMENTS`.
3. Relay the adapter's stdout verbatim.

This trades one extra model round-trip (read marker, then Bash) for
correctness. It is the standard ZCode command pattern.

### 3. ZCode does not load custom subagents from disk

**Upstream**: codex-plugin-cc ships `agents/codex-rescue.md` and references it
as `Agent(subagent_type: "codex:codex-rescue")`.

**ZCode**: the plugin manifest's `agents` field is **"recorded but not
executed"** (confirmed in the zcode-guide `diagnosing-plugins` skill). More
significantly, **ZCode does not treat `~/.zcode/agents/` as a discovery path
at all** — custom subagents are registered only via the Settings → Subagents
UI, and the `Agent` tool exposes only built-in types (`general-purpose`,
`Explore`). This was discovered empirically during end-to-end testing: copying
`agents/*.md` into `~/.zcode/agents/` did **not** make them available as
`subagent_type` values.

**Resolution**: the `/codex:rescue` command body does **not** route through a
subagent. Instead it runs in the main session: read the marker, then call the
adapter directly. The companion's job store provides output isolation in
`--background` mode, so a subagent boundary is not needed for that either.

The `agents/*.md` files are kept in the plugin for reference and for a future
ZCode build that may support disk-loaded subagents. They are **not** deployed
by the bootstrap hook (deploying them had no effect).

### 4. app-server broker unreliable under TLS MITM proxies (task-direct fallback)

**Upstream**: the companion `task --background` subcommand drives Codex via a
long-lived app-server broker process.

**Problem observed**: in network environments where a TLS MITM proxy intercepts
`chatgpt.com` traffic (symptom: `invalid peer certificate: certificate not
valid for name "chatgpt.com"; certificate is only valid for *.facebook.com`),
the broker's persistent connection is repeatedly torn down
(`Codex error: Reconnecting... 2/5` ... `5/5`, then `phase: failed`). The job
is recorded but never recovers. This is a property of the network environment,
**not** a bug in Codex, codex-plugin-cc, or this adapter.

**Resolution**: `zcode-adapter.mjs` exposes a `task-direct` subcommand that
runs `codex exec` directly (no broker, no app-server). The `/codex:rescue`
command body uses `task-direct` by default and only routes to the companion
`task --background` when the user explicitly passes `--background`. Direct
`codex exec` still hits the same TLS interception, but its shorter-lived
connections succeed after the standard 5-reconnect retry more often than the
broker's persistent connection does.

### 5. `CLAUDE_ENV_FILE` (SessionStart env export)

**Upstream**: `session-lifecycle-hook.mjs` writes `KEY=value` lines to
`$CLAUDE_ENV_FILE` to export `CODEX_COMPANION_SESSION_ID`,
`CODEX_COMPANION_TRANSCRIPT_PATH`, and `CLAUDE_PLUGIN_DATA` back into the
session env.

**ZCode**: there is no `CLAUDE_ENV_FILE` equivalent — SessionStart hooks
cannot export env vars back into the session. (Confirmed via the
zcode-guide `diagnosing-hooks` skill and spike: the field is absent.)

**Resolution**: we do not rely on env-var export. The runtime's session
isolation is driven by `CLAUDE_PLUGIN_DATA` (set by ZCode itself, not by our
hook) and `cwd`. The marker file carries the plugin root to where env is
unavailable.

### 6. `transcript_path` (for `/codex:transfer`)

**Upstream**: `claude-session-transfer.mjs` reads
`process.env.CODEX_COMPANION_TRANSCRIPT_PATH` (populated by the SessionStart
hook from Claude's `transcript_path`), validates it lives under
`~/.claude/projects/`, and feeds it to Codex's importer.

**ZCode**: spike-confirmed the SessionStart stdin has no `transcript_path`;
the main session is not stored as JSONL at all.

**Resolution**: `/codex:transfer` is short-circuited in `zcode-adapter.mjs` to
a ZCode-specific `transfer-zcode.mjs`, which renders a compressed summary from
the SQLite session store instead. See [`transfer-design.md`](transfer-design.md).

### 7. Stop hook (review gate)

**Upstream**: `hooks/hooks.json` registers a `Stop` hook that runs a Codex
review after each assistant turn, blocking the stop if it finds issues.

**ZCode**: the `async` field has no runtime effect and hooks always run inline,
so a Stop hook would block the session for up to 15 minutes per turn.

**Resolution**: our `hooks/hooks.json` registers **only** `SessionStart`. The
Stop hook code remains in the vendored submodule (we do not modify it) but is
never wired up. `/codex:setup --enable-review-gate` is accepted and recorded
for forward compatibility but has no live effect.

### 8. Hook stdin field names

**Upstream**: hooks read `session_id`, `transcript_path`, `cwd`,
`last_assistant_message`, `tool_name`, etc. from stdin JSON.

**ZCode**: spike-confirmed these field names are **identical** (ZCode is
Claude-Code-compatible here). No adaptation needed for the hook inputs we
actually consume (we only need `cwd`, which is present).

## What we do NOT modify in the submodule

- `plugins/codex/scripts/codex-companion.mjs` — untouched.
- All of `plugins/codex/scripts/lib/*.mjs` — untouched.
- `plugins/codex/commands/*.md` — untouched (we do not use upstream commands;
  our rewritten copies live in our own `commands/codex/`).
- `plugins/codex/agents/codex-rescue.md` — untouched (we ship our own adapted
  copy in our `agents/`).
- `plugins/codex/hooks/hooks.json` — untouched (we use our own hooks).

This keeps submodule upgrades cheap: `git checkout <new-tag>` in the vendor
dir, run `node zcode-adapter.mjs setup` to smoke-test, done. If a future
upstream release adds a new `lib/` file that reads a new Claude-only env var,
add a shim in `zcode-adapter.mjs` — do not patch the submodule.

## Verifying the integration after a submodule bump

1. `cd plugins/codex-router-zcode/scripts/vendor/codex-plugin-cc && git fetch --tags && git checkout <new>`
2. `node ../../../../scripts/zcode-adapter.mjs setup --json` — should report
   `ready: true` with the new Codex detail string.
3. `/codex:status`, `/codex:result` in a live session — should render.
4. `/codex:rescue --background <tiny task>` then `/codex:status` — should
   track the job.
5. If a new env var coupling appears, grep the new `lib/` for `CLAUDE_` and
   add a fallback in `zcode-adapter.mjs`.
