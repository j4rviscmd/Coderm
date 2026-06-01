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
#   2. Ensures Electron binary is available (auto-downloads on first run).
#   3. Starts `npm run watch` as a background process (esbuild transpile).
#   4. Waits for initial transpilation to complete, then launches Coderm.
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

	if [ -d "$prod_dir" ] && [ ! -d "$dev_dir" ]; then
		echo "[dev] Copying production user data to dev directory..."
		mkdir -p "$dev_dir/User"
		for item in settings.json keybindings.json snippets; do
			if [ -e "$prod_dir/User/$item" ]; then
				cp -R "$prod_dir/User/$item" "$dev_dir/User/$item"
			fi
		done
	fi

	if [ -d "$dev_dir" ]; then
		echo "[dev] Done. Dev user data ready at: $dev_dir"
	fi
}
copy_prod_userdata

# Ensure Electron binary is downloaded (auto-detect and download on first run)
ELECTRON_PATH="$ROOT/.build/electron/electron"
if [[ "$OSTYPE" == "darwin"* ]]; then
	ELECTRON_PATH="$ROOT/.build/electron/Electron.app/Contents/MacOS/Electron"
fi
if [[ ! -f "$ELECTRON_PATH" ]]; then
	echo "[dev] Electron not found. Downloading..."
	npm run electron
	if [[ $? -ne 0 ]]; then exit 1; fi
	echo "[dev] Electron download complete."
fi

