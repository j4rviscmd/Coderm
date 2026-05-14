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
#   2. Runs a full compilation (`npm run compile`) when out/ is missing.
#   3. Starts `npm run watch` as a background process for incremental builds.
#   4. Launches Coderm via scripts/code.sh.
#   5. On exit (normal or signal), cleans up the background watch process.

set -euo pipefail

# Resolve the project root directory.
# macOS lacks GNU realpath, so a POSIX-compatible fallback is used.
if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname "$(dirname "$(realpath "$0")")")
else
	ROOT=$(dirname "$(dirname "$(readlink -f "$0")")")
fi
cd "$ROOT"

WATCH_PID=""

# Terminate the background watch process and its children on exit or signal.
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

# Full build if out/ doesn't exist
if [ ! -d "out" ]; then
	echo "[dev] out/ not found, running initial compilation..."
	npm run compile
	echo "[dev] Initial compilation complete."
fi

# Start watch in background
echo "[dev] Starting watch in background..."
npm run watch &
WATCH_PID=$!
sleep 1
if ! kill -0 "$WATCH_PID" 2>/dev/null; then
	echo "[dev] ERROR: watch process failed to start." >&2
	exit 1
fi

# Launch app (forwards all arguments to code.sh)
echo "[dev] Launching Coderm..."
echo ""
./scripts/code.sh "$@"
