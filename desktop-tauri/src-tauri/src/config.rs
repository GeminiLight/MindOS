// Configuration management module
// Handles reading/writing ~/.mindos/config.json

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub port: u16,
    pub auto_start: bool,
    pub window: WindowConfig,
    pub tray: TrayConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    pub width: u32,
    pub height: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrayConfig {
    pub enabled: bool,
    pub minimize_to_tray: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port: 3456,
            auto_start: true,
            window: WindowConfig {
                width: 1200,
                height: 800,
                x: None,
                y: None,
            },
            tray: TrayConfig {
                enabled: true,
                minimize_to_tray: true,
            },
        }
    }
}

/// Get the config file path (~/.mindos/config.json)
pub fn get_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;
    let mindos_dir = home.join(".mindos");

    // Create directory if it doesn't exist
    if !mindos_dir.exists() {
        fs::create_dir_all(&mindos_dir)
            .map_err(|e| format!("Failed to create .mindos directory: {}", e))?;
    }

    Ok(mindos_dir.join("config.json"))
}

/// Load config from ~/.mindos/config.json
pub fn load_config() -> Result<AppConfig, String> {
    let config_path = get_config_path()?;

    if !config_path.exists() {
        // Return default config if file doesn't exist
        return Ok(AppConfig::default());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;

    Ok(config)
}

/// Save config to ~/.mindos/config.json
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let config_path = get_config_path()?;

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    Ok(())
}

/// Tauri command: Get config
#[tauri::command]
pub fn get_config() -> Result<AppConfig, String> {
    load_config()
}

/// Tauri command: Save config
#[tauri::command]
pub fn set_config(config: AppConfig) -> Result<(), String> {
    save_config(&config)
}