##
# ensure_builtin_extensions - Build built-in extensions from j4rviscmd fork
# sources, falling back to VSIX download from GitHub Releases.
#
# For each extension listed in product.json with a "repo" field:
# 1. Try to clone (or pull) from the j4rviscmd fork on GitHub.
# 2. If fork exists, install dependencies, build, and install.
# 3. If fork doesn't exist, fall back to VSIX download from original repo.
#
# Skips rebuild when the source commit hasn't changed.
##
ensure_builtin_extensions() {
	local product_json="$ROOT/product.json"

	# Use node to parse product.json and output extension info
	# Format: name|version|repo (one per line, only extensions with repo field)
	local ext_info
	ext_info=$(node -e "
		const p = require('$product_json');
		(p.builtInExtensions || []).forEach(e => {
			if (e.repo) console.log(e.name + '|' + e.version + '|' + e.repo);
		});
	")

	if [ -z "$ext_info" ]; then
		return
	fi

	while IFS='|' read -r name version repo; do
		local ext_dir="$ROOT/.build/builtInExtensions/$name"
		local repo_url="${repo%/}"
		local repo_basename="${repo_url##*/}"
		local source_dir="$ROOT/.build/sources/$repo_basename"

		# Try j4rviscmd fork first
		local fork_repo="https://github.com/j4rviscmd/$repo_basename.git"
		local use_source=false

		if [ -d "$source_dir/.git" ]; then
			# Already cloned from fork — update and build
			local prev_hash
			prev_hash=$(git -C "$source_dir" rev-parse HEAD)

			echo "[dev] Updating $name from source..."
			git -C "$source_dir" pull --ff-only --quiet 2>/dev/null || true

			local new_hash
			new_hash=$(git -C "$source_dir" rev-parse HEAD)

			# No source changes and already built
			if [ "$prev_hash" = "$new_hash" ] && [ -f "$ext_dir/.source-hash" ]; then
				echo "[dev] Built-in extension $name up to date (source)."
				continue
			fi
			use_source=true
		elif git ls-remote --exit-code "$fork_repo" HEAD >/dev/null 2>&1; then
			# Fork exists on GitHub — clone it
			echo "[dev] Cloning $name from source ($fork_repo)..."
			mkdir -p "$ROOT/.build/sources"
			git clone --depth 1 "$fork_repo" "$source_dir"
			use_source=true
		fi

		if [ "$use_source" = true ]; then
			# Build from source
			local source_hash
			source_hash=$(git -C "$source_dir" rev-parse HEAD)
			echo "[dev] Building $name..."
			(cd "$source_dir" && npm install --quiet 2>/dev/null && npm run build)

			# Copy built files to extension directory
			rm -rf "$ext_dir"
			mkdir -p "$ext_dir"
			cp "$source_dir/package.json" "$ext_dir/"
			if [ -d "$source_dir/lib" ]; then
				mkdir -p "$ext_dir/lib"
				cp "$source_dir/lib/extension.js" "$ext_dir/lib/"
			fi
			echo "$source_hash" > "$ext_dir/.source-hash"
			echo "[dev] Installed $name from source ($source_hash)."
			continue
		fi

		# Fallback: download VSIX from original repo's GitHub Releases
		local pkg_json="$ext_dir/package.json"
		if [ -f "$pkg_json" ]; then
			local disk_version
			disk_version=$(node -p "require('$pkg_json').version" 2>/dev/null || echo "")
			if [ "$disk_version" = "$version" ]; then
				echo "[dev] Built-in extension $name@$version up to date."
				continue
			fi
		fi

		local vsix_url="$repo_url/releases/download/v$version/$repo_basename-$version.vsix"
		echo "[dev] Downloading built-in extension: $name@$version..."

		local temp_vsix="/tmp/$repo_basename-$version.vsix"
		if ! curl -sL "$vsix_url" -o "$temp_vsix"; then
			echo "[dev] WARNING: Failed to download $name" >&2
			continue
		fi

		local temp_extract="/tmp/$repo_basename-extract"
		rm -rf "$temp_extract"
		unzip -q -o "$temp_vsix" -d "$temp_extract" 'extension/*'

		rm -rf "$ext_dir"
		mkdir -p "$ext_dir"
		cp -r "$temp_extract/extension/"* "$ext_dir/"

		rm -f "$temp_vsix"
		rm -rf "$temp_extract"
		echo "[dev] Installed $name@$version."
	done <<< "$ext_info"
}
ensure_builtin_extensions

# Start watch in background with output to log file for initial transpile detection
WATCH_LOG="/tmp/coderm-watch.log"
rm -f "$WATCH_LOG"
echo "[dev] Starting watch in background..."
npm run watch > "$WATCH_LOG" 2>&1 &
WATCH_PID=$!

# Brief pause followed by a liveness check to detect immediate startup failures
sleep 1
if ! kill -0 "$WATCH_PID" 2>/dev/null; then
	echo "[dev] ERROR: watch process failed to start." >&2
	exit 1
fi

# Wait for initial esbuild transpile to complete
echo "[dev] Waiting for initial transpile..."
TIMEOUT=300  # 5 minutes max
START_TIME=$(date +%s)
READY=false
while [ "$READY" = false ]; do
	if [ -f "$WATCH_LOG" ]; then
		if grep -q "Finished transpilation with 0 errors" "$WATCH_LOG" 2>/dev/null; then
			READY=true
		elif grep -q "Finished transpilation with [1-9]" "$WATCH_LOG" 2>/dev/null; then
			echo "[dev] ERROR: Transpilation completed with errors." >&2
			cat "$WATCH_LOG" >&2
			WATCH_PID=""
			exit 1
		fi
	fi
	if [ "$READY" = false ]; then
		CURRENT_TIME=$(date +%s)
		ELAPSED=$((CURRENT_TIME - START_TIME))
		if [ $ELAPSED -gt $TIMEOUT ]; then
			echo "[dev] ERROR: Timeout waiting for initial transpile." >&2
			kill "$WATCH_PID" 2>/dev/null || true
			WATCH_PID=""
			exit 1
		fi
		sleep 0.5
	fi
done
echo "[dev] Transpilation complete."

# Launch app with VSCODE_SKIP_PRELAUNCH to skip redundant Electron download/compile checks
echo "[dev] Launching Coderm..."
echo ""
VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh "$@"
