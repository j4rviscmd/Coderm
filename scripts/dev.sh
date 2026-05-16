#!/usr/bin/env bash
# dev.sh - Coderm one-command development launcher (macOS / Linux)
#
# Usage:
#   ./scripts/dev.sh [args...]
#
#   All arguments are forwarded to scripts/code.sh (the Electron launcher).
#
# Behaviour:
#   1. Resolves the project root from the script location.
#   2. Runs a full compilation (`npm run compile`) synchronously.
#   3. Starts `npm run watch` as a background process for incremental builds.
#   4. Launches Coderm via scripts/code.sh.
#   5. On exit (normal or signal), cleans up the background watch process.

set -euo pipefail

# Resolve the project root directory from the script location.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# PID of the background `npm run watch` process; empty until the process is started.
WATCH_PID=""

##
# cleanup - Terminate the background watch process and its children.
#
# Registered as a trap on EXIT, INT, TERM, and HUP so the watch process
# is always cleaned up whether the script exits normally, is interrupted
# by Ctrl+C, or is killed by a signal.
#
# Uses process-group kill (`kill -- -PID`) first to catch child processes
# spawned by npm, then falls back to a direct kill on the PID itself.
##
cleanup() {
	if [ -n "$WATCH_PID" ]; then
		echo ""
		echo "[dev] Stopping watch (PID: $WATCH_PID)..."
		# Send SIGTERM to the process group first, then to the process itself.
		kill -- -"$WATCH_PID" 2>/dev/null || kill "$WATCH_PID" 2>/dev/null || true
		wait "$WATCH_PID" 2>/dev/null || true
		echo "[dev] Stopped."
	fi
}
trap cleanup EXIT INT TERM HUP

# Full compile to ensure out/ is fully populated before launch.
echo "[dev] Running compilation..."
npm run compile
echo "[dev] Compilation complete."

# Start watch in background for incremental builds during development.
echo "[dev] Starting watch in background..."
npm run watch &
WATCH_PID=$!

# Brief pause followed by a liveness check to detect immediate startup failures
# (e.g. syntax error in build scripts) before launching the application.
sleep 1
if ! kill -0 "$WATCH_PID" 2>/dev/null; then
	echo "[dev] ERROR: watch process failed to start." >&2
	exit 1
fi

# Launch app (forwards all arguments to code.sh)
echo "[dev] Launching Coderm..."
echo ""
./scripts/code.sh "$@"
