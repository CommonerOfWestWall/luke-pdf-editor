use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
#[cfg(all(feature = "e2e", debug_assertions))]
use tauri::Manager;
use tauri::{AppHandle, State, ipc::InvokeBody};
use tauri_plugin_dialog::DialogExt;
use tempfile::Builder;
use thiserror::Error;

#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!("the e2e WebDriver feature is forbidden in release builds");

#[derive(Debug, Error)]
enum AppError {
    #[error("文件路径无效：{0}")]
    InvalidPath(String),
    #[error("只允许打开 PDF 文件")]
    NotPdf,
    #[error("找不到文档会话")]
    SessionNotFound,
    #[error("保存请求缺少文档会话")]
    MissingSessionHeader,
    #[error("保存请求不是二进制 PDF 数据")]
    InvalidSaveBody,
    #[error("拒绝写入非 PDF 数据")]
    InvalidPdfData,
    #[error("文件已被其他程序修改；为避免覆盖，请重新打开或另存为")]
    ExternalModification,
    #[error("文件在保存期间被其他程序修改；外部版本已恢复，本地修改保存在同目录的 {0}")]
    ExternalModificationRecovered(String),
    #[error(
        "无法检查被替换文件（{detail}）；外部版本已恢复，本地修改保存在同目录的 {conflict_name}"
    )]
    ConflictInspectionRecovered {
        conflict_name: String,
        detail: String,
    },
    #[error(
        "保存冲突恢复未完成（{detail}）；请勿关闭应用，并检查同目录的外部版本备份 {backup_name} 与本地版本候选 {conflict_name}"
    )]
    ConflictRecoveryFailed {
        backup_name: String,
        conflict_name: String,
        detail: String,
    },
    #[error("文件已替换但最终校验失败（{detail}）；原版本仍保存在同目录的 {backup_name}")]
    SaveFinalizationFailed { backup_name: String, detail: String },
    #[error(
        "保存完成前目标文件再次被其他程序改写；原版本保存在 {backup_name}，本地修改保存在 {conflict_name}"
    )]
    SaveVerificationMismatch {
        backup_name: String,
        conflict_name: String,
    },
    #[error("保存授权无效或已经使用")]
    InvalidSaveTarget,
    #[error("另存为目标在确认后被创建、删除或修改；未覆盖该文件，请重新选择目标")]
    SaveTargetChanged,
    #[error("只允许打开 http、https 或 mailto 外部链接")]
    InvalidExternalUrl,
    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("无法持久化临时文件：{0}")]
    Persist(#[from] tempfile::PersistError),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone)]
struct DocumentSession {
    path: PathBuf,
    fingerprint: String,
}

#[derive(Debug, Clone)]
struct PendingSaveTarget {
    session_id: String,
    path: PathBuf,
    expected_fingerprint: Option<String>,
}

struct DocumentSessions {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, DocumentSession>>,
    save_targets: Mutex<HashMap<String, PendingSaveTarget>>,
    startup_paths: Mutex<Option<Vec<PathBuf>>>,
}

impl Default for DocumentSessions {
    fn default() -> Self {
        let startup_paths =
            collect_startup_pdf_paths(std::env::args_os().skip(1).map(PathBuf::from));
        if std::env::var_os("LUKE_STARTUP_TRACE").is_some() {
            eprintln!("startup: 已接受 {} 个 PDF 启动参数", startup_paths.len());
        }
        Self {
            next_id: AtomicU64::default(),
            sessions: Mutex::default(),
            save_targets: Mutex::default(),
            startup_paths: Mutex::new(Some(startup_paths)),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    id: String,
    path: String,
    title: String,
    fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveTargetResponse {
    token: String,
    path: String,
    title: String,
}

fn next_token(state: &DocumentSessions) -> String {
    let sequence = state.next_id.fetch_add(1, Ordering::Relaxed);
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}-{:x}-{:x}", std::process::id(), time, sequence)
}

fn canonical_pdf_path(path: impl AsRef<Path>, must_exist: bool) -> Result<PathBuf, AppError> {
    let path = path.as_ref();
    let extension_is_pdf = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("pdf"));
    if !extension_is_pdf {
        return Err(AppError::NotPdf);
    }

    if must_exist {
        let canonical = path
            .canonicalize()
            .map_err(|_| AppError::InvalidPath(path.display().to_string()))?;
        if !canonical.is_file() {
            return Err(AppError::InvalidPath(canonical.display().to_string()));
        }
        Ok(canonical)
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|_| AppError::InvalidPath(parent.display().to_string()))?;
        let file_name = path
            .file_name()
            .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
        Ok(canonical_parent.join(file_name))
    }
}

fn collect_startup_pdf_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    paths
        .into_iter()
        .filter_map(|path| canonical_pdf_path(path, true).ok())
        .collect()
}

