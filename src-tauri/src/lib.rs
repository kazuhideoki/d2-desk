use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

struct ExitState {
    allow_exit: Mutex<bool>,
}

#[derive(Debug, Deserialize)]
struct SidecarResponse {
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct SidecarRequest {
    method: String,
    params: Value,
}

#[derive(Debug, Serialize)]
struct OpenedD2File {
    path: String,
    contents: String,
}

#[derive(Debug, Serialize)]
struct SavedD2File {
    path: String,
}

#[derive(Debug, Serialize)]
struct RenamedD2File {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileEntry {
    path: String,
    relative_path: String,
    file_name: String,
    directory: String,
}

#[tauri::command]
fn sidecar_call(method: String, params: Value) -> Result<Value, String> {
    let request = SidecarRequest { method, params };
    let input = serde_json::to_vec(&request).map_err(|err| err.to_string())?;
    let output = run_sidecar(input)?;
    let response: SidecarResponse = serde_json::from_slice(&output)
        .map_err(|err| format!("invalid sidecar response: {err}"))?;

    if let Some(error) = response.error {
        Err(error)
    } else {
        Ok(response.result.unwrap_or(Value::Null))
    }
}

#[tauri::command]
fn read_d2_file(path: String) -> Result<OpenedD2File, String> {
    let path = PathBuf::from(path);
    let contents = fs::read_to_string(&path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;

    Ok(OpenedD2File {
        path: path_to_string(path),
        contents,
    })
}

#[tauri::command]
fn write_d2_file(path: String, contents: String) -> Result<SavedD2File, String> {
    let path = ensure_d2_extension(PathBuf::from(path));
    fs::write(&path, contents)
        .map_err(|err| format!("failed to write {}: {err}", path.display()))?;

    Ok(SavedD2File {
        path: path_to_string(path),
    })
}

#[tauri::command]
fn rename_d2_file(path: String, file_name: String) -> Result<RenamedD2File, String> {
    let source_path = PathBuf::from(path);
    if !source_path.exists() {
        return Err(format!("file does not exist: {}", source_path.display()));
    }
    if !source_path.is_file() {
        return Err(format!("path is not a file: {}", source_path.display()));
    }

    let target_path = renamed_file_path(&source_path, &file_name)?;
    if target_path == source_path {
        return Ok(RenamedD2File {
            path: path_to_string(target_path),
        });
    }
    if target_path.exists() {
        return Err(format!("file already exists: {}", target_path.display()));
    }

    fs::rename(&source_path, &target_path).map_err(|err| {
        format!(
            "failed to rename {} to {}: {err}",
            source_path.display(),
            target_path.display()
        )
    })?;

    Ok(RenamedD2File {
        path: path_to_string(target_path),
    })
}

#[tauri::command]
fn open_file_with_editor(path: String) -> Result<(), String> {
    let editor = std::env::var("EDITOR").map_err(|_| "$EDITOR is not set".to_string())?;
    if editor.trim().is_empty() {
        return Err("$EDITOR is empty".to_string());
    }

    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(format!("file does not exist: {}", path.display()));
    }

    Command::new("sh")
        .arg("-lc")
        .arg("exec ${EDITOR:?} \"$1\"")
        .arg("d2-desk-editor")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("failed to open $EDITOR: {err}"))?;

