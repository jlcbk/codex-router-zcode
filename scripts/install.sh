#!/usr/bin/env bash
# install.sh — install codex-router-zcode baseline + routing profile into ZCode.
#
# This installer writes the always-on routing baseline and the tunable routing
# profile into ~/.zcode/AGENTS.md. The plugin itself (commands, agents, hooks,
# skills) is installed separately via ZCode's Plugin Management UI — see the
# README. This script only handles the AGENTS.md policy layer.
#
# Routing profiles (--profile):
#   glm-only      never use Codex unless the user explicitly asks
#   savings       (default) Codex only for proven hard/high-risk work
#   balanced      earlier Codex planning/review for complex work
#   quality       more Codex judgment for taste/risk-heavy work
#   codex-heavy   short bursts where quality/independence beats cost
#
# Idempotent: re-running safely updates both the baseline block and the profile
# block (each splice-replaced between its own markers), preserving any other
# content the user has in AGENTS.md.
set -euo pipefail

# --- args -------------------------------------------------------------------------
PROFILE="savings"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile)
            [[ $# -ge 2 ]] || { echo "ERROR: --profile requires a value (glm-only|savings|balanced|quality|codex-heavy)" >&2; exit 1; }
            PROFILE="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,18p' "$0"
            exit 0
            ;;
        *)
            echo "ERROR: unknown argument '$1' (run with --help for usage)" >&2
            exit 1 ;;
    esac
done

case "$PROFILE" in
    glm-only|savings|balanced|quality|codex-heavy) ;;
    *) echo "ERROR: --profile must be one of: glm-only, savings, balanced, quality, codex-heavy (got '$PROFILE')" >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE_FILE="$HOME/.zcode/AGENTS.md"

echo "Installing codex-router-zcode baseline (target: ZCode)"
echo "  source: $REPO_ROOT"
echo "  routing profile: $PROFILE"
echo ""

# --- submodule sanity check ------------------------------------------------------
if [[ ! -f "$REPO_ROOT/plugins/codex-router-zcode/scripts/vendor/codex-plugin-cc/plugins/codex/scripts/codex-companion.mjs" ]]; then
    echo "  ⚠ Vendored codex-companion.mjs not found."
    echo "    The git submodule may be missing. Run:"
    echo "      git -C \"$REPO_ROOT\" submodule update --init --recursive"
    echo "    The plugin's advanced backend will not work until this is fixed."
    echo ""
fi

# --- splice helpers --------------------------------------------------------------
# splice_block FILE BEGIN_MARK END_MARK BODY_FILE
# Replaces everything between (and including) BEGIN_MARK and END_MARK in FILE
# with the contents of BODY_FILE, surrounded by the markers. If the markers
# are not present, appends BODY_FILE at the end of FILE. Other content is kept.
splice_block() {
    local file="$1" begin="$2" end="$3" body="$4"
    local tmp
    tmp="$(mktemp)"

    if [[ -f "$file" ]] && grep -qF "$begin" "$file" 2>/dev/null && grep -qF "$end" "$file" 2>/dev/null; then
        # Markers present: rebuild the file with the block replaced.
        # AWK reads the whole file line by line; when it sees `begin` it emits
        # the new block (begin + body + end) and skips ahead past `end`.
        awk -v begin="$begin" -v end="$end" -v body="$body" '
            function emit_body(    line) {
                while ((getline line < body) > 0) print line
                close(body)
            }
            $0 == begin {
                print begin
                emit_body()
                print end
                skipping = 1
                next
            }
            $0 == end { skipping = 0; next }
            !skipping { print }
        ' "$file" > "$tmp"
        mv "$tmp" "$file"
        return 0   # updated
    else
        # Markers absent: append.
        {
            echo ""
            echo "$begin"
            cat "$body"
            echo "$end"
        } >> "$file"
        rm -f "$tmp"
        return 1   # appended
    fi
}

# --- 1. Baseline block -----------------------------------------------------------
BASELINE_MARKER_BEGIN="<!-- codex-router-zcode baseline:start -->"
BASELINE_MARKER_END="<!-- codex-router-zcode baseline:end -->"
BASELINE_BODY="$(mktemp)"
{
    cat "$REPO_ROOT/AGENTS.md"
} > "$BASELINE_BODY"
# Strip any stray baseline markers from the body itself (defensive).
mkdir -p "$(dirname "$BASELINE_FILE")"
touch "$BASELINE_FILE"

if splice_block "$BASELINE_FILE" "$BASELINE_MARKER_BEGIN" "$BASELINE_MARKER_END" "$BASELINE_BODY"; then
    echo "  ✓ Updated baseline in $BASELINE_FILE"
else
    echo "  ✓ Appended baseline to $BASELINE_FILE"
fi
rm -f "$BASELINE_BODY"

