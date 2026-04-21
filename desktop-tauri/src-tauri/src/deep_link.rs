// Deep link module for handling mindos:// protocol
// Supports opening files and navigating to specific paths

use tauri::{AppHandle, Emitter, Manager};
use url::Url;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeepLinkPayload {
    pub action: String,
    pub path: Option<String>,
    pub query: Option<String>,
}

/// Parse a deep link URL (mindos://action/path?query)
pub fn parse_deep_link(url: &str) -> Result<DeepLinkPayload, String> {
    let parsed = Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;

    if parsed.scheme() != "mindos" {
        return Err(format!("Invalid scheme: {}", parsed.scheme()));
    }

    let action = parsed.host_str().unwrap_or("open").to_string();
    let path = if parsed.path().is_empty() || parsed.path() == "/" {
        None
    } else {
        Some(parsed.path().to_string())
    };
    let query = parsed.query().map(|q| q.to_string());

    Ok(DeepLinkPayload {
        action,
        path,
        query,
    })
}

/// Handle a deep link by emitting an event to the frontend
pub fn handle_deep_link(app: &AppHandle, url: &str) -> Result<(), String> {
    println!("[MindOS] Handling deep link: {}", url);

    let payload = parse_deep_link(url)?;

    // Emit event to frontend
    app.emit("deep-link", payload.clone())
        .map_err(|e| format!("Failed to emit deep-link event: {}", e))?;

    // Show and focus the main window
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_deep_link_simple() {
        let result = parse_deep_link("mindos://open/notes/test.md").unwrap();
        assert_eq!(result.action, "open");
        assert_eq!(result.path, Some("/notes/test.md".to_string()));
        assert_eq!(result.query, None);
    }

    #[test]
    fn test_parse_deep_link_with_query() {
        let result = parse_deep_link("mindos://open/notes/test.md?line=10").unwrap();
        assert_eq!(result.action, "open");
        assert_eq!(result.path, Some("/notes/test.md".to_string()));
        assert_eq!(result.query, Some("line=10".to_string()));
    }

    #[test]
    fn test_parse_deep_link_no_path() {
        let result = parse_deep_link("mindos://open").unwrap();
        assert_eq!(result.action, "open");
        assert_eq!(result.path, None);
    }

    #[test]
    fn test_parse_deep_link_invalid_scheme() {
        let result = parse_deep_link("http://example.com");
        assert!(result.is_err());
    }
}
