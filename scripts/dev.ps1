# dev.ps1 - Coderm one-command development launcher (Windows PowerShell)
#
# Usage:
#   .\scripts\dev.ps1 [args...]
#
#   All arguments are forwarded to scripts/code.ps1 (the Electron launcher).
#
# Behaviour:
#   1. Resolves the project root from the script location.
#   2. Runs a full compilation (`npm run compile`) when out/ is missing.
#   3. Starts `npm run watch` as a background process for incremental builds.
#   4. Launches Coderm via scripts/code.ps1.
#   5. On exit (normal or error), cleans up the background watch process.

$ErrorActionPreference = 'Stop'

# Resolve the project root directory from the script location.
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

$watchProcess = $null

try {
	# Full build if out/ doesn't exist
	if (-not (Test-Path (Join-Path $Root 'out'))) {
		Write-Host '[dev] out/ not found, running initial compilation...' -ForegroundColor Cyan
		npm run compile
		if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
		Write-Host '[dev] Initial compilation complete.' -ForegroundColor Cyan
	}

	# Start watch in background
	Write-Host '[dev] Starting watch in background...' -ForegroundColor Cyan
	$watchProcess = Start-Process -FilePath 'npm' -ArgumentList 'run', 'watch' -PassThru -NoNewWindow
	Start-Sleep -Seconds 2
	# Verify the watch process is still running after a brief delay.
	if ($watchProcess.HasExited) {
		Write-Host '[dev] ERROR: watch process exited immediately.' -ForegroundColor Red
		exit 1
	}

	# Launch app (forwards all arguments to code.ps1)
	Write-Host '[dev] Launching Coderm...' -ForegroundColor Cyan
	Write-Host ''
	& (Join-Path $Root 'scripts/code.ps1') @args
}
finally {
	# Terminate the background watch process on exit or error.
	if ($watchProcess -and -not $watchProcess.HasExited) {
		Write-Host ''
		Write-Host "[dev] Stopping watch (PID: $($watchProcess.Id))..." -ForegroundColor Cyan
		Stop-Process -Id $watchProcess.Id -Force -ErrorAction SilentlyContinue
		Write-Host '[dev] Stopped.' -ForegroundColor Cyan
	}
}
