use std::path::PathBuf;
use tauri::Manager;

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

#[tauri::command]
fn delete_file(path: String) -> bool {
    std::fs::remove_file(path).is_ok()
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
            delete_file,
            save_session,
            load_session,
            clear_session,
            save_vault_value,
            load_vault_value,
            delete_vault_value,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
