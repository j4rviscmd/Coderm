<#
.SYNOPSIS
    Coderm one-command development launcher for Windows PowerShell.

.DESCRIPTION
    Prepares and launches Coderm in development mode. The script ensures the
    Electron binary is available, starts an incremental esbuild watch build in
    the background, waits for the initial transpilation to complete, then
    launches the Coderm Electron application. The background watch process is
    cleaned up automatically when the application exits or on error.

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

# Copy production user data to dev directory on first launch.
function Copy-ProdUserData {
    $prodDir = Join-Path $env:APPDATA 'Coderm'
    $devDir = Join-Path $env:APPDATA 'Coderm Dev'

    if ((Test-Path $prodDir) -and -not (Test-Path $devDir)) {
        Write-Host '[dev] Copying production user data to dev directory...' -ForegroundColor Cyan
        New-Item -ItemType Directory -Path (Join-Path $devDir 'User') -Force | Out-Null
        foreach ($item in @('settings.json', 'keybindings.json', 'snippets')) {
            $src = Join-Path "$prodDir\User" $item
            if (Test-Path $src) {
                Copy-Item -Path $src -Destination (Join-Path "$devDir\User" $item) -Recurse -Force
            }
        }
    }

    if (Test-Path $devDir) {
        Write-Host "[dev] Done. Dev user data ready at: $devDir" -ForegroundColor Cyan
    }
}
Copy-ProdUserData

##
# Ensure-BuiltInExtensions - Download built-in extensions from GitHub Releases
# that are not available on Microsoft Marketplace.
#
# Reads product.json builtInExtensions entries with a "repo" field and downloads
# them from GitHub Releases if not already present (or version mismatched).
##
function Ensure-BuiltInExtensions {
    $productJson = Get-Content (Join-Path $Root 'product.json') -Raw | ConvertFrom-Json
    $extensions = $productJson.builtInExtensions

    foreach ($ext in $extensions) {
        if (-not $ext.repo) { continue }

        $extDir = Join-Path $Root ".build\builtInExtensions\$($ext.name)"
        $packageJsonPath = Join-Path $extDir 'package.json'

        # Check if already up to date
        if (Test-Path $packageJsonPath) {
            $pkg = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
            if ($pkg.version -eq $ext.version) {
                Write-Host "[dev] Built-in extension $($ext.name)@$($ext.version) up to date." -ForegroundColor Green
                continue
            }
        }

        # Derive download URL from repo field
        # e.g. repo: "https://github.com/jeanp413/open-remote-ssh" -> basename: "open-remote-ssh"
        $repoUrl = $ext.repo.TrimEnd('/')
        $repoBasename = $repoUrl.Split('/')[-1]
        $vsixUrl = "$repoUrl/releases/download/v$($ext.version)/$repoBasename-$($ext.version).vsix"

        Write-Host "[dev] Downloading built-in extension: $($ext.name)@$($ext.version)..." -ForegroundColor Cyan

        # Download VSIX
        $tempVsix = Join-Path $env:TEMP "$repoBasename-$($ext.version).vsix"
        try {
            Invoke-WebRequest -Uri $vsixUrl -OutFile $tempVsix -UseBasicParsing
        } catch {
            Write-Host "[dev] WARNING: Failed to download $($ext.name): $_" -ForegroundColor Yellow
            continue
        }

        # Extract VSIX (it's a ZIP file with extension/ prefix)
        $tempExtractDir = Join-Path $env:TEMP "$repoBasename-extract"
        if (Test-Path $tempExtractDir) { Remove-Item $tempExtractDir -Recurse -Force }
        Expand-Archive -Path $tempVsix -DestinationPath $tempExtractDir -Force

        # Copy extension contents to target directory
        if (Test-Path $extDir) { Remove-Item $extDir -Recurse -Force }
        New-Item -ItemType Directory -Path $extDir -Force | Out-Null
        $extensionSrc = Join-Path $tempExtractDir 'extension'
        if (Test-Path $extensionSrc) {
            Get-ChildItem -Path $extensionSrc | Copy-Item -Destination $extDir -Recurse -Force
        }

        # Cleanup
        Remove-Item $tempVsix -Force -ErrorAction SilentlyContinue
        Remove-Item $tempExtractDir -Recurse -Force -ErrorAction SilentlyContinue

        Write-Host "[dev] Installed $($ext.name)@$($ext.version)." -ForegroundColor Green
    }
}

