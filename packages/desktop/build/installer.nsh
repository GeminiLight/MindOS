!include "getProcessInfo.nsh"

Var pid
Var mindosRuntimeCleanupDone

!macro mindosStopRuntimeChildren
  !define MINDOS_RUNTIME_CLEANUP_ID ${__LINE__}
  StrCmp $mindosRuntimeCleanupDone "1" mindos_runtime_cleanup_skip_${MINDOS_RUNTIME_CLEANUP_ID}
  StrCpy $mindosRuntimeCleanupDone "1"
  InitPluginsDir

  Push $0
  Push $1

  StrCpy $0 "$PLUGINSDIR\mindos-runtime-cleanup.ps1"
  FileOpen $1 "$0" w
  IfErrors mindos_runtime_cleanup_restore_${MINDOS_RUNTIME_CLEANUP_ID}
  FileWrite $1 '$$ErrorActionPreference = "SilentlyContinue"$\r$\n'
  FileWrite $1 '$$patterns = @($\r$\n'
  FileWrite $1 '  "\.mindos\runtime\",$\r$\n'
  FileWrite $1 '  "mindos-runtime",$\r$\n'
  FileWrite $1 '  "@geminilight\mindos",$\r$\n'
  FileWrite $1 '  "\packages\web\.next\standalone\server.js",$\r$\n'
  FileWrite $1 '  "\dist\protocols\mcp-server\index.cjs"$\r$\n'
  FileWrite $1 ')$\r$\n'
  FileWrite $1 'function Test-MindOSCommandLine([string]$$CommandLine) {$\r$\n'
  FileWrite $1 '  if ([string]::IsNullOrWhiteSpace($$CommandLine)) { return $$false }$\r$\n'
  FileWrite $1 '  foreach ($$pattern in $$patterns) {$\r$\n'
  FileWrite $1 '    if ($$CommandLine.IndexOf($$pattern, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $$true }$\r$\n'
  FileWrite $1 '  }$\r$\n'
  FileWrite $1 '  return $$false$\r$\n'
  FileWrite $1 '}$\r$\n'
  FileWrite $1 `try { $$processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop } catch { $$processes = Get-WmiObject Win32_Process -Filter "Name = 'node.exe'" }$\r$\n`
  FileWrite $1 'foreach ($$proc in @($$processes)) {$\r$\n'
  FileWrite $1 '  if ($$null -eq $$proc -or $$proc.ProcessId -eq $$PID) { continue }$\r$\n'
  FileWrite $1 '  $$name = [string]$$proc.Name$\r$\n'
  FileWrite $1 '  $$cmd = [string]$$proc.CommandLine$\r$\n'
  FileWrite $1 '  $$isNode = $$name.Equals("node.exe", [StringComparison]::OrdinalIgnoreCase)$\r$\n'
  FileWrite $1 '  if ($$isNode -and (Test-MindOSCommandLine $$cmd)) {$\r$\n'
  FileWrite $1 '    & taskkill.exe /PID $$proc.ProcessId /T /F *> $$null$\r$\n'
  FileWrite $1 '  }$\r$\n'
  FileWrite $1 '}$\r$\n'
  FileWrite $1 'Start-Sleep -Milliseconds 200$\r$\n'
  FileClose $1

  DetailPrint "Stopping MindOS runtime child processes..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$0"'

  mindos_runtime_cleanup_restore_${MINDOS_RUNTIME_CLEANUP_ID}:
  Pop $1
  Pop $0
  mindos_runtime_cleanup_skip_${MINDOS_RUNTIME_CLEANUP_ID}:
  !undef MINDOS_RUNTIME_CLEANUP_ID
!macroend

!macro mindosStopAppTree
  DetailPrint `Stopping running "${PRODUCT_NAME}"...`
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "${APP_EXECUTABLE_FILENAME}" /T /F'
  Sleep 500
  !insertmacro mindosStopRuntimeChildren
!macroend

!macro customInit
  !insertmacro mindosStopRuntimeChildren
!macroend

!macro customCheckAppRunning
  !define MINDOS_CHECK_RUNNING_ID ${__LINE__}
  ; Overriding this macro skips electron-builder's default block that declares
  ; and probes $IsPowerShellAvailable; FIND_PROCESS / _CHECK_APP_RUNNING read it,
  ; and electron-builder 26 compiles with -WX so the missing variable is fatal.
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro mindosStopRuntimeChildren
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK mindos_stop_app_tree_${MINDOS_CHECK_RUNNING_ID}
      Quit
    ${endif}
    mindos_stop_app_tree_${MINDOS_CHECK_RUNNING_ID}:
      !insertmacro mindosStopAppTree
  ${endif}
  !insertmacro _CHECK_APP_RUNNING
  !undef MINDOS_CHECK_RUNNING_ID
!macroend

!macro customUnInstall
  IfFileExists "$PROFILE\.mindos\uninstall.bat" 0 done
    DetailPrint "Running MindOS cleanup script..."
    ExecWait '"$PROFILE\.mindos\uninstall.bat"'
  done:
!macroend