# --- 2. Routing profile block ----------------------------------------------------
PROFILE_BEGIN="<!-- codex-router-zcode routing-profile:start -->"
PROFILE_END="<!-- codex-router-zcode routing-profile:end -->"

profile_label()    { case "$1" in
        glm-only)   echo "GLM-only lockdown" ;;
        savings)    echo "savings-first default" ;;
        balanced)   echo "balanced engineering" ;;
        quality)    echo "quality-first delivery" ;;
        codex-heavy) echo "Codex-heavy burst" ;;
    esac ;}
profile_ratio()    { case "$1" in
        glm-only)   echo "GLM 100% / Codex 0%, unless the user explicitly asks for Codex" ;;
        savings)    echo "GLM 90-95% / Codex 5-10%" ;;
        balanced)   echo "GLM 75-85% / Codex 15-25%" ;;
        quality)    echo "GLM 60-70% / Codex 30-40%" ;;
        codex-heavy) echo "GLM 40-60% / Codex 40-60%, for short bounded windows" ;;
    esac ;}
profile_gate()     { case "$1" in
        glm-only)   echo "Do not delegate to Codex automatically. Use GLM plus local tools and fresh-context GLM review." ;;
        savings)    echo "Delegate only after GLM misses a concrete acceptance criterion, or for high-risk read-only second opinions." ;;
        balanced)   echo "Use Codex earlier for cross-module design, ambiguous debugging, and pre-implementation review; return mechanical execution to GLM." ;;
        quality)    echo "Use Codex for architecture, API/taste-heavy work, high-risk reviews, and rescue before repeated GLM retries." ;;
        codex-heavy) echo "Use Codex for initial design, risky implementation, and independent review; keep GLM on exploration, evidence packing, and mechanical follow-through." ;;
    esac ;}
profile_retry()    { case "$1" in
        glm-only)   echo "If GLM fails twice, pause and ask whether to spend Codex budget." ;;
        savings)    echo "Give GLM one focused attempt before upgrading, unless the task is clearly architecture/high-risk from the start." ;;
        balanced)   echo "Give GLM a small pilot first, then upgrade if the pilot exposes design uncertainty or brittle coupling." ;;
        quality)    echo "Prefer one strong Codex pass over multiple GLM retries when acceptance risk is material." ;;
        codex-heavy) echo "Stop after the agreed burst budget or two Codex attempts, then downgrade or ask for a new budget." ;;
    esac ;}

PROFILE_BODY="$(mktemp)"
{
    echo ""
    echo "## Codex Router Active Routing Profile"
    echo ""
    echo "Active profile: **$PROFILE** ($(profile_label "$PROFILE"))"
    echo "Soft ratio target: **$(profile_ratio "$PROFILE")**"
    echo ""
    echo "Default Codex gate:"
    echo "$(profile_gate "$PROFILE")"
    echo ""
    echo "Retry / upgrade rule:"
    echo "$(profile_retry "$PROFILE")"
    echo ""
    echo "Standing policy:"
    echo "- Treat the ratio as an audit target, not a random scheduler. Never route easy work to Codex just to hit a percentage."
    echo "- User instructions in the current task override this profile."
    echo "- If Codex is unavailable, mark the run GLM-only and use a fresh-context GLM verifier for high-risk checks."
    echo "- Two execution backends coexist: the high-end backend (/codex:rescue, /codex:review, etc.) for resume/background/structured-review work, and the codex-engineer fallback (direct codex exec) for one-shot hard tasks. Default to the high-end backend when unsure."
} > "$PROFILE_BODY"

if splice_block "$BASELINE_FILE" "$PROFILE_BEGIN" "$PROFILE_END" "$PROFILE_BODY"; then
    echo "  ✓ Updated routing profile in $BASELINE_FILE"
else
    echo "  ✓ Appended routing profile to $BASELINE_FILE"
fi
rm -f "$PROFILE_BODY"

# --- 3. Verify Codex CLI ----------------------------------------------------------
if command -v codex >/dev/null 2>&1; then
    echo ""
    echo "  ✓ Codex CLI found: $(codex --version 2>&1 || echo 'version unknown')"
else
    echo ""
    echo "  ⚠ Codex CLI not found on PATH."
    echo "    Install it (https://github.com/openai/codex) and run 'codex login'"
    echo "    before the execution layer can delegate work."
fi

# --- 4. Plugin install reminder --------------------------------------------------
echo ""
echo "  ℹ This script installs the routing policy (AGENTS.md) only."
echo "    To enable the /codex:* commands and subagents, install the plugin:"
echo "      ZCode → Settings → Plugin Management → Discover → '+' →"
echo "      add this repo as a local directory → Install codex-router-zcode."
echo "    Then restart any open ZCode session."

echo ""
echo "Done. Restart any open ZCode session to pick up the new policy."
