$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Please install Node.js 22 or newer, then run this file again.'
    Read-Host 'Press Enter to close'
    exit 1
}
node (Join-Path $PSScriptRoot 'launcher.mjs')
Read-Host 'Press Enter to close'
