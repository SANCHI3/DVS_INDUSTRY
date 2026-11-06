; One-file installer. Built by installer/build_windows.ps1 on GitHub Actions.
; Asks Windows once for "Yes": a running monitoring can belong to SYSTEM, and only
; an administrator can stop it to replace its files. Run over an installed copy it
; replaces the programs, keeps the settings and restarts, with no setup window.
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

Section
  ; Files in use cannot be replaced, so stop a running copy first
  nsExec::Exec 'schtasks /end /tn "DVS CCTV Monitoring"'
  nsExec::Exec `powershell -NoProfile -Command "Get-Process python,pythonw,mediamtx,ffmpeg,ffprobe -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like 'C:\dvs-cctv\*' } | Stop-Process -Force"`

  Sleep 2000

  ; Only the programs are replaced. app\.env, app\logs, app\output, calibration and
  ; app\config\cameras.yaml stay as they are, so an upgrade keeps every setting.
  RMDir /r "$INSTDIR\python"
  RMDir /r "$INSTDIR\ffmpeg"
  RMDir /r "$INSTDIR\mediamtx"
  RMDir /r "$INSTDIR\ffmpegold"

  SetOutPath "$INSTDIR"
  File /r "..\..\stage\*.*"
  SetOverwrite off
  SetOutPath "$INSTDIR\app\config"
  File "..\config\cameras.yaml"
  SetOverwrite on

  CreateShortcut "$DESKTOP\Run camera test again.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\app\installer\setup_gui.py" --test' "" "" SW_SHOWNORMAL "" "Test the cameras"
  CreateShortcut "$DESKTOP\Uninstall DVS CCTV.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\app\installer\setup_gui.py" --uninstall' "" "" SW_SHOWNORMAL "" "Remove the CCTV software"

  IfFileExists "$INSTDIR\app\.env" 0 fresh
  nsExec::Exec 'schtasks /run /tn "DVS CCTV Monitoring"'
  Pop $0
  StrCmp $0 "0" started
  Exec '"$INSTDIR\python\pythonw.exe" "$INSTDIR\app\service.py" run'
  started:
  MessageBox MB_OK "DVS CCTV is updated and the monitoring has restarted. Your settings were kept." /SD IDOK
  Goto done

  fresh:
  IfSilent done
  Exec '"$INSTDIR\python\pythonw.exe" "$INSTDIR\app\installer\setup_gui.py"'
  done:
SectionEnd
