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

const isWin = process.platform === 'win32';
const script = isWin ? 'dev.ps1' : 'dev.sh';
const scriptPath = path.join(__dirname, script);

const command = isWin ? 'powershell' : 'bash';
const extraArgs = process.argv.slice(2);
const args = isWin
	? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...extraArgs]
	: [scriptPath, ...extraArgs];

const child = spawn(command, args, { stdio: 'inherit' });

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
	process.on(sig, () => child.kill(/** @type {NodeJS.Signals} */(sig)));
}

child.on('exit', (code) => process.exit(code ?? 1));
