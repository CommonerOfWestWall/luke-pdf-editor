; Windows 10/11 does not allow installers to assign protected per-user defaults.
; Register a stable ProgID and Default Apps capability, then let the user confirm.
!define LUKE_PDF_PROGID "LukePdfEditor.Document"
!define LUKE_PDF_CAPABILITIES "Software\LukePdfEditor\Capabilities"
!define LUKE_PDF_THUMBNAIL_CLSID "{8886CF30-E7A4-49AC-9DF2-2EA9C8396FE1}"
!define WINDOWS_THUMBNAIL_HANDLER "{E357FCCD-A995-4576-B01F-234630154E96}"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${LUKE_PDF_PROGID}" "" "鲁科 PDF 文档"
  WriteRegStr SHCTX "Software\Classes\${LUKE_PDF_PROGID}" "FriendlyTypeName" "鲁科 PDF 文档"
  WriteRegStr SHCTX "Software\Classes\${LUKE_PDF_PROGID}\DefaultIcon" "" "$\"$INSTDIR\assets\pdf-file.ico$\",0"
  WriteRegStr SHCTX "Software\Classes\${LUKE_PDF_PROGID}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${LUKE_PDF_PROGID}\shell\open" "" "用鲁科 PDF 编辑器打开"
  WriteRegStr SHCTX "Software\Classes\${LUKE_PDF_PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\${LUKE_PDF_PROGID}\shellex\${WINDOWS_THUMBNAIL_HANDLER}" "" "${LUKE_PDF_THUMBNAIL_CLSID}"

  ; The page-1 thumbnail handler stays in Explorer's isolated COM host.
  WriteRegStr SHCTX "Software\Classes\CLSID\${LUKE_PDF_THUMBNAIL_CLSID}" "" "鲁科 PDF 首页缩略图处理器"
  WriteRegStr SHCTX "Software\Classes\CLSID\${LUKE_PDF_THUMBNAIL_CLSID}\InprocServer32" "" "$INSTDIR\shell\luke_pdf_thumbnail.dll"
  WriteRegStr SHCTX "Software\Classes\CLSID\${LUKE_PDF_THUMBNAIL_CLSID}\InprocServer32" "ThreadingModel" "Apartment"

  ; Add to Open With without replacing the current .pdf default or UserChoice.
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "${LUKE_PDF_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$\"$INSTDIR\assets\pdf-file.ico$\",0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".pdf" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  ; Register as a Default Apps candidate for the current user.
  WriteRegStr SHCTX "${LUKE_PDF_CAPABILITIES}" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${LUKE_PDF_CAPABILITIES}" "ApplicationDescription" "现代、离线、开源的 PDF 阅读与批注工具"
  WriteRegStr SHCTX "${LUKE_PDF_CAPABILITIES}" "ApplicationIcon" "$INSTDIR\assets\pdf-file.ico,0"
  WriteRegStr SHCTX "${LUKE_PDF_CAPABILITIES}\FileAssociations" ".pdf" "${LUKE_PDF_PROGID}"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "${LUKE_PDF_CAPABILITIES}"

  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "${LUKE_PDF_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\Classes\${LUKE_PDF_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\CLSID\${LUKE_PDF_THUMBNAIL_CLSID}"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey SHCTX "Software\LukePdfEditor"
  Delete /REBOOTOK "$INSTDIR\shell\luke_pdf_thumbnail.dll"
  !insertmacro UPDATEFILEASSOC
!macroend
