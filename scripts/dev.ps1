<#
.SYNOPSIS
    Coderm one-command development launcher for Windows PowerShell.

.DESCRIPTION
    Prepares and launches Coderm in development mode. The script performs a
    full compilation, starts an incremental watch build in the background,
    then launches the Coderm Electron application. The background watch
    process is cleaned up automatically when the application exits or on error.

    All arguments passed to this script are forwarded to scripts/code.ps1
    (the Electron launcher).

.EXAMPLE
    .\scripts\dev.ps1
    Starts Coderm with default settings.

.EXAMPLE
    .\scripts\dev.ps1 --remote-debugging-port=9222
    Starts Coderm with CDP debugging enabled on port 9222.

.NOTES
    Requires Node.js and npm on PATH. The project root is resolved
    automatically from the script's location.
#>

$ErrorActionPreference = 'Stop'

# Resolve the project root directory from the script location.
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

$watchProcess = $null

try {
	# Full compile to ensure out/ is fully populated before launch.
	Write-Host '[dev] Running compilation...' -ForegroundColor Cyan
	npm run compile
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
	Write-Host '[dev] Compilation complete.' -ForegroundColor Cyan

	# Start watch in background for incremental builds during development.
	Write-Host '[dev] Starting watch in background...' -ForegroundColor Cyan
	$watchProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm', 'run', 'watch' -PassThru -NoNewWindow

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
