---
description: Run a steerable Codex review that challenges the implementation and design choices
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [focus text]'
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

Run a **steerable** Codex review that questions the chosen implementation and
design. Use it to pressure-test assumptions, tradeoffs, failure modes, and
whether a different approach would have been safer or simpler. This command is
review-only.

## Step 1 — locate the plugin runtime

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is `PLUGIN_ROOT`. If missing, tell the user to restart the ZCode session.

## Core constraint

- Review-only. Do not fix code.

## Raw arguments

`$ARGUMENTS` — preserve them exactly, including any focus text after the flags.

## Decide foreground vs background

Same rule as `/codex:review`:

- `--wait` in args → foreground, do not ask.
- `--background` in args → background, do not ask.
- Otherwise estimate size (git diff shortstat, untracked files) and use
  `AskUserQuestion` once with two options, recommended first:
  - `Wait for results`
  - `Run in background`
  - Default recommendation: background (adversarial reviews tend to be long).

## Foreground flow

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" adversarial-review $ARGUMENTS
```

Return stdout verbatim. No commentary, no fixes.

## Background flow

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" adversarial-review $ARGUMENTS
```

Pass `run_in_background: true` to Bash. Do not wait. After launching, tell the
user:

"Codex adversarial review started in the background. Check `/codex:status` for
progress."
