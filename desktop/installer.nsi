; Shift Shift — Windows installer (NSIS).
; Built with the native Linux makensis (no Wine needed):
;   makensis installer.nsi
; Produces a self-contained setup .exe that installs the app from
; dist/win-unpacked, with Start Menu + Desktop shortcuts and an
; uninstaller. Per-user install (no admin / UAC prompt).
; The electron-builder config (package.json "build") is the canonical
; installer definition for a Windows build; this script is the
; Linux-built equivalent so a setup .exe can be produced here.
; The published release asset is renamed to "Shift.Shift.Setup.<version>.exe"
; (fully dotted, no spaces) at publish time — see scripts/publish-release.js.
; GitHub renames spaces to dots in asset names, so the local name must
; already match what GitHub will store, or latest.yml points nowhere.
; Upgrading from Sideshow: the installer removes the old Sideshow
; install (directory + uninstall entry) so only Shift Shift remains.
; electron-updater installs later updates in place into the same
; directory; the full installer is only the first-install route.

!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "Shift Shift"
OutFile "dist/Shift Shift Setup 0.1.16.exe"
InstallDir "$LOCALAPPDATA\Programs\Shift Shift"
InstallDirRegKey HKCU "Software\Shift Shift" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ICON "assets/icon.ico"
!define MUI_UNICON "assets/icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Shift Shift"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Shift Shift.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Run Shift Shift"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; Remove the old Sideshow install, if present (best-effort: a
  ; running old copy locks its files and the delete is skipped).
  RMDir /r "$LOCALAPPDATA\Programs\Sideshow"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Sideshow"
  DeleteRegKey HKCU "Software\Sideshow"
  SetOutPath "$INSTDIR"
  File /r "dist/win-unpacked\*.*"
  ; Seed electron-updater's differential cache (stock NSIS behavior):
  ; the updater diffs the next version against the old installer
  ; stored as installer.exe in the updater cache dir. Without this
  ; copy, a manual install leaves nothing to diff against and the
  ; first patch update is a full download. The uninstaller does not
  ; touch the cache (stock behavior).
  CreateDirectory "$LOCALAPPDATA\shift-shift-desktop-updater"
  CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\shift-shift-desktop-updater\installer.exe"
  WriteRegStr HKCU "Software\Shift Shift" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Shift Shift" "DisplayName" "Shift Shift"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Shift Shift" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Shift Shift" "DisplayIcon" "$INSTDIR\Shift Shift.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Shift Shift" "DisplayVersion" "0.1.16"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Shift Shift"
  CreateShortcut "$SMPROGRAMS\Shift Shift\Shift Shift.lnk" "$INSTDIR\Shift Shift.exe" "" "$INSTDIR\Shift Shift.exe" 0
  CreateShortcut "$SMPROGRAMS\Shift Shift\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Shift Shift.lnk" "$INSTDIR\Shift Shift.exe" "" "$INSTDIR\Shift Shift.exe" 0
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Shift Shift\Shift Shift.lnk"
  Delete "$SMPROGRAMS\Shift Shift\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Shift Shift"
  Delete "$DESKTOP\Shift Shift.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Shift Shift"
  DeleteRegKey HKCU "Software\Shift Shift"
SectionEnd
