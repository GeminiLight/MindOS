!include "LogicLib.nsh"

; This hook runs only once the user commits to installing/removing the app.
; Opening the wizard or cancelling it must not mutate a running installation.
!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\mindos-installer-safety.ps1 "${PROJECT_DIR}\build\installer-safety.ps1"
  nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\mindos-installer-safety.ps1" -Action Probe -InstallDir "$INSTDIR"'
  Pop $R0
  Pop $R1
  ${if} $R0 == 10
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Abort
    ${endif}
    nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\mindos-installer-safety.ps1" -Action Stop -InstallDir "$INSTDIR"'
    Pop $R0
    Pop $R1
  ${endif}
  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONSTOP "MindOS could not safely close this installation. Close it and try again."
    Abort
  ${endif}

  !ifndef BUILD_UNINSTALLER
    ; An old NSIS uninstaller ignores --updated in its custom cleanup hook.
    ; Protect its generated batch entry point BEFORE uninstallOldVersion runs.
    nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\mindos-installer-safety.ps1" -Action Protect -ProfileDir "$PROFILE"'
    Pop $R0
    Pop $R1
    ${if} $R0 != 0
      MessageBox MB_OK|MB_ICONSTOP "MindOS could not protect your existing data. Installation has stopped."
      Abort
    ${endif}
  !endif
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Silent and interactive uninstall both preserve data by default.
    ; The generated script also requires --purge, protecting older installers.
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION "Also remove MindOS settings, sessions and downloaded runtimes? Your knowledge-base files will be kept." /SD IDNO IDNO mindos_keep_data
      IfFileExists "$PROFILE\.mindos\uninstall.bat" 0 mindos_keep_data
      ClearErrors
      ExecWait '"$SYSDIR\cmd.exe" /D /S /C ""$PROFILE\.mindos\uninstall.bat" --purge"' $R0
      ${if} ${Errors}
      ${orIf} $R0 != 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "Some MindOS data could not be removed. Your data has been kept where possible."
      ${endif}
    ${endif}
  ${endif}
  mindos_keep_data:
!macroend
