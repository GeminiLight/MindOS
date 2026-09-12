$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\installer-safety.ps1"
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
$root = Join-Path ([IO.Path]::GetTempPath()) ('MindOS 安装 test ' + [Guid]::NewGuid().ToString('N'))
try {
  $dir = Join-Path $root '.mindos'
  $null = New-Item -ItemType Directory -Path $dir -Force
  $script = Join-Path $dir 'uninstall.bat'
  $sentinel = Join-Path $dir 'config.json'
  [IO.File]::WriteAllText($sentinel, 'keep me')
  [IO.File]::WriteAllText($script, "@echo off`r`ndel /q `"%~dp0config.json`"`r`n")
  Protect-LegacyCleanup $root
  # Simulates the pre-0.4.17 uninstaller calling the cleanup without arguments.
  & $env:ComSpec /d /c "`"$script`""
  Assert (Test-Path -LiteralPath $sentinel) 'Legacy upgrade removed user data'
  $protected = [IO.File]::ReadAllText($script)
  Protect-LegacyCleanup $root
  Assert ([IO.File]::ReadAllText($script) -eq $protected) 'Migration is not idempotent'
  Assert (@(Get-ChildItem -LiteralPath $dir -Filter '*.backup-*').Count -eq 1) 'Original cleanup was not backed up exactly once'
  & $env:ComSpec /d /c "`"$script`" --purge"
  Assert (-not (Test-Path -LiteralPath $sentinel)) 'Explicit cleanup did not run'
  Protect-LegacyCleanup (Join-Path $root 'missing')
  # A locked existing script must fail closed.
  [IO.File]::WriteAllText($script, '@echo off')
  $lock = [IO.File]::Open($script, 'Open', 'ReadWrite', 'None')
  try {
    $failed = $false
    try { Protect-LegacyCleanup $root } catch { $failed = $true }
    Assert $failed 'Locked legacy cleanup did not stop migration'
  } finally { $lock.Dispose() }
  $processes = @(
    [pscustomobject]@{Name='MindOS.exe';ExecutablePath='C:\Apps\MindOS\MindOS.exe'},
    [pscustomobject]@{Name='node.exe';ExecutablePath='C:\Apps\MindOS\resources\mindos-runtime\node\node.exe'},
    [pscustomobject]@{Name='node.exe';ExecutablePath='C:\nodejs\node.exe';CommandLine='C:\other\packages\web\.next\standalone\server.js'},
    [pscustomobject]@{Name='MindOS.exe';ExecutablePath='C:\Apps\MindOS-other\MindOS.exe'},
    [pscustomobject]@{Name='node.exe';ExecutablePath=$null}
  )
  Assert (@(Get-MindOSOwnedProcesses $processes 'C:\Apps\MindOS').Count -eq 2) 'Process ownership escaped installation directory'
  Write-Host 'Installer safety: legacy upgrade, explicit cleanup, missing script and process ownership passed.'
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