fn fingerprint(path: &Path) -> Result<String, AppError> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn fingerprint_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

fn validate_external_url(url: &str) -> Result<&str, AppError> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let allowed = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !allowed || url.len() > 4096 || url.chars().any(char::is_control) {
        return Err(AppError::InvalidExternalUrl);
    }
    Ok(url)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), AppError> {
    let url = validate_external_url(&url)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{
            UI::Shell::ShellExecuteW, UI::WindowsAndMessaging::SW_SHOWNORMAL,
        };

        let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let url: Vec<u16> = std::ffi::OsStr::new(url)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if result as isize <= 32 {
            return Err(AppError::Io(std::io::Error::last_os_error()));
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = url;
        Err(AppError::InvalidExternalUrl)
    }
}

fn register_document_path(
    path: impl AsRef<Path>,
    state: &DocumentSessions,
) -> Result<SessionResponse, AppError> {
    let path = canonical_pdf_path(path, true)?;
    let fingerprint = fingerprint(&path)?;
    let id = next_token(state);
    let title = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.pdf")
        .to_owned();

    state
        .sessions
        .lock()
        .expect("document session lock poisoned")
        .insert(
            id.clone(),
            DocumentSession {
                path: path.clone(),
                fingerprint: fingerprint.clone(),
            },
        );

    Ok(SessionResponse {
        id,
        path: path.to_string_lossy().into_owned(),
        title,
        fingerprint,
    })
}

