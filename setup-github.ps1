$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$yukiSetupUrl = 'https://github.com/settings/personal-access-tokens/new?name=Yuki+address+publisher&description=Publish+the+current+atelier+address&target_name=zyk262&contents=write&expires_in=90'
Write-Host 'One-time setup: GitHub needs permission to update your public connection address.'
Write-Host 'In GitHub: choose Only select repositories > comfyui-web.'
Write-Host 'Keep Contents: Read and write. No other write permissions are needed.'
Write-Host 'Choose Generate token. Paste it below. Input stays hidden; do not send it in chat.'
Start-Process -FilePath $yukiSetupUrl
$yukiSecureToken = Read-Host 'Paste the generated token and press Enter' -AsSecureString
if ($yukiSecureToken.Length -eq 0) { throw 'No token entered.' }
$yukiLocalDirectory = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Force -Path $yukiLocalDirectory | Out-Null
$yukiEncrypted = ConvertFrom-SecureString -SecureString $yukiSecureToken
Set-Content -LiteralPath (Join-Path $yukiLocalDirectory 'github-token.dpapi') -Value $yukiEncrypted -Encoding ASCII
$yukiSecureToken = $null
node (Join-Path $PSScriptRoot 'publisher.mjs')
if ($LASTEXITCODE -ne 0) { throw 'GitHub authorization check failed. Check the selected repository and token permissions.' }