    Ok(())
}

#[tauri::command]
fn list_workspace_files(root_path: String) -> Result<Vec<WorkspaceFileEntry>, String> {
    let root = PathBuf::from(root_path);
    let root = root
        .canonicalize()
        .map_err(|err| format!("failed to open workspace folder {}: {err}", root.display()))?;
    if !root.is_dir() {
        return Err(format!("workspace is not a folder: {}", root.display()));
    }

    let mut files = Vec::new();
    let mut pending = vec![root.clone()];

    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(&directory)
            .map_err(|err| format!("failed to read {}: {err}", directory.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("failed to read {}: {err}", directory.display()))?;
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            let file_type = entry
                .file_type()
                .map_err(|err| format!("failed to inspect {}: {err}", entry.path().display()))?;
            if file_type.is_symlink() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            if file_type.is_dir() {
                if should_skip_workspace_directory(&name) {
                    continue;
                }
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let path = entry.path();
            if !is_d2_file(&path) {
                continue;
            }

            let relative_path = path
                .strip_prefix(&root)
                .map(relative_path_to_string)
                .unwrap_or_else(|_| path_to_string(path.clone()));
            let directory = Path::new(&relative_path)
                .parent()
                .map(relative_path_to_string)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| ".".to_string());

            files.push(WorkspaceFileEntry {
                path: path_to_string(path),
                relative_path,
                file_name: name,
                directory,
            });
            if files.len() >= 5000 {
                files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
                return Ok(files);
            }
        }
    }

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

#[tauri::command]
fn close_current_window(window: tauri::Window, exit_state: State<ExitState>) -> Result<(), String> {
    *exit_state
        .allow_exit
        .lock()
        .map_err(|err| err.to_string())? = true;
    window.close().map_err(|err| err.to_string())
}

#[tauri::command]
fn open_preview_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("preview") {
        window.set_focus().map_err(|err| err.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "preview", WebviewUrl::App("index.html".into()))
        .title("D2 Desk Preview")
        .inner_size(960.0, 720.0)
        .min_inner_size(480.0, 360.0)
        .build()
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
fn close_preview_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("preview") {
        window.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn close_focused_preview_window(app: &tauri::AppHandle) -> bool {
    let Some(window) = app.get_webview_window("preview") else {
        return false;
    };
    if window.is_focused().unwrap_or(false) {
        let _ = window.close();
        return true;
    }
    false
}

#[tauri::command]
fn quit_application(app: tauri::AppHandle, exit_state: State<ExitState>) -> Result<(), String> {
    *exit_state
        .allow_exit
        .lock()
        .map_err(|err| err.to_string())? = true;
    app.exit(0);
    Ok(())
}

fn ensure_d2_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some() {
        path
    } else {
        path.with_extension("d2")
    }
}

fn renamed_file_path(source_path: &Path, file_name: &str) -> Result<PathBuf, String> {
    let trimmed_name = file_name.trim();
    if trimmed_name.is_empty() {
        return Err("file name cannot be empty".to_string());
    }

    let requested_path = Path::new(trimmed_name);
    let components = requested_path.components().collect::<Vec<_>>();
    if components.len() != 1 || !matches!(components[0], Component::Normal(_)) {
        return Err("use a file name, not a path".to_string());
    }

    let parent = source_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent folder for {}",
            source_path.display()
        )
    })?;
    Ok(parent.join(ensure_d2_extension(PathBuf::from(trimmed_name))))
}

fn is_d2_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("d2"))
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn relative_path_to_string(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn should_skip_workspace_directory(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".next"
            | ".tmp"
            | ".turbo"
            | ".vite"
            | "build"
            | "coverage"
            | "dist"
            | "node_modules"
            | "target"
    )
}

