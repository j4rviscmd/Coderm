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

##
# copy_prod_userdata - Copy production user data to dev directory on first launch.
##
copy_prod_userdata() {
	local prod_dir=""
	local dev_dir=""

	case "$(uname -s)" in
		Darwin)
			prod_dir="$HOME/Library/Application Support/Coderm"
			dev_dir="$HOME/Library/Application Support/Coderm Dev"
			;;
		Linux)
			local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
			prod_dir="$config_dir/Coderm"
			dev_dir="$config_dir/Coderm Dev"
			;;
		*)
			return
			;;
	esac

	# Data dirs use the same pattern on all supported platforms
	# (the platform check above returns early for anything else).
	local prod_data_dir="$HOME/.coderm"
	local dev_data_dir="$HOME/.coderm-dev"

	if [ -d "$prod_dir" ] && [ ! -d "$dev_dir" ]; then
		echo "[dev] Copying production user data to dev directory..."
		mkdir -p "$dev_dir/User"
		for item in settings.json keybindings.json snippets; do
			if [ -e "$prod_dir/User/$item" ]; then
				cp -R "$prod_dir/User/$item" "$dev_dir/User/$item"
			fi
		done
	fi

	if [ -n "$prod_data_dir" ] && [ -d "$prod_data_dir/extensions" ] && [ ! -d "$dev_data_dir/extensions" ]; then
		echo "[dev] Copying production extensions to dev directory..."
		mkdir -p "$dev_data_dir/extensions"
		cp -R "$prod_data_dir/extensions/"* "$dev_data_dir/extensions/" 2>/dev/null || true
	fi

	if [ -d "$dev_dir" ]; then
		echo "[dev] Done. Dev user data ready at: $dev_dir"
	fi
}
copy_prod_userdata

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
