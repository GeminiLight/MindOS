$ErrorActionPreference = 'Stop'
$compiler = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'NSIS compiler is required for the installer syntax check' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('mindos-nsis-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temp
try {
  foreach ($mode in @('installer','uninstaller')) {
    $header = if ($mode -eq 'uninstaller') { '!define BUILD_UNINSTALLER' } else { '' }
    $macro = if ($mode -eq 'uninstaller') { '!insertmacro customUnInstall' } else { '!insertmacro customCheckAppRunning' }
    $source = @'
Unicode true
Name "MindOS installer contract"
OutFile "fixture.exe"
RequestExecutionLevel user
!include "LogicLib.nsh"
Var updated
!define isUpdated '"$updated" == "true"'
LangString appRunning 1033 "Close MindOS before continuing."
!include "@INCLUDE@"
Section
  StrCpy $updated "false"
  DetailPrint "$(appRunning)"
  @MACRO@
SectionEnd
'@
    $source = $header + "`r`n" + $source.Replace('@INCLUDE@', "$PSScriptRoot\installer.nsh").Replace('@MACRO@', $macro)
    $file = Join-Path $temp "$mode.nsi"
    [IO.File]::WriteAllText($file,$source)
    & $compiler /WX "/DPROJECT_DIR=$(Split-Path $PSScriptRoot -Parent)" $file
    if ($LASTEXITCODE -ne 0) { throw "NSIS $mode compilation failed" }
  }
} finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