#[tauri::command]
async fn open_document_dialog(
    app: AppHandle,
    state: State<'_, DocumentSessions>,
) -> Result<Option<SessionResponse>, AppError> {
    let selected = app
        .dialog()
        .file()
        .set_title("打开 PDF")
        .add_filter("PDF 文档", &["pdf"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| AppError::InvalidPath(error.to_string()))?;
    register_document_path(path, state.inner()).map(Some)
}

#[tauri::command]
fn read_document(
    session_id: String,
    state: State<'_, DocumentSessions>,
) -> Result<tauri::ipc::Response, AppError> {
    if std::env::var_os("LUKE_STARTUP_TRACE").is_some() {
        eprintln!("startup: 开始读取已注册文档");
    }
    let path = state
        .sessions
        .lock()
        .expect("document session lock poisoned")
        .get(&session_id)
        .ok_or(AppError::SessionNotFound)?
        .path
        .clone();
    let bytes = fs::read(path)?;
    if std::env::var_os("LUKE_STARTUP_TRACE").is_some() {
        eprintln!("startup: 已读取 {} 字节", bytes.len());
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn take_startup_documents(
    state: State<'_, DocumentSessions>,
) -> Result<Vec<SessionResponse>, AppError> {
    let paths = state
        .startup_paths
        .lock()
        .expect("startup document lock poisoned")
        .take()
        .unwrap_or_default();
    if std::env::var_os("LUKE_STARTUP_TRACE").is_some() {
        eprintln!("startup: 前端取走 {} 个 PDF 启动参数", paths.len());
    }
    paths
        .into_iter()
        .map(|path| register_document_path(path, state.inner()))
        .collect()
}

#[tauri::command]
async fn choose_save_target(
    app: AppHandle,
    session_id: String,
    state: State<'_, DocumentSessions>,
) -> Result<Option<SaveTargetResponse>, AppError> {
    let default_name = state
        .sessions
        .lock()
        .expect("document session lock poisoned")
        .get(&session_id)
        .ok_or(AppError::SessionNotFound)?
        .path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.pdf")
        .to_owned();
    let selected = app
        .dialog()
        .file()
        .set_title("PDF 另存为")
        .set_file_name(default_name)
        .add_filter("PDF 文档", &["pdf"])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|error| AppError::InvalidPath(error.to_string()))?;
    let path = canonical_pdf_path(&selected, selected.exists())?;
    let expected_fingerprint = if path.exists() {
        Some(fingerprint(&path)?)
    } else {
        None
    };
    let title = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.pdf")
        .to_owned();
    let token = next_token(state.inner());
    state
        .save_targets
        .lock()
        .expect("save target lock poisoned")
        .insert(
            token.clone(),
            PendingSaveTarget {
                session_id,
                path: path.clone(),
                expected_fingerprint,
            },
        );
    Ok(Some(SaveTargetResponse {
        token,
        path: path.to_string_lossy().into_owned(),
        title,
    }))
}

fn atomic_replace(source: &Path, target: &Path, backup: Option<&Path>) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_WRITE_THROUGH, MoveFileExW, ReplaceFileW,
        };

        let target_exists = target.exists();
        let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        let backup_wide = backup.map(|path| {
            path.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<u16>>()
        });
        let backup_ptr = backup_wide
            .as_ref()
            .map_or(std::ptr::null(), |path| path.as_ptr());
        let result = unsafe {
            if backup.is_some() || target_exists {
                ReplaceFileW(
                    target_wide.as_ptr(),
                    source_wide.as_ptr(),
                    backup_ptr,
                    0,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            } else {
                MoveFileExW(
                    source_wide.as_ptr(),
                    target_wide.as_ptr(),
                    MOVEFILE_WRITE_THROUGH,
                )
            }
        };
        if result == 0 {
            return Err(AppError::Io(std::io::Error::last_os_error()));
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        if let Some(backup) = backup {
            fs::rename(target, backup)?;
            if let Err(error) = fs::rename(source, target) {
                let _ = fs::rename(backup, target);
                return Err(error.into());
            }
        } else {
            fs::rename(source, target)?;
        }
        Ok(())
    }
}

fn atomic_create_new(source: &Path, target: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};

        let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        let result = unsafe {
            MoveFileExW(
                source_wide.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            let error = std::io::Error::last_os_error();
            return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
                AppError::SaveTargetChanged
            } else {
                AppError::Io(error)
            });
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        fs::hard_link(source, target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                AppError::SaveTargetChanged
            } else {
                AppError::Io(error)
            }
        })?;
        Ok(())
    }
}

fn prepare_pdf_temp(path: &Path, bytes: &[u8]) -> Result<tempfile::TempPath, AppError> {
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err(AppError::InvalidPdfData);
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
    let mut temporary = Builder::new()
        .prefix(".luke-pdf-")
        .suffix(".tmp")
        .tempfile_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    Ok(temporary.into_temp_path())
}

fn vacant_temp_path(parent: &Path, prefix: &str, suffix: &str) -> Result<PathBuf, AppError> {
    let temporary = Builder::new()
        .prefix(prefix)
        .suffix(suffix)
        .tempfile_in(parent)?;
    let path = temporary.path().to_owned();
    temporary.close()?;
    Ok(path)
}

fn write_pdf_bytes(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    let temporary_path = prepare_pdf_temp(path, bytes)?;
    atomic_replace(temporary_path.as_ref(), path, None)?;
    fingerprint(path)
}

fn write_pdf_bytes_new(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    let temporary_path = prepare_pdf_temp(path, bytes)?;
    atomic_create_new(temporary_path.as_ref(), path)?;
    let saved_fingerprint = fingerprint(path)?;
    if saved_fingerprint != fingerprint_bytes(bytes) {
        return Err(AppError::SaveTargetChanged);
    }
    Ok(saved_fingerprint)
}

