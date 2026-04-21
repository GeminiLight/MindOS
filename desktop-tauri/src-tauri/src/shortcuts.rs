// Global shortcuts module for MindOS Desktop
// Registers system-wide keyboard shortcuts

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// Register global shortcuts
pub fn register_shortcuts(app: &AppHandle) -> Result<(), String> {
    let app_handle = app.clone();

    // Register Cmd/Ctrl + Shift + M to show/hide window
    let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyM);

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;

    println!("[MindOS] Global shortcuts registered: Cmd/Ctrl+Shift+M");
    Ok(())
}

/// Unregister all global shortcuts
pub fn unregister_shortcuts(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {}", e))?;

    println!("[MindOS] Global shortcuts unregistered");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shortcut_creation() {
        let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyM);
        // Just verify it can be created
        assert!(shortcut.mods.is_some());
    }
}
