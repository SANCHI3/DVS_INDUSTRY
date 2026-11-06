; One-file installer. Built by installer/build_windows.ps1 on GitHub Actions.
; Asks Windows once for "Yes": a running monitoring can belong to SYSTEM, and only
; an administrator can stop it to replace its files.
;
; Over an installed copy there is no setup window, and the cameras keep running
; until the new copy has proved it can load on this Windows:
;   1. unpack to upgrade-new and check it (a failure here changes nothing)
;   2. keep the previous programs in upgrade-old
;   3. stop the monitoring, swap the folders, start it again
;   4. wait for the website to accept a heartbeat from the new version
; If 3 or 4 fails, the previous version goes back and restarts. .env, cameras.yaml,
; logs, Tailscale and the scheduled task are never touched.
Unicode true
Name "DVS CCTV"
OutFile "..\..\dvs-cctv-setup.exe"
InstallDir "C:\dvs-cctv"
RequestExecutionLevel admin
SetCompressor /SOLID /FINAL lzma
SetCompressorDictSize 64
ShowInstDetails nevershow
AutoCloseWindow true
BrandingText "DVS Industries"

!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define NEW "$INSTDIR\upgrade-new"
!define OLD "$INSTDIR\upgrade-old"
!define LOGFILE "$INSTDIR\logs\install.log"
!define TASK "DVS CCTV Monitoring"
!define NEED_MB 3000
!define ROBO_QUIET "/R:2 /W:1 /NFL /NDL /NJH /NJS /NP"
; Settings and anything the monitoring made stay out of the copies
!define ROBO_KEEP_FILES "/XF .env .env.* *.before-* cameras.yaml"
!define ROBO_KEEP_FOLDERS '/XD "$INSTDIR\app\logs" "$INSTDIR\app\output" "$INSTDIR\app\data" "$INSTDIR\app\recordings" "$INSTDIR\app\calibration" __pycache__'
!define DETAILS "$\n$\nDetails: ${LOGFILE}"

Var Upgrade      ; 1: settings exist, so this is an upgrade with no setup window
Var NewFfmpeg    ; 1: this run put a new ffmpeg folder in place
Var MoveFrom
Var MoveTo

!macro Log TEXT
  Push "${TEXT}"
  Call WriteLog
!macroend

Function WriteLog
  Exch $R9
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  ${GetTime} "" "L" $R1 $R2 $R3 $R4 $R5 $R6 $R7
  CreateDirectory "$INSTDIR\logs"
  FileOpen $R0 "${LOGFILE}" a
  FileSeek $R0 0 END
  FileWrite $R0 "$R3-$R2-$R1 $R5:$R6:$R7 $R9$\r$\n"
  FileClose $R0
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  Pop $R9
FunctionEnd

