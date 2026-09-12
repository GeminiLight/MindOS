param(
  [ValidateSet('Probe', 'Stop', 'Protect')][string]$Action,
  [string]$InstallDir,
  [string]$ProfileDir = $env:USERPROFILE
)
$ErrorActionPreference = 'Stop'

function Get-MindOSOwnedProcesses($Processes, [string]$Root) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $appPath = $rootPath + '\MindOS.exe'
  $nodeRoot = $rootPath + '\resources\mindos-runtime\node\'
  # ExecutablePath comes from the OS. CommandLine substring matching can kill
  # unrelated CLI instances or another project's Next.js server.
  @($Processes | Where-Object {
    $_.ExecutablePath -and (
      [string]::Equals($_.ExecutablePath, $appPath, [StringComparison]::OrdinalIgnoreCase) -or
      ($_.Name -ieq 'node.exe' -and $_.ExecutablePath.StartsWith($nodeRoot, [StringComparison]::OrdinalIgnoreCase))
    )
  })
}

function Protect-LegacyCleanup([string]$ProfileRoot) {
  $script = Join-Path $ProfileRoot '.mindos\uninstall.bat'
  if (-not (Test-Path -LiteralPath $script)) { return }
  $guard = 'rem MindOS upgrade-safe cleanup v2'
  $body = [IO.File]::ReadAllBytes($script)
  $text = [Text.Encoding]::UTF8.GetString($body)
  $preamble = "@echo off`r`n$guard`r`nif /I not `"%~1`"==`"--purge`" exit /b 0`r`n"
  if ($text.StartsWith($preamble, [StringComparison]::Ordinal)) { return }
  # Keep the original bytes, including non-UTF8 custom scripts, in a unique
  # persistent backup. Never leave the destructive legacy entry point active
  # while the old uninstaller is called (or after an interrupted installation).
  $backup = $script + '.backup-' + [Guid]::NewGuid().ToString('N')
  $prefix = [Text.Encoding]::ASCII.GetBytes($preamble)
  $temp = $script + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  try {
    [IO.File]::WriteAllBytes($temp, ($prefix + $body))
    [IO.File]::Replace($temp, $script, $backup)
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    if ($Action -eq 'Protect') {
      Protect-LegacyCleanup $ProfileDir
      exit 0
    }
    if (-not $InstallDir) { throw 'Installation directory is required.' }
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'MindOS.exe' OR Name = 'node.exe'"
    $owned = @(Get-MindOSOwnedProcesses $processes $InstallDir)
    if ($Action -eq 'Probe') { if ($owned.Count) { exit 10 }; exit 0 }
    foreach ($entry in $owned) {
      $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
      if (-not $process) { continue }
      if ($entry.Name -ieq 'MindOS.exe') {
        $null = $process.CloseMainWindow()
        $null = $process.WaitForExit(3000)
      }
      if (-not $process.HasExited) {
        # Recheck ownership immediately before terminating: the original PID may
        # have exited and been reused while we waited for a window to close.
        $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.ProcessId)"
        if (@(Get-MindOSOwnedProcesses @($current) $InstallDir).Count) {
          & taskkill.exe /PID $entry.ProcessId /T /F | Out-Null
          if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue)) {
            throw 'Could not close the running MindOS installation.'
          }
        }
      }
    }
  } catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
  }
}
