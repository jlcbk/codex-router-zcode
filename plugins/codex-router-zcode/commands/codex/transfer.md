---
description: Seed a fresh Codex session with a compressed summary of the current ZCode session (summary-based handoff, not a resumable Codex thread)
argument-hint: '[--source <path>] [--json]'
allowed-tools: Bash
---

Hand the current ZCode session context over to Codex as a **fresh session**.

> **Important — what this does on ZCode.** Claude Code's `/codex:transfer`
> imports the live transcript into a resumable Codex thread. ZCode does not
> expose the session transcript path and `codex resume` does not accept an
> external file, so this command instead renders a compressed summary of the
> current session from the local ZCode session store and feeds it to
> `codex exec` to start a brand-new Codex session. The result is a **fresh
> seed**, not a thread you can `codex resume` back into. Tell the user this.

## Step 1 — locate the plugin runtime

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is `PLUGIN_ROOT`. If missing, tell the user to restart the ZCode session.

## Step 2 — run the ZCode handoff

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" transfer $ARGUMENTS
```

The adapter routes `transfer` to the ZCode-specific handoff script
(`transfer-zcode.mjs`), which:

1. Reads the current ZCode session from `~/.zcode/cli/db/db.sqlite` (matched by
   the current working directory).
2. Renders a compressed transcript (user turns in full, assistant text
   truncated, tool calls summarized) up to a token budget.
3. Feeds the summary to `codex exec` to start a new Codex session.
4. Prints the new Codex session ID (when available) and the summary that was
   handed off.

## Presenting the result

Return the command output to the user verbatim. Make sure the user understands:
- This opened a **new** Codex session, not a continuation of a previous one.
- To keep working in Codex directly, run `codex resume` and pick the session
  just created (its ID is in the output when Codex reports one).
- `--source <path>` is accepted for forward compatibility but currently only
  the local ZCode session store is read.

## Notes / limitations

- If the session store cannot be read (older ZCode, locked DB, etc.), the
  command reports the error and exits. Do not retry silently — surface it.
- The handoff is one-way (ZCode → Codex). There is no command to pull a Codex
  session back into ZCode.