; This installer is 32-bit, so its PowerShell cannot see a 64-bit process's .Path.
; ExecutablePath from Windows itself works from either.
Function StopMonitoring
  nsExec::Exec 'schtasks /end /tn "${TASK}"'
  Pop $0
  nsExec::Exec `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Sleep 3000
FunctionEnd

Function StartMonitoring
  nsExec::Exec 'schtasks /run /tn "${TASK}"'
  Pop $0
  ${If} $0 != 0
    !insertmacro Log "the scheduled task did not start; starting the monitoring directly"
    Exec '"$INSTDIR\python\pythonw.exe" "$INSTDIR\app\service.py" run'
  ${EndIf}
FunctionEnd

; A folder rename is all or nothing. A file still closing gets 20 seconds.
; Sets $0 to 1 on success, 0 if the folder would not move.
Function MoveFolder
  StrCpy $0 1
  ${IfNot} ${FileExists} "$MoveFrom\*.*"
    Return
  ${EndIf}
  StrCpy $1 0
  ${Do}
    ClearErrors
    Rename "$MoveFrom" "$MoveTo"
    ${IfNot} ${Errors}
      Return
    ${EndIf}
    IntOp $1 $1 + 1
    Sleep 1000
  ${LoopUntil} $1 >= 20
  StrCpy $0 0
FunctionEnd

!macro Move FROM TO
  StrCpy $MoveFrom "${FROM}"
  StrCpy $MoveTo "${TO}"
  Call MoveFolder
!macroend

; Sets $0 to 1 if every folder moved and the app files copied.
Function SwapIn
  !insertmacro Move "$INSTDIR\python" "${OLD}\python"
  ${If} $0 != 1
    Return
  ${EndIf}
  !insertmacro Move "$INSTDIR\ffmpeg" "${OLD}\ffmpeg"
  ${If} $0 != 1
    Return
  ${EndIf}
  !insertmacro Move "$INSTDIR\mediamtx" "${OLD}\mediamtx"
  ${If} $0 != 1
    Return
  ${EndIf}
  !insertmacro Move "${NEW}\python" "$INSTDIR\python"
  ${If} $0 != 1
    Return
  ${EndIf}
  !insertmacro Move "${NEW}\ffmpeg" "$INSTDIR\ffmpeg"
  ${If} $0 != 1
    Return
  ${EndIf}
  StrCpy $NewFfmpeg 1
  !insertmacro Move "${NEW}\mediamtx" "$INSTDIR\mediamtx"
  ${If} $0 != 1
    Return
  ${EndIf}
  nsExec::Exec 'robocopy "${NEW}\app" "$INSTDIR\app" /E ${ROBO_QUIET}'
  Pop $1
  StrCpy $0 1
  ${If} $1 == "error"
  ${OrIf} $1 >= 8
    StrCpy $0 0
  ${EndIf}
FunctionEnd

; Sets $0 to 1 if the previous version is complete again.
Function PutBack
  !insertmacro Log "putting the previous version back"
  CreateDirectory "${NEW}"
  ${If} ${FileExists} "${OLD}\python\python.exe"
    !insertmacro Move "$INSTDIR\python" "${NEW}\failed-python"
    !insertmacro Move "${OLD}\python" "$INSTDIR\python"
  ${EndIf}
  ${If} ${FileExists} "${OLD}\mediamtx\*.*"
    !insertmacro Move "$INSTDIR\mediamtx" "${NEW}\failed-mediamtx"
    !insertmacro Move "${OLD}\mediamtx" "$INSTDIR\mediamtx"
  ${EndIf}
  ${If} ${FileExists} "${OLD}\ffmpeg\*.*"
  ${OrIf} $NewFfmpeg == 1
    !insertmacro Move "$INSTDIR\ffmpeg" "${NEW}\failed-ffmpeg"
    !insertmacro Move "${OLD}\ffmpeg" "$INSTDIR\ffmpeg"
  ${EndIf}
  ${If} ${FileExists} "${OLD}\app\service.py"
    Delete "$INSTDIR\app\VERSION"
    Delete "$INSTDIR\app\RUNTIME"
    nsExec::Exec 'robocopy "${OLD}\app" "$INSTDIR\app" /E ${ROBO_QUIET}'
    Pop $1
  ${Else}
    StrCpy $1 0
  ${EndIf}
  StrCpy $0 1
  ${If} $1 == "error"
  ${OrIf} $1 >= 8
  ${OrIfNot} ${FileExists} "$INSTDIR\python\python.exe"
  ${OrIfNot} ${FileExists} "$INSTDIR\app\service.py"
    StrCpy $0 0
  ${EndIf}
FunctionEnd

Section
  ; A library that cannot load must fail quietly, not open a box nobody can click
  System::Call 'kernel32::SetErrorMode(i 0x8003) i .r0'
  SetDetailsPrint textonly
  CreateDirectory "$INSTDIR"
  StrCpy $Upgrade 0
  StrCpy $NewFfmpeg 0
  ${If} ${FileExists} "$INSTDIR\app\.env"
    StrCpy $Upgrade 1
  ${EndIf}
  !insertmacro Log "installer started (upgrade=$Upgrade)"

  ; The power went off during an earlier swap
  ${If} ${FileExists} "${OLD}\python\python.exe"
  ${AndIfNot} ${FileExists} "$INSTDIR\python\python.exe"
    !insertmacro Log "an earlier install did not finish"
    Call PutBack
  ${EndIf}
  RMDir /r "${NEW}"
  RMDir /r "${OLD}"

  StrCpy $1 "$INSTDIR" 3
  ${DriveSpace} "$1" "/D=F /S=M" $0
  ${If} $0 < ${NEED_MB}
    !insertmacro Log "failed: only $0 MB free"
    MessageBox MB_OK|MB_ICONSTOP "Not enough free space on the disk (3 GB needed). Nothing was changed.${DETAILS}" /SD IDOK
    Goto failed
  ${EndIf}

  DetailPrint "Unpacking the new version..."
  SetOutPath "${NEW}"
  File /r "..\..\stage\*.*"
  SetOutPath "$INSTDIR"

  DetailPrint "Checking the new version on this computer..."
  nsExec::Exec '"${NEW}\python\python.exe" "${NEW}\app\installer\check_install.py" preflight --log "${LOGFILE}"'
  Pop $0
  ${If} $0 != 0
    !insertmacro Log "failed: the new version cannot run here (exit $0); nothing was changed"
    RMDir /r "${NEW}"
    MessageBox MB_OK|MB_ICONSTOP "The new version cannot run on this computer. Nothing was changed.${DETAILS}" /SD IDOK
    Goto failed
  ${EndIf}

  ; Copied while the cameras still run: only this and the swap come before the stop
  CreateDirectory "${OLD}"
  ${If} ${FileExists} "$INSTDIR\app\service.py"
    DetailPrint "Keeping a copy of the previous version..."
    nsExec::Exec 'robocopy "$INSTDIR\app" "${OLD}\app" /E ${ROBO_KEEP_FOLDERS} ${ROBO_KEEP_FILES} ${ROBO_QUIET}'
    Pop $1
    ${If} $1 == "error"
    ${OrIf} $1 >= 8
      !insertmacro Log "failed: could not copy the previous version (robocopy $1); nothing was changed"
      RMDir /r "${NEW}"
      RMDir /r "${OLD}"
      MessageBox MB_OK|MB_ICONSTOP "The previous version could not be copied, so the update did not start. Nothing was changed.${DETAILS}" /SD IDOK
      Goto failed
    ${EndIf}
  ${EndIf}

  DetailPrint "Replacing the programs..."
  !insertmacro Log "stopping the monitoring"
  Call StopMonitoring
  Call SwapIn
  ${If} $0 != 1
    !insertmacro Log "failed: the files could not be replaced"
    StrCpy $2 "The files could not be replaced"
    Goto restore
  ${EndIf}

  SetOverwrite off
  SetOutPath "$INSTDIR\app\config"
  File "..\config\cameras.yaml"
  SetOverwrite on
  SetOutPath "$INSTDIR"

  ${If} $Upgrade != 1
    Goto finished
  ${EndIf}

  DetailPrint "Starting the monitoring. Waiting for the website (up to 8 minutes)..."
  !insertmacro Log "starting the new version"
  Call StartMonitoring
  nsExec::Exec '"$INSTDIR\python\python.exe" "$INSTDIR\app\installer\check_install.py" wait --log "${LOGFILE}"'
  Pop $0
  ${If} $0 != 0
    !insertmacro Log "failed: no heartbeat from the new version (exit $0)"
    StrCpy $2 "The new version did not reach the website within 8 minutes"
    Call StopMonitoring
    Goto restore
  ${EndIf}
  Goto finished

  restore:
  DetailPrint "Putting the previous version back..."
  Call PutBack
  ${If} $0 != 1
    !insertmacro Log "failed: the previous version could not be put back"
    MessageBox MB_OK|MB_ICONSTOP "$2, and the previous version could not be put back. The cameras may be stopped: please send the log to support.${DETAILS}" /SD IDOK
    Goto failed
  ${EndIf}
  RMDir /r "${NEW}"
  RMDir /r "${OLD}"
  ${If} $Upgrade == 1
    Call StartMonitoring
    !insertmacro Log "the previous version is back and has been restarted"
    MessageBox MB_OK|MB_ICONEXCLAMATION "$2. The previous version was put back and restarted.${DETAILS}" /SD IDOK
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "$2. Nothing was installed.${DETAILS}" /SD IDOK
  ${EndIf}
  Goto failed

  finished:
  RMDir /r "${NEW}"
  RMDir /r "${OLD}"
  RMDir /r "$INSTDIR\ffmpegold"
  CreateShortcut "$DESKTOP\Run camera test again.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\app\installer\setup_gui.py" --test' "" "" SW_SHOWNORMAL "" "Test the cameras"
  CreateShortcut "$DESKTOP\Uninstall DVS CCTV.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\app\installer\setup_gui.py" --uninstall' "" "" SW_SHOWNORMAL "" "Remove the CCTV software"
  !insertmacro Log "finished"
  ${If} $Upgrade == 1
    MessageBox MB_OK "DVS CCTV is updated and the monitoring has restarted. Your settings were kept." /SD IDOK
  ${Else}
    ${IfNot} ${Silent}
      Exec '"$INSTDIR\python\pythonw.exe" "$INSTDIR\app\installer\setup_gui.py"'
    ${EndIf}
  ${EndIf}
  Goto done

  failed:
  SetErrorLevel 1
  done:
SectionEnd