fn verify_saved_pdf(
    path: &Path,
    bytes: &[u8],
    backup: &Path,
    backup_name: &str,
) -> Result<String, AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
    let saved_fingerprint =
        fingerprint(path).map_err(|error| AppError::SaveFinalizationFailed {
            backup_name: backup_name.to_owned(),
            detail: error.to_string(),
        })?;
    if saved_fingerprint != fingerprint_bytes(bytes) {
        let conflict =
            vacant_temp_path(parent, ".luke-pdf-conflict-", ".pdf").map_err(|error| {
                AppError::SaveFinalizationFailed {
                    backup_name: backup_name.to_owned(),
                    detail: format!("目标文件最终内容不匹配，且无法创建本地副本：{error}"),
                }
            })?;
        let conflict_name = conflict
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("鲁科-PDF-本地修改.pdf")
            .to_owned();
        write_pdf_bytes(&conflict, bytes).map_err(|error| AppError::ConflictRecoveryFailed {
            backup_name: backup_name.to_owned(),
            conflict_name: conflict_name.clone(),
            detail: error.to_string(),
        })?;
        return Err(AppError::SaveVerificationMismatch {
            backup_name: backup_name.to_owned(),
            conflict_name,
        });
    }
    let _ = fs::remove_file(backup);
    Ok(saved_fingerprint)
}

fn write_pdf_bytes_checked(
    path: &Path,
    bytes: &[u8],
    expected_fingerprint: &str,
) -> Result<String, AppError> {
    let temporary_path = prepare_pdf_temp(path, bytes)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
    let backup = vacant_temp_path(parent, ".luke-pdf-backup-", ".pdf")?;
    atomic_replace(temporary_path.as_ref(), path, Some(&backup))?;

    let backup_name = backup
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("鲁科-PDF-外部版本备份.pdf")
        .to_owned();
    let replaced_fingerprint = match fingerprint(&backup) {
        Ok(value) => value,
        Err(error) => {
            let conflict = vacant_temp_path(parent, ".luke-pdf-conflict-", ".pdf").map_err(
                |recovery_error| AppError::ConflictRecoveryFailed {
                    backup_name: backup_name.clone(),
                    conflict_name: "尚未创建".to_owned(),
                    detail: format!("{error}; {recovery_error}"),
                },
            )?;
            let conflict_name = conflict
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("鲁科-PDF-本地修改.pdf")
                .to_owned();
            atomic_replace(&backup, path, Some(&conflict)).map_err(|recovery_error| {
                AppError::ConflictRecoveryFailed {
                    backup_name: backup_name.clone(),
                    conflict_name: conflict_name.clone(),
                    detail: format!("{error}; {recovery_error}"),
                }
            })?;
            return Err(AppError::ConflictInspectionRecovered {
                conflict_name,
                detail: error.to_string(),
            });
        }
    };
    if replaced_fingerprint != expected_fingerprint {
        let conflict =
            vacant_temp_path(parent, ".luke-pdf-conflict-", ".pdf").map_err(|error| {
                AppError::ConflictRecoveryFailed {
                    backup_name: backup_name.clone(),
                    conflict_name: "尚未创建".to_owned(),
                    detail: error.to_string(),
                }
            })?;
        let conflict_name = conflict
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("鲁科-PDF-本地修改.pdf")
            .to_owned();
        atomic_replace(&backup, path, Some(&conflict)).map_err(|error| {
            AppError::ConflictRecoveryFailed {
                backup_name: backup_name.clone(),
                conflict_name: conflict_name.clone(),
                detail: error.to_string(),
            }
        })?;
        return Err(AppError::ExternalModificationRecovered(conflict_name));
    }

    verify_saved_pdf(path, bytes, &backup, &backup_name)
}

fn save_existing_session(session: &mut DocumentSession, bytes: &[u8]) -> Result<(), AppError> {
    if !session.path.exists() {
        return Err(AppError::ExternalModification);
    }
    session.fingerprint = write_pdf_bytes_checked(&session.path, bytes, &session.fingerprint)?;
    Ok(())
}

