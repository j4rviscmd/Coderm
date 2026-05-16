/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cross-platform dev launcher invoked via `npm run dev`.
 *
 * Delegates to the platform-appropriate shell script (`dev.sh` on Unix,
 * `dev.ps1` on Windows), forwarding any extra CLI arguments. Terminates
 * the child process on SIGINT/SIGTERM/SIGHUP and mirrors its exit code.
 *
 * @module dev
 */
// @ts-check
'use strict';

const { spawn } = require('child_process');
const path = require('path');

/** Whether the current platform is Windows. */
const isWin = process.platform === 'win32';

/** Platform-specific shell script filename to delegate to. */
const script = isWin ? 'dev.ps1' : 'dev.sh';

/** Absolute path to the delegated shell script. */
const scriptPath = path.join(__dirname, script);

/** Shell interpreter command (`pwsh` on Windows, `bash` on Unix). */
const command = isWin ? 'pwsh' : 'bash';

/** Extra CLI arguments passed after `npm run dev`, forwarded to the shell script. */
const extraArgs = process.argv.slice(2);

/**
 * Build the argument array for the shell interpreter.
 *
 * On Windows, `-ExecutionPolicy Bypass` is required so the PowerShell script
 * can run without being blocked by the system execution policy. On Unix the
 * script path is passed directly as the sole argument.
 */
const args = isWin
	? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...extraArgs]
	: [scriptPath, ...extraArgs];

/**
 * Spawned child process running the platform-specific dev script.
 * `stdio: 'inherit'` pipes stdin/stdout/stderr directly so the child
 * appears as a foreground process to the user.
 */
const child = spawn(command, args, { stdio: 'inherit' });

/**
 * Forward common termination signals to the child process so that an
 * interactive Ctrl+C (SIGINT), a kill command (SIGTERM), or terminal
 * hang-up (SIGHUP) is handled gracefully by the delegated script.
 */
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
	process.on(sig, () => child.kill(/** @type {NodeJS.Signals} */(sig)));
}

/**
 * Mirror the child process exit code. Defaults to 1 if the child exits
 * without a code (e.g. killed by a signal) to signal a non-zero failure.
 */
child.on('exit', (code) => process.exit(code ?? 1));
