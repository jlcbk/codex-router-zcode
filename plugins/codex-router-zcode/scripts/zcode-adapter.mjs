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

import { spawn, spawnSync } from "node:child_process";
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

// Valid subcommands. `task-direct` is a ZCode-specific addition that bypasses
// the companion app-server broker and runs `codex exec` directly — used when
// the broker is unreliable in a given environment (see README "Known
// limitations" → app-server broker).
const SUBCOMMANDS = [
  "setup",
  "review",
  "adversarial-review",
  "task",
  "task-direct",
  "transfer",
  "status",
  "result",
  "cancel",
];

function printHelp() {
  process.stdout.write(
    [
      "Usage: node zcode-adapter.mjs <subcommand> [args]",
      "",
      "Bridge between ZCode command bodies and the vendored codex-companion runtime.",
      "",
      "Subcommands forwarded to codex-companion (untouched argv):",
      "  setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  review [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch]",
      "  adversarial-review [--wait|--background] [--base <ref>] [focus text]",
      "  task [--background] [--write] [--resume-last] [--model <m>] [--effort <e>] [prompt]",
      "  status [job-id] [--all] [--json]",
      "  result [job-id] [--json]",
      "  cancel [job-id] [--json]",
      "",
      "ZCode-specific subcommands:",
      "  task-direct [--write] [--read-only] [prompt]   Run codex exec directly, bypassing",
      "                                                  the app-server broker. Reliable when",
      "                                                  the broker is flaky; no background jobs.",
      "  transfer [--source <path>] [--json]             Summary-based handoff to a fresh Codex",
      "                                                  session (reads the ZCode session DB).",
      "",
      "How command bodies locate this script:",
      "  Read ~/.zcode/codex-router-zcode-root line 1 for PLUGIN_ROOT, then call",
      "  node $PLUGIN_ROOT/scripts/zcode-adapter.mjs <subcommand> ...",
      "",
      "Environment:",
      "  ZCode sets CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA natively for plugin hooks.",
      "  For direct CLI use this adapter reconstructs CLAUDE_PLUGIN_DATA from the marker",
      "  file (or a tmp fallback) so the companion runtime can locate its state dir.",
      "",
    ].join("\n")
  );
}

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

function taskDirect(args) {
  // ZCode-specific: run `codex exec` directly, bypassing the companion app-server
  // broker. Used when the broker is unreliable (see README). Trade-off: no
  // background jobs, no resume, no structured job tracking — just a direct,
  // synchronous Codex run. Reliable.
  let write = true;
  let promptParts = [];
  for (const a of args) {
    if (a === "--write") {
      write = true;
    } else if (a === "--read-only") {
      write = false;
    } else {
      promptParts.push(a);
    }
  }
  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    process.stderr.write(
      "task-direct: no prompt given. Usage: task-direct [--write|--read-only] <prompt>\n"
    );
    process.exit(2);
  }
  if (!fs.existsSync(COMPANION)) {
    process.stderr.write(`zcode-adapter: codex-companion.mjs missing at ${COMPANION}\n`);
    process.exit(1);
  }

  // Write prompt to a temp file to avoid argv length / escaping issues, then
  // feed it via stdin with `codex exec -`.
  const promptFile = path.join(os.tmpdir(), `codex-task-direct-${process.pid}.md`);
  fs.writeFileSync(promptFile, prompt);
  const resultFile = path.join(os.tmpdir(), `codex-task-direct-${process.pid}.out`);

  const codexArgs = [
    "exec",
    "--json",
    "--ephemeral",
    "-s",
    write ? "workspace-write" : "read-only",
    "-C",
    process.cwd(),
    "-o",
    resultFile,
    "-",
  ];

  process.stderr.write("[task-direct] running codex exec directly (bypassing broker)...\n");
  const child = spawn("codex", codexArgs, { stdio: ["pipe", "inherit", "inherit"] });
  child.on("error", (err) => {
    fs.unlink(promptFile, () => {});
    process.stderr.write(`[task-direct] failed to launch codex: ${err.message}\n`);
    process.exit(1);
  });
  child.stdin.write(prompt);
  child.stdin.end();
  child.on("close", (code) => {
    fs.unlink(promptFile, () => {});
    // Print the structured result if available, mirroring companion's shape.
    try {
      const raw = fs.readFileSync(resultFile, "utf8");
      const parsed = JSON.parse(raw);
      const sid = parsed.session_id || parsed.sessionId || null;
      process.stdout.write("\n--- task-direct result ---\n");
      if (sid) {
        process.stdout.write(`Codex session: ${sid}\n`);
        process.stdout.write(`Resume in Codex: codex resume ${sid}\n`);
      }
      if (parsed.rawOutput) {
        process.stdout.write("\n" + parsed.rawOutput + "\n");
      }
    } catch {
      // codex may not have produced structured output; rely on streamed stdout.
    }
    try {
      fs.unlink(resultFile, () => {});
    } catch {}
    process.exit(code ?? 1);
  });
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    if (argv.length === 0) {
      // No subcommand: print help to stderr + exit 2 (treat as usage error).
      printHelpToStderr();
      process.exit(2);
    }
    printHelp();
    process.exit(0);
  }

  const subcommand = argv[0];
  const rest = argv.slice(1);

  if (!SUBCOMMANDS.includes(subcommand)) {
    process.stderr.write(
      `zcode-adapter: unknown subcommand '${subcommand}'. Expected one of: ${SUBCOMMANDS.join(", ")}.\n` +
        "Run with --help for usage.\n"
    );
    process.exit(2);
  }

  if (!fs.existsSync(COMPANION)) {
    process.stderr.write(
      `zcode-adapter: codex-companion.mjs not found at ${COMPANION}\n` +
        "The git submodule may be missing. Run: git submodule update --init --recursive\n"
    );
    process.exit(1);
  }

  // ZCode-specific: direct codex exec, bypassing the companion broker.
  if (subcommand === "task-direct") {
    ensurePluginDataEnv();
    taskDirect(rest);
    return;
  }

  // `transfer` is the one subcommand upstream cannot honor on ZCode (no
  // transcript_path). Route it to the ZCode-specific summary-based handoff.
  if (subcommand === "transfer") {
    if (!fs.existsSync(TRANSFER_ZCODE)) {
      process.stderr.write(`zcode-adapter: transfer-zcode.mjs not found at ${TRANSFER_ZCODE}\n`);
      process.exit(1);
    }
    run(TRANSFER_ZCODE, rest);
    return;
  }

  ensurePluginDataEnv();
  run(COMPANION, argv);
}

function printHelpToStderr() {
  process.stderr.write(
    "zcode-adapter: no subcommand given. Expected one of: " +
      SUBCOMMANDS.join(", ") +
      ".\nRun with --help for usage.\n"
  );
}

main();
