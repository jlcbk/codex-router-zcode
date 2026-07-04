#!/usr/bin/env node
// transfer-zcode.mjs — summary-based session handoff from ZCode to Codex.
//
// Claude Code's /codex:transfer imports the live transcript into a resumable
// Codex thread. ZCode cannot do that (no transcript_path exposed; main session
// has no JSONL; codex resume does not accept external files). This is the
// ZCode-native substitute: render a compressed summary of the current session
// from ~/.zcode/cli/db/db.sqlite and feed it to `codex exec` to seed a NEW
// Codex session. The result is a fresh-context seed, not a resumable thread.
//
// Output goes to stdout for the command body to relay verbatim.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// node:sqlite is available in Node 22+ (experimental but stable enough for
// read-only access). Suppress its experimental warning so it does not leak
// into the relayed stdout.
process.emitWarning = () => {};

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (err) {
  process.stdout.write(
    `[transfer-zcode] This Node version (${process.version}) does not provide node:sqlite. ` +
      `Node 22+ is required for /codex:transfer.\n`
  );
  process.exit(1);
}

// --- locate the session store ---------------------------------------------------
function resolveDbPath() {
  // 1. explicit --source <path> (forward-compat; currently treated as the db path)
  const srcIdx = process.argv.indexOf("--source");
  if (srcIdx !== -1 && process.argv[srcIdx + 1]) {
    return process.argv[srcIdx + 1];
  }
  // 2. default location
  return path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");
}

function findCurrentSession(db, cwd) {
  // Match by directory; fall back to most recent interactive session.
  const byDir = db
    .prepare(
      `SELECT id, directory, title FROM session
       WHERE task_type = 'interactive' AND directory = ?
       ORDER BY time_updated DESC LIMIT 1`
    )
    .get(cwd);
  if (byDir) return byDir;
  return db
    .prepare(
      `SELECT id, directory, title FROM session
       WHERE task_type = 'interactive'
       ORDER BY time_updated DESC LIMIT 1`
    )
    .get();
}

// --- render a compressed transcript ---------------------------------------------
// Token budget for the rendered summary. Rough char/4 estimate. Keep it small
// enough to leave room for the Codex prompt wrapper.
const MAX_CHARS = 32000;

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 20) + "\n…[truncated]";
}

function summarizeToolInput(toolName, input) {
  // Render a tool call as a compact one-liner-ish block. Never dump full file
  // contents or long command strings.
  if (toolName === "Bash" && input?.command) {
    return `$ ${truncate(String(input.command), 200)}`;
  }
  if ((toolName === "Read" || toolName === "Write" || toolName === "Edit") && input?.file_path) {
    return `${toolName}(${truncate(String(input.file_path), 120)})`;
  }
  if (toolName === "Grep" || toolName === "Glob") {
    return `${toolName}(${truncate(JSON.stringify(input?.pattern ?? input?.path ?? ""), 100)})`;
  }
  // generic fallback: top-level keys only
  const keys = input && typeof input === "object" ? Object.keys(input).join(",") : "";
  return `${toolName}(${keys})`;
}

function renderTranscript(db, sessionId) {
  const messages = db
    .prepare(
      `SELECT id, data FROM message
       WHERE session_id = ?
       ORDER BY time_created ASC, id ASC`
    )
    .all(sessionId);

  const lines = [];
  let used = 0;

  for (const msg of messages) {
    let role = "unknown";
    try {
      role = JSON.parse(msg.data).role || "unknown";
    } catch {}

    const parts = db
      .prepare(
        `SELECT data FROM part
         WHERE message_id = ?
         ORDER BY time_created ASC, id ASC`
      )
      .all(msg.id);

    // Render only the meaningful part types: text + tool. Skip reasoning,
    // step-start/finish (interior scaffolding, no user value).
    const userVisible = [];
    for (const p of parts) {
      let d;
      try {
        d = JSON.parse(p.data);
      } catch {
        continue;
      }
      if (d.type === "text" && typeof d.text === "string" && d.text.trim()) {
        userVisible.push({ kind: "text", text: d.text });
      } else if (d.type === "tool" && d.tool) {
        userVisible.push({ kind: "tool", tool: d.tool, input: d.state?.input ?? d.input });
      }
    }
    if (userVisible.length === 0) continue;

    const header = role === "user" ? "## User" : role === "assistant" ? "## Assistant" : `## ${role}`;
    const block = [header];
    for (const item of userVisible) {
      if (item.kind === "text") {
        block.push(role === "user" ? item.text : truncate(item.text, 1500));
      } else {
        block.push("```");
        block.push(summarizeToolInput(item.tool, item.input));
        block.push("```");
      }
    }
    const blockText = block.join("\n") + "\n";

    if (used + blockText.length > MAX_CHARS) {
      lines.push("\n…[earlier turns truncated to fit budget]\n");
      break;
    }
    lines.push(blockText);
    used += blockText.length;
  }

  return lines.join("\n");
}

