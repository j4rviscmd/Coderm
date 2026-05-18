$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')

if ($env:VSCODE_SKIP_PRELAUNCH -eq '') {
	node (Join-Path $Root 'build/lib/preLaunch.ts')
}

$product = Get-Content (Join-Path $Root 'product.json') -Raw | ConvertFrom-Json
$NameShort = "$($product.nameShort).exe"
$Code = Join-Path $Root ".build/electron/$NameShort"

if ($args[0] -eq '--builtin') {
	& $Code (Join-Path $Root 'build/builtin')
	exit $LASTEXITCODE
}

$env:NODE_ENV = 'development'
$env:VSCODE_DEV = '1'
$env:VSCODE_CLI = '1'
$env:ELECTRON_ENABLE_STACK_DUMPING = '1'
$env:ELECTRON_ENABLE_LOGGING = '1'

$disableTestExtension = @('--disable-extension=vscode.vscode-api-tests')
if ($args -contains '--extensionTestsPath') {
	$disableTestExtension = @()
}

& $Code $Root --remote-debugging-port=9222 @disableTestExtension @args
