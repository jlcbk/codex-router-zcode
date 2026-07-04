---
description: Cancel an active background Codex job
argument-hint: '[job-id]'
allowed-tools: Bash
---

Cancel an active background Codex job.

## Step 1 — locate the plugin runtime

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is `PLUGIN_ROOT`. If missing, tell the user to restart the ZCode session.

## Step 2 — run cancel

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" cancel $ARGUMENTS
```

## Presenting the result

Return the command output to the user verbatim. Do not add commentary.
