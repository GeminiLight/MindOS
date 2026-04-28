# How to Publish MindOS Web Clipper to Chrome Web Store

## Prerequisites

- A Google account
- $5 one-time developer registration fee
- The zip file: `packages/browser-extension/mindos-web-clipper.zip`

## Step 1: Register as a Chrome Web Store Developer

1. Go to https://chrome.google.com/webstore/devconsole
2. Sign in with your Google account
3. Pay the $5 one-time registration fee
4. Accept the Developer Agreement

## Step 2: Create a New Item

1. Click **"New Item"** (blue button, top right)
2. Upload `mindos-web-clipper.zip` (30KB)
3. Wait for it to process

## Step 3: Fill in Store Listing

Copy from `store/listing.md`:

| Field | Value |
|-------|-------|
| **Language** | English |
| **Short description** | Save any web page to your MindOS knowledge base — one click, beautifully formatted Markdown. |
| **Detailed description** | _(copy the full description from listing.md)_ |
| **Category** | Productivity |
| **Extension Icon** | Auto-populated from manifest |

## Step 4: Add Screenshots

Chrome Web Store requires 1-5 screenshots (1280x800 or 640x400 pixels).

**Screenshots to take:**

1. **Setup view** — The first-time connection screen
   - Open the extension popup on any page
   - Clear storage to show the setup view
   - Screenshot at 1280x800

2. **Clip view** — The main clipping interface
   - Open on an article page (e.g., a blog post)
   - Show the title, metadata badges, space selector
   - Screenshot at 1280x800

3. **Success view** — After saving
   - Complete a save and capture the success screen
   - Screenshot at 1280x800

4. **Right-click menu** — Context menu integration
   - Right-click on a page showing "Save to MindOS"
   - Screenshot at 1280x800

**Quick screenshot method:**
```bash
# If you have the extension loaded in Chrome:
# 1. Open Chrome DevTools on the popup (right-click popup → Inspect)
# 2. In DevTools, click the device toolbar icon
# 3. Set viewport to 1280x800
# 4. Take screenshot with Cmd+Shift+P → "Capture screenshot"
```

## Step 5: Privacy

| Field | Value |
|-------|-------|
| **Single purpose** | Saves web pages as Markdown to a local MindOS knowledge base |
| **Permission justifications** | _(see table in privacy-policy.md)_ |
| **Privacy policy URL** | Host `store/privacy-policy.md` somewhere public, e.g.: `https://github.com/GeminiLight/MindOS/blob/main/packages/browser-extension/store/privacy-policy.md` |
| **Data usage** | Select: "This extension does NOT collect or transmit user data" |

### Permission Justifications (required for each permission)

When prompted, paste these:

- **storage**: "Stores the user's MindOS server URL and authentication token locally so the extension can connect to their MindOS instance."
- **activeTab**: "Reads the current page content when the user explicitly clicks Save, to extract the article text for conversion to Markdown."
- **scripting**: "Injects the content extraction script into the active tab to parse the page using Mozilla Readability when the user triggers a clip."
- **contextMenus**: "Adds a 'Save to MindOS' option to the browser's right-click context menu for quick access."
- **host_permissions (localhost/LAN IPs)**: "Communicates with the user's local MindOS instance to save clipped content. MindOS runs on localhost or local network — no external servers are contacted."

## Step 6: Submit for Review

1. Click **"Submit for review"**
2. Review typically takes 1-3 business days
3. You'll receive an email when approved (or if changes are needed)

## After Publishing

- **Update**: Rebuild zip → Upload new version in Developer Dashboard → Submit
- **Version bumping**: Update `version` in `src/manifest.json` before each upload
- **Analytics**: Available in the Developer Dashboard (installs, uninstalls, ratings)

## Common Rejection Reasons & Fixes

| Reason | Fix |
|--------|-----|
| "Broad host permissions" | Our permissions are limited to localhost/LAN — explain in privacy justification |
| "Missing privacy policy" | Host `store/privacy-policy.md` on GitHub and link it |
| "Unclear single purpose" | State: "Saves web pages as Markdown to a local MindOS knowledge base" |
| "Missing screenshots" | Add at least 1 screenshot (1280x800) |