// --- seed a fresh Codex session -------------------------------------------------
function seedCodex(cwd, summary, sessionTitle) {
  const prompt = [
    "You are continuing work that was started in another environment (ZCode).",
    "Below is a compressed summary of the prior session. Read it, then wait for the user's next instruction.",
    "",
    `Prior session title: ${sessionTitle || "(untitled)"}`,
    `Working directory: ${cwd}`,
    "",
    "--- BEGIN PRIOR SESSION SUMMARY ---",
    summary,
    "--- END PRIOR SESSION SUMMARY ---",
    "",
    "Briefly acknowledge what you understand the current state and open task to be, then stop.",
  ].join("\n");

  // codex exec reads the prompt from stdin when `-` is given as the PROMPT
  // argument (or when no prompt arg is provided and stdin is piped). Using `-`
  // avoids any shell-escaping / command-line-length issues with a large summary.
  const resultFile = path.join(os.tmpdir(), `codex-transfer-${process.pid}.result.json`);
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "-s",
    "workspace-write",
    "-C",
    cwd,
    "-o",
    resultFile,
    "-", // read prompt from stdin
  ];

  // stdio: inherit for tty feel on stdout/stderr, but pipe stdin so we can
  // write the prompt.
  const child = spawn("codex", args, { stdio: ["pipe", "inherit", "inherit"] });
  child.on("error", (err) => {
    process.stderr.write(`[transfer-zcode] failed to launch codex: ${err.message}\n`);
    process.exit(1);
  });
  child.stdin.write(prompt);
  child.stdin.end();

  child.on("close", (code) => {
    let sessionId = null;
    try {
      const raw = fs.readFileSync(resultFile, "utf8");
      const parsed = JSON.parse(raw);
      sessionId = parsed.session_id || parsed.sessionId || null;
    } catch {}
    try {
      fs.unlink(resultFile, () => {});
    } catch {}

    process.stdout.write("\n--- /codex:transfer (ZCode) ---\n");
    if (sessionId) {
      process.stdout.write(
        `Seeded a NEW Codex session: ${sessionId}\n` +
          `To continue it directly in Codex: codex resume ${sessionId}\n`
      );
    } else {
      process.stdout.write("Codex run completed (session id not reported).\n");
    }
    process.stdout.write(
      "\nNote: this is a fresh-context seed, not a resumable ZCode↔Codex thread.\n" +
        "ZCode does not expose the session transcript path and codex resume does\n" +
        "not accept an external file, so the prior session could only be handed\n" +
        "over as a compressed summary.\n"
    );
    process.exit(code ?? 1);
  });
}

// --- main -----------------------------------------------------------------------
function main() {
  const asJson = process.argv.includes("--json");
  const dbPath = resolveDbPath();

  if (!fs.existsSync(dbPath)) {
    process.stdout.write(
      `[transfer-zcode] ZCode session store not found at ${dbPath}.\n` +
        "This command needs the local ZCode session database.\n"
    );
    process.exit(1);
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    process.stdout.write(
      `[transfer-zcode] Could not open the ZCode session store: ${err.message}\n` +
        "The database may be locked or in an incompatible format.\n"
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const session = findCurrentSession(db, cwd);
  if (!session) {
    process.stdout.write(`[transfer-zcode] No ZCode session found for ${cwd}.\n`);
    db.close();
    process.exit(1);
  }

  let summary;
  try {
    summary = renderTranscript(db, session.id);
  } catch (err) {
    process.stdout.write(`[transfer-zcode] Failed to read session: ${err.message}\n`);
    db.close();
    process.exit(1);
  }
  db.close();

  if (!summary.trim()) {
    process.stdout.write(
      `[transfer-zcode] The current session has no renderable turns yet.\n` +
        "Run /codex:transfer again once there is some conversation to hand off.\n"
    );
    process.exit(0);
  }

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        { session: { id: session.id, title: session.title, directory: session.directory }, summary },
        null,
        2
      ) + "\n"
    );
    process.exit(0);
  }

  // Sanity: codex on PATH?
  const check = spawnSync("codex", ["--version"], { encoding: "utf8" });
  if (check.status !== 0) {
    process.stdout.write(
      "[transfer-zcode] codex CLI not available. Run /codex:setup first.\n"
    );
    process.exit(1);
  }

  seedCodex(cwd, summary, session.title);
}

main();
