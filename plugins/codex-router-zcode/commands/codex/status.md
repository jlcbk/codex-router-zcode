---
description: Show active and recent Codex jobs for this repository, including review-gate status
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--all]'
allowed-tools: Bash
---

Show running and recent Codex jobs for the current repository.

## Step 1 — locate the plugin runtime

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is `PLUGIN_ROOT`. If missing, tell the user to restart the ZCode session.

## Step 2 — run status

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" status $ARGUMENTS
```

## Presenting the result

- If the user did **not** pass a job ID: render the output as a single compact
  Markdown table covering current and past runs in this session. Keep it tight —
  no progress blocks or extra prose outside the table. Preserve the actionable
  fields: job ID, kind, status, phase, elapsed/duration, summary, and follow-up
  commands (such as `/codex:result <id>`).
- If the user **did** pass a job ID: present the full command output verbatim.
  Do not summarize or condense it.
