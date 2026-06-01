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
# Ensure-BuiltInExtensions - Build built-in extensions from j4rviscmd fork
# sources, falling back to VSIX download from GitHub Releases.
#
# For each extension listed in product.json with a "repo" field:
# 1. Try to clone (or pull) from the j4rviscmd fork on GitHub.
# 2. If fork exists, install dependencies, build, and install.
# 3. If fork doesn't exist, fall back to VSIX download from original repo.
#
# Skips rebuild when the source commit hasn't changed.
##
function Ensure-BuiltInExtensions {
    $productJson = Get-Content (Join-Path $Root 'product.json') -Raw | ConvertFrom-Json
    $extensions = $productJson.builtInExtensions

    foreach ($ext in $extensions) {
        if (-not $ext.repo) { continue }

        $extDir = Join-Path $Root ".build\builtInExtensions\$($ext.name)"
        $repoUrl = $ext.repo.TrimEnd('/')
        $repoBasename = $repoUrl.Split('/')[-1]
        $sourceDir = Join-Path $Root ".build\sources\$repoBasename"
        $forkRepo = "https://github.com/j4rviscmd/$repoBasename.git"

        $useSource = $false

        # Try j4rviscmd fork first
        if (Test-Path (Join-Path $sourceDir '.git')) {
            # Already cloned from fork — update and build
            $prevHash = (git -C $sourceDir rev-parse HEAD 2>$null).Trim()

            Write-Host "[dev] Updating $($ext.name) from source..." -ForegroundColor Cyan
            git -C $sourceDir pull --ff-only --quiet 2>$null

            $newHash = (git -C $sourceDir rev-parse HEAD 2>$null).Trim()

            # No source changes and already built
            $hashFile = Join-Path $extDir '.source-hash'
            if ($prevHash -eq $newHash -and (Test-Path $hashFile)) {
                Write-Host "[dev] Built-in extension $($ext.name) up to date (source)." -ForegroundColor Green
                continue
            }
            $useSource = $true
        } else {
            # Check if fork exists on GitHub
            $remoteResult = git ls-remote --exit-code $forkRepo HEAD 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[dev] Cloning $($ext.name) from source ($forkRepo)..." -ForegroundColor Cyan
                $sourcesDir = Join-Path $Root '.build\sources'
                if (-not (Test-Path $sourcesDir)) { New-Item -ItemType Directory -Path $sourcesDir -Force | Out-Null }
                git clone --depth 1 $forkRepo $sourceDir
                $useSource = $true
            }
        }

        if ($useSource) {
            # Build from source
            $sourceHash = (git -C $sourceDir rev-parse HEAD 2>$null).Trim()
            Write-Host "[dev] Building $($ext.name)..." -ForegroundColor Cyan
            Push-Location $sourceDir
            try {
                npm install --quiet 2>$null
                npm run build
            } finally {
                Pop-Location
            }

            # Copy built files to extension directory
            if (Test-Path $extDir) { Remove-Item $extDir -Recurse -Force }
            New-Item -ItemType Directory -Path $extDir -Force | Out-Null
            Copy-Item (Join-Path $sourceDir 'package.json') $extDir -Force
            $libDir = Join-Path $sourceDir 'lib'
            if (Test-Path $libDir) {
                $destLib = Join-Path $extDir 'lib'
                New-Item -ItemType Directory -Path $destLib -Force | Out-Null
                Copy-Item (Join-Path $libDir 'extension.js') $destLib -Force
            }
            Set-Content -Path (Join-Path $extDir '.source-hash') -Value $sourceHash

            Write-Host "[dev] Installed $($ext.name) from source ($sourceHash)." -ForegroundColor Green
            continue
        }

        # Fallback: download VSIX from original repo's GitHub Releases
        $packageJsonPath = Join-Path $extDir 'package.json'
        if (Test-Path $packageJsonPath) {
            $pkg = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
            if ($pkg.version -eq $ext.version) {
                Write-Host "[dev] Built-in extension $($ext.name)@$($ext.version) up to date." -ForegroundColor Green
                continue
            }
        }

        $vsixUrl = "$repoUrl/releases/download/v$($ext.version)/$repoBasename-$($ext.version).vsix"
        Write-Host "[dev] Downloading built-in extension: $($ext.name)@$($ext.version)..." -ForegroundColor Cyan

        $tempVsix = Join-Path $env:TEMP "$repoBasename-$($ext.version).vsix"
        try {
            Invoke-WebRequest -Uri $vsixUrl -OutFile $tempVsix -UseBasicParsing
        } catch {
            Write-Host "[dev] WARNING: Failed to download $($ext.name): $_" -ForegroundColor Yellow
            continue
        }

        $tempExtractDir = Join-Path $env:TEMP "$repoBasename-extract"
        if (Test-Path $tempExtractDir) { Remove-Item $tempExtractDir -Recurse -Force }
        Expand-Archive -Path $tempVsix -DestinationPath $tempExtractDir -Force

        if (Test-Path $extDir) { Remove-Item $extDir -Recurse -Force }
        New-Item -ItemType Directory -Path $extDir -Force | Out-Null
        $extensionSrc = Join-Path $tempExtractDir 'extension'
        if (Test-Path $extensionSrc) {
            Get-ChildItem -Path $extensionSrc | Copy-Item -Destination $extDir -Recurse -Force
        }

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