try {
    # Ensure Electron binary is downloaded (auto-detect and download on first run)
    $electronPath = Join-Path $Root '.build\electron\electron.exe'
    if (-not (Test-Path $electronPath)) {
        Write-Host '[dev] Electron not found. Downloading...' -ForegroundColor Cyan
        npm run electron
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host '[dev] Electron download complete.' -ForegroundColor Cyan
    }

    # Download built-in extensions not available on Microsoft Marketplace
    Ensure-BuiltInExtensions

    # Start watch in background with output to log file for initial transpile detection
    $watchLog = Join-Path $env:TEMP 'coderm-watch.log'
    if (Test-Path $watchLog) { Remove-Item $watchLog -Force -ErrorAction SilentlyContinue }
    # If removal failed (locked by another process), use a unique log name
    if (Test-Path $watchLog) { $watchLog = Join-Path $env:TEMP "coderm-watch-$(Get-Date -Format 'yyyyMMddHHmmss').log" }
    Write-Host '[dev] Starting watch in background...' -ForegroundColor Cyan
    $watchArgs = "/c npm run watch > `"$watchLog`" 2>&1"
    $watchProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList $watchArgs -PassThru -WindowStyle Hidden

    # Brief pause to detect immediate startup failures
    Start-Sleep -Seconds 1
    if ($watchProcess.HasExited) {
        Write-Host '[dev] ERROR: watch process failed to start.' -ForegroundColor Red
        exit 1
    }

    # Wait for initial esbuild transpile to complete
    Write-Host '[dev] Waiting for initial transpile...' -ForegroundColor Cyan
    $timeout = 300  # 5 minutes max
    $startTime = Get-Date
    $ready = $false
    while (-not $ready) {
        if (Test-Path $watchLog) {
            $content = Get-Content $watchLog -Raw -ErrorAction SilentlyContinue
            if ($content -match 'Finished transpilation with 0 errors') {
                $ready = $true
            } elseif ($content -match 'Finished transpilation with [1-9]\d* errors') {
                Write-Host '[dev] ERROR: Transpilation completed with errors.' -ForegroundColor Red
                Get-Content $watchLog -ErrorAction SilentlyContinue | Write-Host
                exit 1
            }
        }
        if (-not $ready) {
            if (((Get-Date) - $startTime).TotalSeconds -gt $timeout) {
                Write-Host '[dev] ERROR: Timeout waiting for initial transpile.' -ForegroundColor Red
                exit 1
            }
            Start-Sleep -Milliseconds 500
        }
    }
    Write-Host '[dev] Transpilation complete.' -ForegroundColor Cyan

    # Launch app with VSCODE_SKIP_PRELAUNCH to skip redundant Electron download/compile checks
    Write-Host '[dev] Launching Coderm...' -ForegroundColor Cyan
    Write-Host ''
    $oldSkipPrelaunch = $env:VSCODE_SKIP_PRELAUNCH
    $env:VSCODE_SKIP_PRELAUNCH = '1'
    try {
        & (Join-Path $Root 'scripts/code.ps1') @args
    } finally {
        $env:VSCODE_SKIP_PRELAUNCH = $oldSkipPrelaunch
    }
}
finally {
    # Terminate the background watch process tree on exit or error.
    if ($watchProcess -and -not $watchProcess.HasExited) {
        Write-Host ''
        Write-Host "[dev] Stopping watch (PID: $($watchProcess.Id))..." -ForegroundColor Cyan
        Stop-Process -Id $watchProcess.Id -Force -ErrorAction SilentlyContinue
        taskkill /PID $watchProcess.Id /T /F 2>$null
        Write-Host '[dev] Stopped.' -ForegroundColor Cyan
    }
}
