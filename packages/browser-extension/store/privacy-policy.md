# Privacy Policy — MindOS Web Clipper

**Last updated:** April 2025

## Overview

MindOS Web Clipper is a browser extension that saves web pages to your local MindOS knowledge base. It is designed with privacy as a core principle.

## Data Collection

**We do not collect any data.** Specifically:

- No personal information is collected
- No browsing history is tracked
- No analytics or telemetry is sent
- No cookies are set by the extension
- No data is transmitted to any external server

## Data Storage

The extension stores only two pieces of information locally on your device using Chrome's built-in storage API:

1. **MindOS URL** — The address of your local MindOS instance (e.g., `http://localhost:3456`)
2. **Auth Token** — A token you provide to authenticate with your local MindOS instance

This data never leaves your device and is only used to communicate with your own MindOS instance running on your local network.

## Data Transmission

When you clip a web page, the extension:

1. Reads the content of the current browser tab (only when you explicitly click "Save")
2. Converts the content to Markdown format
3. Sends the Markdown to your local MindOS instance via HTTP

**All communication is between your browser and your own computer.** No data is sent to any third-party server, cloud service, or external API.

## Permissions Explained

| Permission | Why it's needed |
|-----------|----------------|
| `storage` | Save your MindOS URL and auth token locally |
| `activeTab` | Read the current page content when you click "Save" |
| `scripting` | Inject the content extraction script into the current page |
| `contextMenus` | Add "Save to MindOS" to the right-click menu |
| `host_permissions` (localhost/LAN) | Send saved content to your local MindOS instance |

## Third-Party Services

This extension does not use any third-party services, APIs, or analytics tools.

## Open Source

This extension is open source. You can review the complete source code at:
https://github.com/GeminiLight/MindOS/tree/main/packages/browser-extension

## Contact

For questions about this privacy policy, please open an issue at:
https://github.com/GeminiLight/MindOS/issues
