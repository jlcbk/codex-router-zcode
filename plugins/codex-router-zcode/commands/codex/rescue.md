---
description: Delegate investigation, an explicit fix request, or follow-up rescue work to Codex
argument-hint: '[--background] [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh>] [what Codex should investigate, solve, or continue]'
allowed-tools: Bash
---

Hand a task to Codex. By default this runs Codex directly (`codex exec`) for
reliability — no background jobs, but it works even when the app-server broker
is flaky. Pass `--background` for a tracked background job (resume, status,
result) when the broker is healthy.

## Step 1 — locate the plugin runtime

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is `PLUGIN_ROOT`. If missing, tell the user to restart the ZCode session.

## Step 2 — parse flags from the request

From `$ARGUMENTS`, separate execution flags from the natural-language task:

- `--background` → use the companion `task` subcommand (tracked background job).
  Trade-off: enables `/codex:status` / `/codex:result` / `--resume`, but relies
  on the app-server broker, which may be unreliable in some network environments
  (e.g. behind a MITM TLS proxy). If the job fails with "Reconnecting...", fall
  back by re-running without `--background`.
- `--model <name>` → pass through. Map `spark` to `gpt-5.3-codex-spark`.
- `--effort <level>` → pass through (none|minimal|low|medium|high|xhigh).
- Everything else is the task text.

If the user did not supply a task, ask what Codex should investigate or fix.

## Step 3 — invoke Codex

**Default (direct, reliable — use unless `--background` was given):**

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" task-direct --write "<task text>"
```

Add `--read-only` instead of `--write` only if the user explicitly asked for
review/diagnosis/research without edits.

**Background (tracked job, needs healthy broker):**

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" task --background --write "<task text>"
```

Then tell the user: "Codex task started in the background. Check `/codex:status`
for progress and `/codex:result <id>` for output. If it fails with reconnect
errors, re-run without `--background`."

## Presenting the result

- Return the command's stdout verbatim. Do not paraphrase, summarize, rewrite,
  or add commentary before or after.
- For `task-direct`: the result includes a Codex session id; tell the user they
  can continue in Codex with `codex resume <id>`.
- If the run fails with TLS/certificate/reconnect errors, explain that this is
  a network-environment issue (a proxy is intercepting chatgpt.com traffic),
  not a Codex or plugin bug — and that retrying sometimes succeeds.

## Notes

- `--resume` / `--fresh` only apply to the `--background` path (companion task
  threads). `task-direct` always starts a fresh ephemeral Codex session.
- This command intentionally does **not** route through a subagent. ZCode does
  not load custom subagents from disk in this build, so the main session calls
  the adapter directly. Job isolation in `--background` mode is provided by the
  companion's job store, not by a subagent boundary.
