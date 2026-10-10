$ErrorActionPreference = 'Stop'
$yukiRuntimePath = Join-Path $PSScriptRoot '.local\runtime.json'
if (-not (Test-Path -LiteralPath $yukiRuntimePath)) { Write-Host 'No remote atelier runtime was found.'; exit }
$yukiRuntime = Get-Content -LiteralPath $yukiRuntimePath -Raw | ConvertFrom-Json
foreach ($yukiProcessId in @($yukiRuntime.tunnelPid, $yukiRuntime.bridgePid, $yukiRuntime.supervisorPid)) {
    if (-not $yukiProcessId) { continue }
    $yukiProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$yukiProcessId) -ErrorAction SilentlyContinue
    if (-not $yukiProcess) { continue }
    $yukiIsOwned = $yukiProcess.CommandLine -like ('*' + $PSScriptRoot + '*')
    if ($yukiIsOwned) { Stop-Process -Id ([int]$yukiProcessId) -ErrorAction SilentlyContinue }
}
Write-Host 'Remote atelier stopped. ComfyUI remains running.'
