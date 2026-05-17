use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, State};

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

#[tauri::command]
fn sidecar_call(method: String, params: Value) -> Result<Value, String> {
    let request = SidecarRequest { method, params };
    let input = serde_json::to_vec(&request).map_err(|err| err.to_string())?;
    let output = run_sidecar(input)?;
    let response: SidecarResponse =
        serde_json::from_slice(&output).map_err(|err| format!("invalid sidecar response: {err}"))?;

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
fn close_current_window(window: tauri::Window, exit_state: State<ExitState>) -> Result<(), String> {
    *exit_state.allow_exit.lock().map_err(|err| err.to_string())? = true;
    window.close().map_err(|err| err.to_string())
}

#[tauri::command]
fn quit_application(app: tauri::AppHandle, exit_state: State<ExitState>) -> Result<(), String> {
    *exit_state.allow_exit.lock().map_err(|err| err.to_string())? = true;
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

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
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
            MenuBuilder::new(handle)
                .item(&file_menu)
                .item(&edit_menu)
                .build()
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app, event| {
            if event.id() == "open-file" {
                let _ = app.emit_to("main", "d2-desk-open", ());
            } else if event.id() == "save-file" {
                let _ = app.emit_to("main", "d2-desk-save", ());
            } else if event.id() == "close-tab" {
                let _ = app.emit_to("main", "d2-desk-close-tab", ());
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
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
            close_current_window,
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
