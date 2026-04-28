// Runtime management module for Tauri
// Handles Node.js sidecar lifecycle and health checks

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeHealth {
    pub running: bool,
    pub port: u16,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub port: u16,
    pub auto_start: bool,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            port: 3456,
            auto_start: true,
        }
    }
}

// Global runtime state
pub struct RuntimeState {
    pub config: Mutex<RuntimeConfig>,
    pub health: Mutex<RuntimeHealth>,
}

impl RuntimeState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(RuntimeConfig::default()),
            health: Mutex::new(RuntimeHealth {
                running: false,
                port: 3456,
                version: None,
                error: None,
            }),
        }
    }
}

/// Check if runtime is healthy by pinging the health endpoint
pub async fn check_runtime_health(port: u16) -> RuntimeHealth {
    let url = format!("http://localhost:{}/api/health", port);

    match reqwest::get(&url).await {
        Ok(response) => {
            if response.status().is_success() {
                RuntimeHealth {
                    running: true,
                    port,
                    version: None, // TODO: parse from response
                    error: None,
                }
            } else {
                RuntimeHealth {
                    running: false,
                    port,
                    version: None,
                    error: Some(format!("Health check failed: {}", response.status())),
                }
            }
        }
        Err(e) => RuntimeHealth {
            running: false,
            port,
            version: None,
            error: Some(format!("Connection failed: {}", e)),
        },
    }
}

/// Start the MindOS runtime using Tauri sidecar
pub async fn start_runtime(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let config = state.config.lock().unwrap().clone();

    // Use Tauri's sidecar API to start Node.js
    // The sidecar binary should be configured in tauri.conf.json
    let sidecar_command = app
        .shell()
        .sidecar("mindos-runtime")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    // Spawn the sidecar process
    let (_rx, _child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Wait for runtime to be ready (with timeout)
    let max_retries = 30;
    let mut retries = 0;

    while retries < max_retries {
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        let health = check_runtime_health(config.port).await;

        if health.running {
            // Update state
            let mut state_health = state.health.lock().unwrap();
            *state_health = health;
            return Ok(());
        }

        retries += 1;
    }

    Err("Runtime startup timeout".to_string())
}

/// Stop the MindOS runtime
pub async fn stop_runtime(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RuntimeState>();

    // Update state
    let mut health = state.health.lock().unwrap();
    health.running = false;

    // Tauri will automatically kill sidecar processes on app exit
    // For manual stop, we could send a shutdown signal to the runtime

    Ok(())
}

/// Tauri command: Get runtime health
#[tauri::command]
pub async fn get_runtime_health(app: AppHandle) -> Result<RuntimeHealth, String> {
    let state = app.state::<RuntimeState>();
    let config = state.config.lock().unwrap().clone();

    let health = check_runtime_health(config.port).await;

    // Update cached state
    let mut state_health = state.health.lock().unwrap();
    *state_health = health.clone();

    Ok(health)
}

/// Tauri command: Start runtime
#[tauri::command]
pub async fn start_runtime_command(app: AppHandle) -> Result<(), String> {
    start_runtime(app).await
}

/// Tauri command: Stop runtime
#[tauri::command]
pub async fn stop_runtime_command(app: AppHandle) -> Result<(), String> {
    stop_runtime(app).await
}
