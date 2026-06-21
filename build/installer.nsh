; ============================================================
; Antibiogram Analytics - Enhanced NSIS Installer Script
; Requires Windows 7 SP1 (6.1.7601) or later, 32-bit or 64-bit
; Includes: OS version check, integrity markers, file associations
; ============================================================

!macro customHeader
  ; Pull in Windows version helpers
  !include "WinVer.nsh"
  !include "x64.nsh"

  ; App-level constants used in custom sections
  !define APP_MUTEX "AntibiogramAnalytics_SingleInstance"
  !define MIN_OS_NAME "Windows 7 SP1 (32-bit or 64-bit)"
!macroend

; ── Early init: OS version gate ─────────────────────────────────────────────
; electron-builder calls !insertmacro customInit inside .onInit
!macro customInit
  ; Require Windows 7 (NT 6.1) SP1 minimum
  ${If} ${AtLeastWin7}
    ; Check SP1: build number >= 7601
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
    ${If} $0 < 7601
      MessageBox MB_OK|MB_ICONSTOP \
        "Antibiogram Analytics requires Windows 7 SP1 or later.$\n$\nYour system: Windows 7 RTM (build $0)$\nRequired: Windows 7 SP1 (build 7601+)$\n$\nPlease install Windows 7 Service Pack 1 and try again." \
        /SD IDOK
      Abort
    ${EndIf}
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP \
      "Antibiogram Analytics requires ${MIN_OS_NAME} or later.$\n$\nThis installer will now exit." \
      /SD IDOK
    Abort
  ${EndIf}

  ; Block multiple installer instances
  System::Call 'kernel32::CreateMutex(p 0, i 1, t "${APP_MUTEX}") p .r0'
  System::Call 'kernel32::GetLastError() i .r1'
  ${If} $1 = 183
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "The Antibiogram Analytics installer is already running." \
      /SD IDOK
    Abort
  ${EndIf}
!macroend

; ── Post-install actions ─────────────────────────────────────────────────────
!macro customInstall
  ; Register .abgx file association (HKCU - no admin required)
  WriteRegStr HKCU "Software\Classes\.abgx" "" "AntibiogramAnalytics.Project"
  WriteRegStr HKCU "Software\Classes\.abgx" "Content Type" "application/x-antibiogram"
  WriteRegStr HKCU "Software\Classes\AntibiogramAnalytics.Project" "" "Antibiogram Analytics Project"
  WriteRegStr HKCU "Software\Classes\AntibiogramAnalytics.Project\DefaultIcon" \
    "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\AntibiogramAnalytics.Project\shell\open\command" \
    "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Write integrity marker (read back by the app on first launch)
  WriteRegStr HKCU "Software\Abdallahjawadk\AntibiogramAnalytics" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\Abdallahjawadk\AntibiogramAnalytics" "Version" "${VERSION}"

  ; Notify shell to refresh icons immediately
  System::Call 'shell32::SHChangeNotify(l 0x8000000, i 0, p 0, p 0)'
!macroend

; ── Uninstall cleanup ────────────────────────────────────────────────────────
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\.abgx"
  DeleteRegKey HKCU "Software\Classes\AntibiogramAnalytics.Project"
  DeleteRegKey HKCU "Software\Abdallahjawadk\AntibiogramAnalytics"

  ; Refresh shell icons after uninstall
  System::Call 'shell32::SHChangeNotify(l 0x8000000, i 0, p 0, p 0)'
!macroend