#[tauri::command]
fn save_document(
    request: tauri::ipc::Request<'_>,
    state: State<'_, DocumentSessions>,
) -> Result<(), AppError> {
    let session_id = request
        .headers()
        .get("x-document-session")
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::MissingSessionHeader)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::InvalidSaveBody);
    };
    let mut sessions = state
        .sessions
        .lock()
        .expect("document session lock poisoned");
    let session = sessions
        .get_mut(session_id)
        .ok_or(AppError::SessionNotFound)?;
    save_existing_session(session, bytes)
}

#[tauri::command]
fn save_document_as(
    request: tauri::ipc::Request<'_>,
    state: State<'_, DocumentSessions>,
) -> Result<SessionResponse, AppError> {
    let token = request
        .headers()
        .get("x-save-target")
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::InvalidSaveTarget)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::InvalidSaveBody);
    };
    let target = state
        .save_targets
        .lock()
        .expect("save target lock poisoned")
        .remove(token)
        .ok_or(AppError::InvalidSaveTarget)?;
    let new_fingerprint = match target.expected_fingerprint {
        Some(expected) => write_pdf_bytes_checked(&target.path, bytes, &expected)?,
        None => write_pdf_bytes_new(&target.path, bytes)?,
    };
    let mut sessions = state
        .sessions
        .lock()
        .expect("document session lock poisoned");
    let session = sessions
        .get_mut(&target.session_id)
        .ok_or(AppError::SessionNotFound)?;
    session.path = target.path.clone();
    session.fingerprint = new_fingerprint.clone();
    let title = target
        .path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.pdf")
        .to_owned();
    Ok(SessionResponse {
        id: target.session_id,
        path: target.path.to_string_lossy().into_owned(),
        title,
        fingerprint: new_fingerprint,
    })
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[tauri::command]
fn e2e_run_id() -> String {
    std::env::var("LUKE_E2E_RUN_ID").expect("LUKE_E2E_RUN_ID must be set by the E2E runner")
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[tauri::command]
fn e2e_request_close(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_owned())?
        .close()
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(all(feature = "e2e", debug_assertions))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let builder = builder
        .manage(DocumentSessions::default())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(all(feature = "e2e", debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        open_document_dialog,
        take_startup_documents,
        read_document,
        choose_save_target,
        save_document,
        save_document_as,
        open_external_url,
        e2e_run_id,
        e2e_request_close,
    ]);
    #[cfg(not(all(feature = "e2e", debug_assertions)))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        open_document_dialog,
        take_startup_documents,
        read_document,
        choose_save_target,
        save_document,
        save_document_as,
        open_external_url,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running 鲁科 PDF 编辑器");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_pdf_extension() {
        let result = canonical_pdf_path("document.txt", false);
        assert!(matches!(result, Err(AppError::NotPdf)));
    }

    #[test]
    fn accepts_pdf_extension_case_insensitively() {
        let current = std::env::current_dir().expect("current directory");
        let result = canonical_pdf_path(current.join("document.PDF"), false);
        assert!(result.is_ok());
    }

    #[test]
    fn startup_arguments_only_keep_existing_pdf_files() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let first = directory.path().join("第一份 文档.pdf");
        let second = directory.path().join("SECOND.PDF");
        let text = directory.path().join("notes.txt");
        fs::write(&first, b"%PDF-1.7 first").expect("write first PDF");
        fs::write(&second, b"%PDF-1.7 second").expect("write second PDF");
        fs::write(&text, b"not a PDF").expect("write text file");

        let paths = collect_startup_pdf_paths([
            PathBuf::from("--install"),
            first.clone(),
            text,
            directory.path().join("missing.pdf"),
            second.clone(),
        ]);

        assert_eq!(
            paths,
            vec![
                first.canonicalize().expect("canonical first PDF"),
                second.canonicalize().expect("canonical second PDF"),
            ]
        );
    }

    #[test]
    fn external_links_use_a_strict_scheme_allowlist() {
        assert_eq!(
            validate_external_url("https://example.com/review").expect("https url"),
            "https://example.com/review"
        );
        assert!(matches!(
            validate_external_url("javascript:alert(1)"),
            Err(AppError::InvalidExternalUrl)
        ));
        assert!(matches!(
            validate_external_url("file:///C:/secret.txt"),
            Err(AppError::InvalidExternalUrl)
        ));
    }

    #[test]
    fn atomic_replace_overwrites_existing_file() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let source = directory.path().join("replacement.tmp");
        let target = directory.path().join("document.pdf");
        fs::write(&source, b"new pdf bytes").expect("write source");
        fs::write(&target, b"old pdf bytes").expect("write target");

        atomic_replace(&source, &target, None).expect("replace target");

        assert_eq!(fs::read(&target).expect("read target"), b"new pdf bytes");
        assert!(!source.exists());
    }

    #[test]
    fn save_rejects_external_modification_without_overwriting_it() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("document.pdf");
        fs::write(&path, b"%PDF-1.7 original").expect("write original");
        let mut session = DocumentSession {
            path: path.clone(),
            fingerprint: fingerprint(&path).expect("original fingerprint"),
        };
        fs::write(&path, b"%PDF-1.7 changed elsewhere").expect("external write");

        let result = save_existing_session(&mut session, b"%PDF-1.7 local changes");

        assert!(matches!(
            result,
            Err(AppError::ExternalModificationRecovered(_))
        ));
        assert_eq!(
            fs::read(&path).expect("read external version"),
            b"%PDF-1.7 changed elsewhere"
        );
        let conflict = fs::read_dir(directory.path())
            .expect("list directory")
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".luke-pdf-conflict-")
            })
            .expect("local conflict copy");
        assert_eq!(
            fs::read(conflict.path()).expect("read local conflict copy"),
            b"%PDF-1.7 local changes"
        );
    }

    #[test]
    fn checked_save_updates_an_unchanged_session_and_cleans_the_backup() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("document.pdf");
        fs::write(&path, b"%PDF-1.7 original").expect("write original");
        let mut session = DocumentSession {
            path: path.clone(),
            fingerprint: fingerprint(&path).expect("original fingerprint"),
        };

        save_existing_session(&mut session, b"%PDF-1.7 saved changes").expect("save document");

        assert_eq!(
            fs::read(&path).expect("read saved document"),
            b"%PDF-1.7 saved changes"
        );
        assert_eq!(
            session.fingerprint,
            fingerprint(&path).expect("saved fingerprint")
        );
        assert!(
            fs::read_dir(directory.path())
                .expect("list directory")
                .filter_map(Result::ok)
                .all(|entry| !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".luke-pdf-backup-"))
        );
    }

    #[test]
    fn final_verification_preserves_recovery_files_when_target_changes_again() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("document.pdf");
        let backup = directory.path().join("backup.pdf");
        fs::write(&path, b"%PDF-1.7 changed after replace").expect("write changed target");
        fs::write(&backup, b"%PDF-1.7 original").expect("write original backup");

        let result = verify_saved_pdf(&path, b"%PDF-1.7 local changes", &backup, "backup.pdf");

        let conflict_name = match result {
            Err(AppError::SaveVerificationMismatch {
                backup_name,
                conflict_name,
            }) => {
                assert_eq!(backup_name, "backup.pdf");
                conflict_name
            }
            other => panic!("unexpected result: {other:?}"),
        };
        assert_eq!(
            fs::read(&path).expect("read externally changed target"),
            b"%PDF-1.7 changed after replace"
        );
        assert_eq!(
            fs::read(&backup).expect("read original backup"),
            b"%PDF-1.7 original"
        );
        assert_eq!(
            fs::read(directory.path().join(conflict_name)).expect("read local conflict copy"),
            b"%PDF-1.7 local changes"
        );
    }

    #[test]
    fn new_save_target_never_overwrites_a_file_created_after_selection() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("new-document.pdf");
        fs::write(&path, b"%PDF-1.7 created elsewhere").expect("create competing target");

        let result = write_pdf_bytes_new(&path, b"%PDF-1.7 local changes");

        assert!(matches!(result, Err(AppError::SaveTargetChanged)));
        assert_eq!(
            fs::read(&path).expect("read competing target"),
            b"%PDF-1.7 created elsewhere"
        );
    }
}
