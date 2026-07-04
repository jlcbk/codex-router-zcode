# `/codex:transfer` on ZCode: design & rationale

## What Claude Code's `/codex:transfer` does

In OpenAI's codex-plugin-cc, `/codex:transfer` takes the current Claude Code
session transcript and imports it into Codex as a **resumable thread**. The
plugin runs inside the Claude Code process and:

1. Reads `transcript_path` (which Claude exposes to plugins / hooks).
2. Uses Codex's external-agent session importer to convert the Claude JSONL
   transcript into Codex's rollout format.
3. Prints `codex resume <session-id>` so the user can continue that exact
   thread inside Codex.

The result is a true continuation: Codex sees the same turns, the same tool
I/O, the same reasoning trace, and the user can keep working in either tool.

## Why this cannot be ported faithfully to ZCode

Three independent blockers, any one of which is fatal:

### 1. ZCode does not expose the session transcript path

Claude Code passes `transcript_path` to plugins and SessionStart hooks. ZCode
does **not** — there is no `ZCODE_TRANSCRIPT_PATH` or equivalent env var, and
the SessionStart hook's stdin JSON has no `transcript_path` field for the main
session. (Spike-confirmed: the SessionStart stdin contains `session_id`, `cwd`,
`source`, `mode`, `traceId`, `turnId`, `timestamp` — but no transcript path.)

### 2. The main ZCode session has no JSONL transcript

Claude Code writes the main session as JSONL under `~/.claude/projects/`.
ZCode stores the main session in a **relational SQLite database**
(`~/.zcode/cli/db/db.sqlite`), across the `session`, `message`, and `part`
tables. JSONL transcripts exist under `~/.zcode/cli/agents/<sess>/*/transcript.jsonl`
but **only for subagent sessions** — the main interactive session has none.

So even if we knew which session to read, there is no transcript file to hand
to an importer.

### 3. `codex resume` does not accept an external file

The Codex CLI's `resume` subcommand only resumes sessions from Codex's own
store (`~/.codex/sessions/`). There is no `--source <file>` flag, no
`--from-jsonl`, no `import` subcommand. The external-agent importer that
codex-plugin-cc uses is an **in-process** capability of the plugin runtime,
not a CLI surface — and that plugin runtime is the Claude Code plugin, which
does not run in ZCode.

## What we do instead: summary-based handoff

`/codex:transfer` on ZCode (in `scripts/transfer-zcode.mjs`) does:

1. **Resolve the current session** by matching `process.cwd()` against
   `session.directory` in `~/.zcode/cli/db/db.sqlite` (read-only). Falls back
   to the most recently updated interactive session if no directory match.
2. **Render a compressed transcript** by joining `message` → `part`:
   - User turns: rendered in full.
   - Assistant text: truncated to ~1500 chars per turn.
   - Tool calls: summarized as compact one-liners (`$ <cmd>`,
     `Read(<path>)`, `Bash(...)`, etc.) — never full file contents.
   - Reasoning / step-start / step-finish parts: skipped (interior
     scaffolding, no user value).
   - Total budget capped (~32k chars ≈ 8k tokens) to leave room for the
     Codex prompt wrapper; earlier turns truncated first.
3. **Seed a fresh Codex session** by piping the summary to `codex exec -`
   (read from stdin) with `-s workspace-write` so Codex can act on follow-ups.
4. **Print the new session id** (parsed from codex's JSON output) with a
   `codex resume <id>` hint, plus an explicit note that this is a fresh seed.

### What the user must understand

- This opens a **new** Codex session, not a continuation of a previous one.
- The new Codex session has **only the compressed summary**, not the full
  turn-by-turn history or tool I/O. Some detail is inevitably lost.
- It is one-way (ZCode → Codex). There is no command to pull a Codex session
  back into ZCode.

## When this can be upgraded to a true transfer

Any of these would unlock a faithful port:

- **ZCode exposes a session transcript path** (env var or SessionStart field),
  **and** the main session is written as a JSONL file Codex's importer accepts.
- **Codex CLI gains `resume --source <file>`** (or an `import` subcommand),
  letting us feed a synthesized transcript directly.
- **A Codex app-server API** for session import becomes callable from outside
  the Claude Code plugin.

Until then, the summary-based handoff is the honest, working substitute.

## Implementation notes

- Uses Node 22+ built-in `node:sqlite` (`DatabaseSync`) — no native module
  dependency, no `better-sqlite3` compilation step. The experimental warning
  is suppressed so it does not leak into the relayed stdout.
- Opens the DB read-only (`{ readOnly: true }`) — never writes to the session
  store.
- The prompt is piped to `codex exec` via stdin (`-` argument), not passed as
  a command-line string, to avoid shell-escaping and argv-length issues with
  large summaries.
- `--json` flag is supported for debugging: it prints the matched session and
  the rendered summary without launching Codex.
