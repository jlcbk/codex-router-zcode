#!/usr/bin/env node
// bootstrap-session.mjs — ZCode SessionStart hook entry point.
//
// ZCode does NOT expand template variables inside command .md bodies, and a
// plugin cannot ship a runnable subagent (the manifest `agents` field is
// "recorded but not executed"). This hook closes both gaps once per session
// start:
//
//   1. Write a marker file (~/.zcode/codex-router-zcode-root) recording the
//      plugin root + plugin-data paths, so command bodies and the rescue
//      subagent can read it and locate the runtime.
//   2. Idempotently copy agents/codex-rescue.md into ~/.zcode/agents/.
//   3. Idempotently mirror skills/codex-router into ~/.agents/skills/.
//
// It emits nothing on stdout (ZCode enforces a strict hook output schema), and
// never exits non-zero on a soft failure — a broken bootstrap must not block
// the session from starting.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const HOME = os.homedir();
const MARKER_FILE = path.join(HOME, ".zcode", "codex-router-zcode-root");
const AGENTS_DEST_DIR = path.join(HOME, ".zcode", "agents");
const SKILLS_DEST_DIR = path.join(HOME, ".agents", "skills");

// The plugin root is passed via env (ZCode expands ${ZCODE_PLUGIN_ROOT} in the
// hook command). Fall back to deriving it from this script's location.
const PLUGIN_ROOT =
  process.env.ZCODE_PLUGIN_ROOT ||
  process.env.CLAUDE_PLUGIN_ROOT ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Write text to dest only if content changed. Returns true if written.
function writeIfChanged(dest, text) {
  let existing = "";
  try {
    existing = fs.readFileSync(dest, "utf8");
  } catch {}
  if (existing === text) {
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  return true;
}

// Copy file if its hash differs from the destination. Returns true if copied.
// Handles a destination that is a symlink (e.g. a previous codex-router-skill
// install): we resolve the link, compare, and if needed replace it with a real
// file containing our content.
function copyIfChanged(src, dest) {
  let srcText, destText;
  try {
    srcText = fs.readFileSync(src, "utf8");
  } catch {
    return false; // source missing — skip silently
  }
  try {
    destText = fs.readFileSync(dest, "utf8");
  } catch {
    destText = null;
  }
  if (destText !== null && sha256(destText) === sha256(srcText)) {
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // If dest is a symlink (or any odd type), unlink before writing so we replace
  // it with a regular file rather than writing through the link target.
  try {
    const stat = fs.lstatSync(dest);
    if (!stat.isFile()) {
      fs.unlinkSync(dest);
    }
  } catch {
    // not present — fine
  }
  fs.writeFileSync(dest, srcText);
  return true;
}

// Recursively mirror a directory tree, copying files whose content differs.
// Removes nothing — destination may hold extra files the user added. Returns
// count of files written.
//
// If destDir itself is a symlink (e.g. a previous codex-router-skill install
// pointed ~/.agents/skills/codex-router at its own tree), we replace it with a
// real directory so we own it going forward.
function mirrorTree(srcDir, destDir) {
  let written = 0;
  let entries;
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  // Replace a symlinked directory with a real directory we own.
  try {
    const stat = fs.lstatSync(destDir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(destDir);
    }
  } catch {
    // not present — fine
  }
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      written += mirrorTree(srcPath, destPath);
    } else if (entry.isFile()) {
      if (copyIfChanged(srcPath, destPath)) written++;
    }
  }
  return written;
}

function debug(message) {
  if (!process.env.CODEX_ROUTER_ZCODE_DEBUG) return;
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), "codex-router-zcode-bootstrap.log"),
      JSON.stringify({ ts: new Date().toISOString(), ...message }) + "\n"
    );
  } catch {}
}

function main() {
  // Drain stdin (ZCode pipes the hook input JSON); we don't need it here, but
  // reading it keeps the pipe from breaking on some platforms.
  readStdin();

  const summary = { marker: false, agents: {}, skillFiles: 0 };

  // 1. Marker file.
  const pluginRoot = process.env.ZCODE_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || "";
  const pluginData = process.env.ZCODE_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || "";
  if (pluginRoot) {
    const payload = pluginRoot + "\n" + pluginData + "\n";
    summary.marker = writeIfChanged(MARKER_FILE, payload);
  }

  // 2. Deploy subagents into ~/.zcode/agents/. Both the high-end rescue agent
  // and the fallback codex-engineer agent live in the plugin's agents/ dir;
  // mirror every .md file there so adding a future agent needs no code change.
  const agentsSrcDir = path.join(PLUGIN_ROOT, "agents");
  try {
    for (const entry of fs.readdirSync(agentsSrcDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const src = path.join(agentsSrcDir, entry.name);
      const dest = path.join(AGENTS_DEST_DIR, entry.name);
      summary.agents[entry.name] = copyIfChanged(src, dest);
    }
  } catch {
    // agents/ missing — skip
  }

  // 3. Mirror the router skill into ~/.agents/skills/codex-router/.
  const skillSrc = path.join(PLUGIN_ROOT, "skills", "codex-router");
  const skillDest = path.join(SKILLS_DEST_DIR, "codex-router");
  summary.skillFiles = mirrorTree(skillSrc, skillDest);

  debug(summary);
}

try {
  main();
} catch (err) {
  // Never block the session on a bootstrap failure.
  debug({ error: err instanceof Error ? err.message : String(err) });
}

// Exit cleanly with no stdout (ZCode strict hook schema).
process.exit(0);
