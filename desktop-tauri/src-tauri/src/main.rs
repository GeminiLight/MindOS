// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod deep_link;
mod runtime;
mod shortcuts;
mod updater;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// Toggle window visibility
#[tauri::command]
fn toggle_window(window: tauri::Window) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Get application version
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(runtime::RuntimeState::new())
        .invoke_handler(tauri::generate_handler![
            toggle_window,
            get_app_version,
            runtime::get_runtime_health,
            runtime::start_runtime_command,
            runtime::stop_runtime_command,
            config::get_config,
            config::set_config,
            updater::check_updates_command,
            updater::install_update_command,
        ])
        .setup(|app| {
            // Register deep link handler
            let app_handle = app.handle().clone();
            tauri_plugin_deep_link::register("mindos", move |request| {
                let url = request.to_string();
                if let Err(e) = deep_link::handle_deep_link(&app_handle, &url) {
                    eprintln!("[MindOS] Failed to handle deep link: {}", e);
                }
            })
            .map_err(|e| format!("Failed to register deep link: {}", e))?;

            let window = app
                .get_webview_window("main")
                .expect("Failed to get main window - this should never happen");

            // Load config
            let app_config = config::load_config().unwrap_or_default();

            // Apply window config
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: app_config.window.width,
                height: app_config.window.height,
            }));

            if let (Some(x), Some(y)) = (app_config.window.x, app_config.window.y) {
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x,
                    y,
                }));
            }

            // Create tray menu
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Show/Hide", true, None::<&str>)?;
            let health_item =
                MenuItem::with_id(app, "health", "Runtime Status", true, None::<&str>)?;
            let update_item =
                MenuItem::with_id(app, "update", "Check for Updates", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &health_item, &update_item, &quit_item])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .expect("Failed to load window icon - check icons/ directory")
                        .clone(),
                )
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => {
                        // Stop runtime before exit
                        let app_handle = app.clone();
                        tauri::async_runtime::block_on(async move {
                            let _ = runtime::stop_runtime(app_handle).await;
                        });
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "health" => {
                        // Check runtime health
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            match runtime::get_runtime_health(app_handle).await {
                                Ok(health) => {
                                    let status = if health.running {
                                        format!("Runtime is running on port {}", health.port)
                                    } else {
                                        format!("Runtime is not running: {:?}", health.error)
                                    };
                                    println!("[MindOS] {}", status);
                                }
                                Err(e) => {
                                    println!("[MindOS] Failed to check health: {}", e);
                                }
                            }
                        });
                    }
                    "update" => {
                        // Check for updates
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            match updater::check_for_updates(app_handle).await {
                                Ok(status) => {
                                    if status.available {
                                        println!("[MindOS] Update available: {:?}", status.version);
                                    } else {
                                        println!("[MindOS] No updates available");
                                    }
                                }
                                Err(e) => {
                                    println!("[MindOS] Failed to check updates: {}", e);
                                }
                            }
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Handle window close event - minimize to tray instead of quit
            window.on_window_event(|event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Prevent default close behavior
                    api.prevent_close();
                    // Hide window instead
                    let window = event.window();
                    let _ = window.hide();
                }
            });

            // Auto-start runtime if configured
            if app_config.auto_start {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match runtime::start_runtime(app_handle).await {
                        Ok(_) => println!("[MindOS] Runtime started successfully"),
                        Err(e) => eprintln!("[MindOS] Failed to start runtime: {}", e),
                    }
                });
            }

            // Check for updates on startup (non-blocking)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = updater::check_for_updates(app_handle).await;
            });

            // Register global shortcuts
            if let Err(e) = shortcuts::register_shortcuts(app) {
                eprintln!("[MindOS] Failed to register shortcuts: {}", e);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