fn run_sidecar(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or_else(|| "could not resolve repository root".to_string())?;

    let bundled = sidecar_binary_path(&manifest_dir);
    let mut command = if let Some(bundled) = bundled {
        Command::new(bundled)
    } else {
        let mut command = Command::new("go");
        command
            .arg("run")
            .arg("./sidecar")
            .env("GOPATH", "/tmp/d2-desk-go")
            .env("GOMODCACHE", "/tmp/d2-desk-go/pkg/mod")
            .env("GOCACHE", "/tmp/d2-desk-go/build-cache")
            .current_dir(repo_root);
        command
    };

    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start sidecar: {err}"))?;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| "failed to open sidecar stdin".to_string())?;
    stdin
        .write_all(&input)
        .map_err(|err| format!("failed to write sidecar request: {err}"))?;
    drop(child.stdin.take());

    let output = child
        .wait_with_output()
        .map_err(|err| format!("failed to read sidecar output: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "sidecar exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(output.stdout)
}

fn sidecar_binary_path(manifest_dir: &PathBuf) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("D2_DESK_SIDECAR_PATH") {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(runtime_sidecar_name("d2-sidecar")));
            candidates.push(exe_dir.join(platform_sidecar_name("d2-sidecar")));
        }
    }

    candidates.push(
        manifest_dir
            .join("binaries")
            .join(platform_sidecar_name("d2-sidecar")),
    );

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn runtime_sidecar_name(base: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn platform_sidecar_name(base: &str) -> String {
    let target = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "x86_64") {
        "x86_64-apple-darwin"
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc.exe"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    };
    format!("{base}-{target}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ExitState {
            allow_exit: Mutex::new(false),
        })
        .menu(|handle| {
            let open = MenuItemBuilder::with_id("open-file", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(handle)?;
            let open_workspace_file =
                MenuItemBuilder::with_id("open-workspace-file", "Open Workspace File...")
                    .accelerator("Command+P")
                    .build(handle)?;
            let open_symbols = MenuItemBuilder::with_id("open-symbols", "Go to Symbol in File...")
                .accelerator("Command+Shift+O")
                .build(handle)?;
            let open_command_palette =
                MenuItemBuilder::with_id("open-command-palette", "Command Palette...")
                    .accelerator("Command+Shift+P")
                    .build(handle)?;
            let toggle_preview_fullscreen =
                MenuItemBuilder::with_id("toggle-preview-fullscreen", "Toggle Preview Fullscreen")
                    .accelerator("Command+Alt+P")
                    .build(handle)?;
            let toggle_detached_preview =
                MenuItemBuilder::with_id("toggle-detached-preview", "Detach Preview to Window")
                    .accelerator("Command+Alt+Shift+P")
                    .build(handle)?;
            let toggle_bottom_panel =
                MenuItemBuilder::with_id("toggle-bottom-panel", "Toggle Bottom Panel")
                    .accelerator("CmdOrCtrl+J")
                    .build(handle)?;
            let save = MenuItemBuilder::with_id("save-file", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(handle)?;
            let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
                .build(handle)?;
            let undo = PredefinedMenuItem::undo(handle, None)?;
            let redo = PredefinedMenuItem::redo(handle, None)?;
            let cut = PredefinedMenuItem::cut(handle, None)?;
            let copy = PredefinedMenuItem::copy(handle, None)?;
            let paste = PredefinedMenuItem::paste(handle, None)?;
            let select_all = PredefinedMenuItem::select_all(handle, None)?;
            let separator = PredefinedMenuItem::separator(handle)?;
            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&open)
                .item(&open_workspace_file)
                .item(&open_symbols)
                .item(&open_command_palette)
                .item(&save)
                .separator()
                .item(&close_tab)
                .build()?;
            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .item(&undo)
                .item(&redo)
                .item(&separator)
                .item(&cut)
                .item(&copy)
                .item(&paste)
                .item(&select_all)
                .build()?;
            let view_menu = SubmenuBuilder::new(handle, "View")
                .item(&toggle_preview_fullscreen)
                .item(&toggle_detached_preview)
                .item(&toggle_bottom_panel)
                .build()?;
            MenuBuilder::new(handle)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .build()
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app, event| {
            if event.id() == "open-file" {
                let _ = app.emit_to("main", "d2-desk-open", ());
            } else if event.id() == "open-workspace-file" {
                let _ = app.emit_to("main", "d2-desk-open-workspace-file", ());
            } else if event.id() == "open-symbols" {
                let _ = app.emit_to("main", "d2-desk-open-symbols", ());
            } else if event.id() == "open-command-palette" {
                let _ = app.emit_to("main", "d2-desk-open-command-palette", ());
            } else if event.id() == "toggle-preview-fullscreen" {
                let _ = app.emit_to("main", "d2-desk-toggle-preview-fullscreen", ());
            } else if event.id() == "toggle-detached-preview" {
                let _ = app.emit_to("main", "d2-desk-toggle-detached-preview", ());
            } else if event.id() == "toggle-bottom-panel" {
                let _ = app.emit_to("main", "d2-desk-toggle-bottom-panel", ());
            } else if event.id() == "save-file" {
                let _ = app.emit_to("main", "d2-desk-save", ());
            } else if event.id() == "close-tab" {
                if !close_focused_preview_window(app) {
                    let _ = app.emit_to("main", "d2-desk-close-tab", ());
                }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "preview" {
                    let app = window.app_handle();
                    let _ = app.emit_to("main", "d2-desk-preview-window-closed", ());
                    return;
                }

                let app = window.app_handle();
                let exit_state = app.state::<ExitState>();
                let allow_exit = exit_state
                    .allow_exit
                    .lock()
                    .map(|allow_exit| *allow_exit)
                    .unwrap_or(false);
                if !allow_exit {
                    api.prevent_close();
                    let _ = window.emit("d2-desk-request-quit", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            sidecar_call,
            read_d2_file,
            write_d2_file,
            rename_d2_file,
            list_workspace_files,
            open_file_with_editor,
            close_current_window,
            open_preview_window,
            close_preview_window,
            quit_application
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let exit_state = app.state::<ExitState>();
                let allow_exit = exit_state
                    .allow_exit
                    .lock()
                    .map(|allow_exit| *allow_exit)
                    .unwrap_or(false);
                if !allow_exit {
                    api.prevent_exit();
                    let _ = app.emit_to("main", "d2-desk-request-quit", ());
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn list_workspace_files_returns_only_d2_files() {
        let workspace = temp_workspace("d2-only");
        let nested = workspace.join("nested");
        fs::create_dir(&nested).expect("create nested directory");
        fs::write(workspace.join("diagram.d2"), "root").expect("write d2 file");
        fs::write(workspace.join("notes.txt"), "notes").expect("write text file");
        fs::write(nested.join("component.D2"), "nested").expect("write uppercase d2 file");
        fs::write(nested.join("script.ts"), "script").expect("write ts file");

        let files = list_workspace_files(path_to_string(workspace.clone())).expect("list files");
        let relative_paths = files
            .into_iter()
            .map(|file| file.relative_path)
            .collect::<Vec<_>>();

        assert_eq!(relative_paths, vec!["diagram.d2", "nested/component.D2"]);

        fs::remove_dir_all(workspace).expect("remove temp workspace");
    }

    #[test]
    fn is_d2_file_matches_d2_extension_case_insensitively() {
        assert!(is_d2_file(Path::new("diagram.d2")));
        assert!(is_d2_file(Path::new("diagram.D2")));
        assert!(!is_d2_file(Path::new("diagram.txt")));
        assert!(!is_d2_file(Path::new("diagram")));
    }

    #[test]
    fn renamed_file_path_stays_in_source_directory() {
        let source = Path::new("/workspace/current.d2");

        assert_eq!(
            renamed_file_path(source, "next").expect("build renamed path"),
            PathBuf::from("/workspace/next.d2")
        );
        assert_eq!(
            renamed_file_path(source, "next.d2").expect("build renamed path"),
            PathBuf::from("/workspace/next.d2")
        );
    }

    #[test]
    fn renamed_file_path_rejects_empty_names_and_paths() {
        let source = Path::new("/workspace/current.d2");

        assert!(renamed_file_path(source, "").is_err());
        assert!(renamed_file_path(source, "nested/next.d2").is_err());
        assert!(renamed_file_path(source, "../next.d2").is_err());
    }

    fn temp_workspace(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("d2-desk-{name}-{unique}"));
        fs::create_dir(&path).expect("create temp workspace");
        path
    }
}
