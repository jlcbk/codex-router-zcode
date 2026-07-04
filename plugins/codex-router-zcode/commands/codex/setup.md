---
description: Check whether the local Codex CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash
---

Check whether Codex is installed and authenticated for the codex-router-zcode plugin.

## Step 1 — locate the plugin runtime

The plugin writes its root path to a marker file on session start. Read it:

```bash
cat ~/.zcode/codex-router-zcode-root
```

Line 1 is the plugin root (`PLUGIN_ROOT`). Line 2 is the plugin data dir. If the
file is missing, the bootstrap hook has not run yet — tell the user to restart
the ZCode session and retry.

## Step 2 — run the setup check

Call the adapter's `setup` subcommand with the raw user arguments:

```bash
node "$PLUGIN_ROOT/scripts/zcode-adapter.mjs" setup $ARGUMENTS
```

## Presenting the result

- Return the command output to the user.
- If the result says Codex is unavailable and npm is available, ask the user
  (once, via AskUserQuestion) whether to install Codex now. Offer:
  - `Install Codex (Recommended)`
  - `Skip for now`
  If they choose install, run `npm install -g @openai/codex`, then re-run the
  setup command above and present that new output.
- If Codex is installed but not authenticated, preserve the guidance to run
  `codex login` (e.g. `!codex login` in the session).
- Do not paraphrase or summarize the readiness details — show them.

## Notes

- The review-gate toggle (`--enable-review-gate` / `--disable-review-gate`) is
  recorded by the runtime but the stop hook itself is not enabled in this
  ZCode build (see README "Known limitations"). The toggle is accepted for
  forward compatibility but has no live effect yet.
