use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn log_vault_state(state: String) {
    use std::fs::OpenOptions;
    use std::io::Write;
    let log_path = std::path::Path::new("vault_state.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        writeln!(file, "{}", state).ok();
    }
}

/// Returns the last N lines of vault_state.log for the diagnostics page.
/// Reads the same file the frontend writes to via log_vault_state, so the
/// output mirrors the live state of the index pipeline without requiring
/// any extra instrumentation on the JS side.
#[tauri::command]
fn get_vault_state(lines: Option<usize>) -> Result<String, String> {
    let limit = lines.unwrap_or(200);
    let log_path = std::path::Path::new("vault_state.log");
    if !log_path.exists() {
        return Ok(String::new());
    }
    let contents = std::fs::read_to_string(log_path)
        .map_err(|e| format!("Failed to read vault_state.log: {}", e))?;

    // Take the last `limit` lines without loading more than needed.
    let collected: Vec<&str> = contents.lines().rev().take(limit).collect();
    let mut out: Vec<&str> = collected;
    out.reverse();
    Ok(out.join("\n"))
}



/// Saves the Telegram session string to a simple JSON file in the app data directory.
/// This is reliable, fast, and survives dev-server restarts without Stronghold overhead.
#[tauri::command]
fn save_session(app: tauri::AppHandle, session: String, phone: String) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    let json = serde_json::json!({ "session": session, "phone": phone });
    std::fs::write(&session_path, json.to_string())
        .map_err(|e| format!("Failed to write session file: {}", e))
}

/// Loads the Telegram session string from the app data directory.
/// Returns null fields if no session file exists.
#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let session_path = get_session_path(&app)?;
    if !session_path.exists() {
        return Ok(serde_json::json!({ "session": null, "phone": null }));
    }
    let contents = std::fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {}", e))?;
    let parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session file: {}", e))?;
    Ok(parsed)
}

/// Clears the saved session file (used on logout).
#[tauri::command]
fn clear_session(app: tauri::AppHandle) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    if session_path.exists() {
        std::fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to delete session file: {}", e))?;
    }
    Ok(())
}

/// Clears ONLY the session token while preserving the phone number.
/// Used during logout so the phone-keyed channel ID can still be found on next login.
#[tauri::command]
fn clear_session_only(app: tauri::AppHandle) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    if !session_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {}", e))?;
    let mut parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session file: {}", e))?;
    // Null out the session token but keep the phone number
    if let Some(obj) = parsed.as_object_mut() {
        obj.insert("session".to_string(), serde_json::Value::Null);
    }
    std::fs::write(&session_path, parsed.to_string())
        .map_err(|e| format!("Failed to write session file: {}", e))
}

/// Saves a key-value pair to a vault file in the app data directory.
#[tauri::command]
fn save_vault_value(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let vault_path = get_vault_path(&app)?;
    let mut data = if vault_path.exists() {
        let contents = std::fs::read_to_string(&vault_path)
            .map_err(|e| format!("Failed to read vault file: {}", e))?;
        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&contents)
            .unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    
    data.insert(key, serde_json::Value::String(value));
    
    std::fs::write(&vault_path, serde_json::to_string(&data).unwrap())
        .map_err(|e| format!("Failed to write vault file: {}", e))
}

/// Loads a value for a key from the vault file.
#[tauri::command]
fn load_vault_value(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;
    let data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {}", e))?;
    
    if let Some(val) = data.get(&key) {
        if let Some(s) = val.as_str() {
            return Ok(Some(s.to_string()));
        }
    }
    Ok(None)
}

/// Deletes a key-value pair from the vault file.
#[tauri::command]
fn delete_vault_value(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;
    let mut data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {}", e))?;
    
    data.remove(&key);
    
    std::fs::write(&vault_path, serde_json::to_string(&data).unwrap())
        .map_err(|e| format!("Failed to write vault file: {}", e))
}

fn get_vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(data_dir.join("teledrive_vault.json"))
}

fn get_session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(data_dir.join("teledrive_session.json"))
}

// ============================================================================
// Scheduled backup timer (Pro feature)
//
// The desktop owns the actual schedule timer — the backend stores the
// user-configured cadence on the License, but the backend never has the
// Telegram session so it can't run the snapshot. The Rust side is just a
// reliable interval timer that emits a `teledrive://backup-tick` Tauri event
// into the webview; the JS handler in App.tsx does the actual Telegram
// send + audit POST.
//
// Only ONE timer can be active at a time. Calling start_backup_scheduler
// while another timer is running first stops the existing one. This makes
// changing the interval safe and idempotent.
// ============================================================================

static SCHEDULED_BACKUP_HANDLE: OnceLock<AsyncMutex<Option<JoinHandle<()>>>> = OnceLock::new();

fn handle_slot() -> &'static AsyncMutex<Option<JoinHandle<()>>> {
    SCHEDULED_BACKUP_HANDLE.get_or_init(|| AsyncMutex::new(None))
}

/// Start the scheduled backup timer. `interval_minutes` must be > 0.
/// Replaces any existing timer. The first tick fires after `interval_minutes`
/// (no immediate fire on start — that would surprise the user right after
/// they click "Daily").
#[tauri::command]
async fn start_backup_scheduler(app: AppHandle, interval_minutes: u64) -> Result<(), String> {
    if interval_minutes == 0 {
        return Err("interval_minutes must be greater than 0".into());
    }

    // Stop any existing timer first so the interval change is honored.
    stop_backup_scheduler_internal(&app).await;

    let app_handle = app.clone();
    let period = Duration::from_secs(interval_minutes * 60);
    let handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(period);
        // First tick fires immediately by default — skip it so we wait one
        // full period before the first backup, matching user expectations.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(err) = app_handle.emit("teledrive://backup-tick", ()) {
                eprintln!("[backup_scheduler] failed to emit tick: {err}");
                // Don't break the loop on emit error — keep ticking. The JS
                // side just won't hear this one. The next tick is N minutes
                // away, so it's recoverable.
            }
        }
    });

    let mut guard = handle_slot().lock().await;
    *guard = Some(handle);
    log_vault_state(format!(
        "BACKUP_SCHEDULER_START interval_minutes={}",
        interval_minutes
    ));
    Ok(())
}

/// Stop the scheduled backup timer. No-op if no timer is running.
#[tauri::command]
async fn stop_backup_scheduler(app: AppHandle) -> Result<(), String> {
    stop_backup_scheduler_internal(&app).await;
    log_vault_state("BACKUP_SCHEDULER_STOP".to_string());
    Ok(())
}

async fn stop_backup_scheduler_internal(_app: &AppHandle) {
    let mut guard = handle_slot().lock().await;
    if let Some(handle) = guard.take() {
        // tauri::async_runtime::JoinHandle has an inherent .abort() that
        // delegates to the underlying Tokio handle. We always spawn on
        // Tokio (via tauri::async_runtime::spawn), so this is safe.
        handle.abort();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Fixed salt for local vault key derivation
                let salt = b"teledrive-vault-salt-value";
                let params = argon2::Params::new(1024, 2, 1, Some(32)).unwrap();
                let argon2 = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
                let mut output_key = [0u8; 32];
                argon2.hash_password_into(password.as_bytes(), salt, &mut output_key)
                    .expect("stronghold password hashing failed");
                output_key.to_vec()
            })
            .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            log_vault_state,
            get_vault_state,
            save_session,
            load_session,
            clear_session,
            clear_session_only,
            save_vault_value,
            load_vault_value,
            delete_vault_value,
            start_backup_scheduler,
            stop_backup_scheduler,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
