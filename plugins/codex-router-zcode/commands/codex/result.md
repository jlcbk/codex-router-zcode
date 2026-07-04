---
description: Show the stored final output for a finished Codex job in this repository
argument-hint: '[job-id]'
allowed-tools: Bash
---

Show the stored final output for a finished Codex job.

## Step 1 — locate the plugin runtime

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is `PLUGIN_ROOT`. If missing, tell the user to restart the ZCode session.

## Step 2 — run result

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" result $ARGUMENTS
```

## Presenting the result

Present the full command output to the user. Do not summarize or condense it.
Preserve all details including:
- Job ID and status
- The complete result payload (verdict, summary, findings, details, artifacts,
  next steps)
- File paths and line numbers exactly as reported
- Any error messages or parse errors
- Follow-up commands such as `/codex:status <id>` and `/codex:review`

When the output includes a Codex session ID, mention that the user can reopen
that run directly in Codex with `codex resume <session-id>`.
