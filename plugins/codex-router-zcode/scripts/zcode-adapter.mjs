#!/usr/bin/env node
// zcode-adapter.mjs — bridge between ZCode command bodies and the vendored
// OpenAI codex-companion runtime.
//
// Why this exists
// ---------------
// The codex-companion runtime (vendored as a git submodule) was written for
// Claude Code. It works almost unmodified on ZCode because ZCode sets the
// Claude-compatible env vars (CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA). This
// adapter's only jobs are:
//
//   1. Locate the vendored codex-companion.mjs relative to itself.
//   2. Guarantee CLAUDE_PLUGIN_DATA is set (ZCode sets it, but we fall back to
//      the marker file or a tmp dir so direct CLI invocation still works).
//   3. Short-circuit the `transfer` subcommand to the ZCode-specific
//      transfer-zcode.mjs (the upstream `transfer` assumes Claude's
//      transcript_path, which ZCode does not expose).
//   4. Forward argv, stream stdio, and mirror the child's exit code.
//
// The submodule source is never modified.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const PLUGIN_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const COMPANION = path.join(
  PLUGIN_ROOT,
  "scripts",
  "vendor",
  "codex-plugin-cc",
  "plugins",
  "codex",
  "scripts",
  "codex-companion.mjs"
);
const TRANSFER_ZCODE = path.join(PLUGIN_ROOT, "scripts", "transfer-zcode.mjs");
const MARKER_FILE = path.join(os.homedir(), ".zcode", "codex-router-zcode-root");

function readMarkerPluginData() {
  try {
    const lines = fs.readFileSync(MARKER_FILE, "utf8").split("\n");
    // Line 1 = plugin root, line 2 = plugin data. Be defensive.
    return lines[1]?.trim() || null;
  } catch {
    return null;
  }
}

function ensurePluginDataEnv() {
  if (process.env.CLAUDE_PLUGIN_DATA) {
    return;
  }
  // ZCode normally sets it. If missing (e.g. invoked from a raw shell), fall
  // back to the marker, then to a tmp dir so state has somewhere to live.
  const fromMarker = readMarkerPluginData();
  if (fromMarker) {
    process.env.CLAUDE_PLUGIN_DATA = fromMarker;
    return;
  }
  const fallback = path.join(os.tmpdir(), "codex-router-zcode-data");
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {}
  process.env.CLAUDE_PLUGIN_DATA = fallback;
}

function run(file, args) {
  const child = spawn(process.execPath, [file, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("close", (code) => process.exit(code ?? 1));
  child.on("error", (err) => {
    process.stderr.write(`zcode-adapter: failed to launch ${path.basename(file)}: ${err.message}\n`);
    process.exit(1);
  });
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    process.stderr.write(
      "zcode-adapter: no subcommand given. Expected one of: setup, review, adversarial-review, task, transfer, status, result, cancel.\n"
    );
    process.exit(2);
  }

  const subcommand = argv[0];
  const rest = argv.slice(1);

  if (!fs.existsSync(COMPANION)) {
    process.stderr.write(
      `zcode-adapter: codex-companion.mjs not found at ${COMPANION}\n` +
        "The git submodule may be missing. Run: git submodule update --init --recursive\n"
    );
    process.exit(1);
  }

  // `transfer` is the one subcommand upstream cannot honor on ZCode (no
  // transcript_path). Route it to the ZCode-specific summary-based handoff.
  if (subcommand === "transfer") {
    if (!fs.existsSync(TRANSFER_ZCODE)) {
      process.stderr.write(
        `zcode-adapter: transfer-zcode.mjs not found at ${TRANSFER_ZCODE}\n`
      );
      process.exit(1);
    }
    run(TRANSFER_ZCODE, rest);
    return;
  }

  ensurePluginDataEnv();
  run(COMPANION, argv);
}

main();
