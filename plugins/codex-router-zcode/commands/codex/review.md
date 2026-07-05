---
description: Run a Codex code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch]'
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

Run a Codex review through the shared built-in reviewer. This command is
review-only — do not fix issues, apply patches, or suggest changes are coming.

## Step 1 — locate the plugin runtime

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is `PLUGIN_ROOT`. If missing, tell the user to restart the ZCode session.

## Core constraint

- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return Codex's output verbatim.

## Raw arguments

`$ARGUMENTS` — preserve them exactly. Do not strip `--wait` or `--background`.

## Decide foreground vs background

- If the raw arguments include `--wait`, do not ask. Run the review in the
  foreground.
- If the raw arguments include `--background`, do not ask. Run the review in a
  background Bash task.
- Otherwise, estimate the review size before asking:
  - For working-tree review, run `git status --short --untracked-files=all`.
  - Also inspect `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, run `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work even when the diff
    shortstat is empty.
  - Recommend waiting only when the review is clearly tiny (roughly 1–2 files
    total, no sign of a broader directory-sized change).
  - In every other case, including unclear size, recommend background.
  - When in doubt, run the review rather than declaring there is nothing to
    review.
- Then use `AskUserQuestion` exactly once with two options, putting the
  recommended option first and suffixing its label with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

## Foreground flow

Run (note: the companion parses `--wait`/`--background`, so forward all args):

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" review $ARGUMENTS
```

Return the stdout verbatim, exactly as-is. Do not paraphrase, summarize, or add
commentary. Do not fix any issues mentioned in the review output.

> Network note: review drives Codex via the app-server broker, so in a network
> environment where `chatgpt.com` is intercepted (TLS MITM proxy), the model
> response can stall indefinitely after the file-reading phase — `/codex:status`
> will show `phase: running` with no log progress. If that happens, cancel with
> `/codex:cancel <id>` and retry on a healthy network. This is the same root
> cause as `/codex:rescue --background` failures (see README "Known limitations").

## Background flow

Launch the review with Bash in the background:

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" review $ARGUMENTS
```

Pass `run_in_background: true` to the Bash tool. Do not call BashOutput or wait
for completion in this turn. After launching, tell the user:

"Codex review started in the background. Check `/codex:status` for progress."
