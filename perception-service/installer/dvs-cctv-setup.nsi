; One-file installer. Built by installer/build_windows.ps1 on GitHub Actions.
; Needs no administrator rights: the setup window asks for "Allow" only for
; the steps that need it. Settings and camera names survive a reinstall.
Unicode true
Name "DVS CCTV"
OutFile "..\..\dvs-cctv-setup.exe"
InstallDir "C:\dvs-cctv"
RequestExecutionLevel user
SetCompressor /SOLID /FINAL lzma
SetCompressorDictSize 64
ShowInstDetails nevershow
AutoCloseWindow true
BrandingText "DVS Industries"

Section
  ; Files in use cannot be replaced, so stop a running copy first
  nsExec::Exec 'schtasks /end /tn "DVS CCTV Monitoring"'
  nsExec::Exec `powershell -NoProfile -Command "Get-Process python,pythonw,mediamtx -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like 'C:\dvs-cctv\*' } | Stop-Process -Force"`

  SetOutPath "$INSTDIR"
  File /r "..\..\stage\*.*"
  SetOverwrite off
  SetOutPath "$INSTDIR\app\config"
  File "..\config\cameras.yaml"
  SetOverwrite on

  CreateShortcut "$DESKTOP\Run camera test again.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\app\installer\setup_gui.py" --test' "" "" SW_SHOWNORMAL "" "Test the cameras"
  CreateShortcut "$DESKTOP\Uninstall DVS CCTV.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\app\installer\setup_gui.py" --uninstall' "" "" SW_SHOWNORMAL "" "Remove the CCTV software"

  IfSilent done
  Exec '"$INSTDIR\python\pythonw.exe" "$INSTDIR\app\installer\setup_gui.py"'
  done:
SectionEnd
