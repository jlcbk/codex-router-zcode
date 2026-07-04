---
description: Delegate investigation, an explicit fix request, or follow-up rescue work to Codex via the codex-rescue subagent
argument-hint: '[--background|--wait] [--resume|--fresh] [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh>] [what Codex should investigate, solve, or continue]'
allowed-tools: Bash, AskUserQuestion, Agent
---

Hand a task to Codex through the `codex-rescue` subagent.

## Step 1 — locate the plugin runtime

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is `PLUGIN_ROOT`. If missing, tell the user to restart the ZCode session.
Pass `PLUGIN_ROOT` to the subagent in the prompt so it can build the adapter
call (the subagent reads the same marker file, but giving it the value saves a
round-trip).

## How to route this command

Invoke the `codex-rescue` subagent via the `Agent` tool
(`subagent_type: "codex-rescue"`), forwarding the raw user request as the
prompt. **Do not** call `Skill(codex-rescue)` — it is a subagent, not a skill.

The command runs inline so the `Agent` tool stays in scope; forked
general-purpose subagents do not expose it.

The final user-visible response must be Codex's output verbatim.

## Raw user request

$ARGUMENTS

## Execution mode (decide before spawning the subagent)

- If the request includes `--background`, run the `codex-rescue` subagent in the
  background.
- If the request includes `--wait`, run it in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for the host. Do not forward
  them as part of the natural-language task text.
- `--model` and `--effort` are runtime-selection flags. Preserve them in the
  forwarded prompt, but do not treat them as natural-language text.
- If the request includes `--resume` or `--fresh`, do not ask about continuing —
  the user already chose.
- Otherwise, before spawning the subagent, check for a resumable rescue thread
  from this session by running:

  ```bash
  node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" __resume-candidate --json 2>/dev/null || true
  ```

  > Note: this helper may not exist in the current runtime; if the command
  > errors or prints nothing, treat it as "no resumable thread" and proceed
  > without asking.

  - If a resumable thread is reported, use `AskUserQuestion` exactly once:
    - `Continue current Codex thread`
    - `Start a new Codex thread`
    - If the user is clearly giving a follow-up ("continue", "keep going",
      "resume", "apply the top fix", "dig deeper"), put
      `Continue current Codex thread (Recommended)` first.
    - Otherwise put `Start a new Codex thread (Recommended)` first.
  - If they choose continue, add `--resume` before forwarding. If new, add
    `--fresh`.
  - If no resumable thread, route normally without asking.

## Operating rules

- The `codex-rescue` subagent is a thin forwarder: it makes one Bash call to
  `node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" task ...` and returns that
  command's stdout as-is. Tell it the value of `PLUGIN_ROOT` in the prompt.
- Return the subagent's output verbatim to the user. Do not paraphrase,
  summarize, rewrite, or add commentary before or after.
- Do not ask the subagent to inspect files, monitor progress, poll
  `/codex:status`, fetch `/codex:result`, call `/codex:cancel`, summarize
  output, or do follow-up work of its own.
- Leave `--effort` unset unless the user explicitly asks for a specific effort.
- Leave the model unset unless the user explicitly asks for one. If they ask
  for `spark`, map it to `gpt-5.3-codex-spark`.
- If the user did not supply a request, ask what Codex should investigate or
  fix.
