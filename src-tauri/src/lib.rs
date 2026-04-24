use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

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

fn run_sidecar(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or_else(|| "could not resolve repository root".to_string())?;
    let bundled = manifest_dir
        .join("binaries")
        .join(platform_sidecar_name("d2-sidecar"));

    let mut command = if bundled.exists() {
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![sidecar_call])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
