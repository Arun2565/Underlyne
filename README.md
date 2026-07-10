# Underlyne

A Chrome extension to highlight and underline text on Substack articles. Highlights persist across page reloads and browser sessions.

## Features

- **Highlight** text with 5 colors (Alt+H)
- **Underline** text with 5 colors (Alt+U)
- Floating toolbar appears on text selection for quick access
- Highlights persist across page reloads and browser restarts
- View, manage, and delete highlights from the popup
- Export/import highlights as JSON
- Works on any Substack article page (`*.substack.com/p/*`)

## Installation (Developer Mode)

1. Clone or download this repo
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle top-right)
4. Click **Load unpacked** and select the `Underlyne` folder
5. The extension is now active. Visit any Substack article and try Alt+H or Alt+U.

## Usage

| Shortcut | Action |
|----------|--------|
| `Alt+H` | Highlight selected text (page-level) |
| `Alt+U` | Underline selected text (page-level) |
| `Ctrl+Shift+H` / `Cmd+Shift+H` | Highlight (extension command) |
| `Ctrl+Shift+U` / `Cmd+Shift+U` | Underline (extension command) |
| `Ctrl+Z` (with cursor in a highlight) | Remove that highlight |
| Toolbar ✕ / sidebar ✕ | Remove a highlight |
| Double-click a restored highlight | Remove it |

Change default colors from the extension popup. Removing a highlight does **not** show a confirmation prompt.

## Project Structure

```
Underlyne/
├── manifest.json         # Extension config (Manifest V3)
├── background.js         # Service worker — storage, message routing
├── content.js            # Injected script — selection, XPath, restoration
├── contentStyles.css     # Highlight/underline styles + floating toolbar
├── popup.html            # Popup interface
├── popup.js              # Popup logic
├── popup.css             # Popup styles
├── icons/                # Extension icons
└── README.md
```

## How It Works

- Uses XPath + text offsets for stable highlight persistence (survives page reloads)
- Highlights stored in `chrome.storage.local`, keyed by normalized URL
- Automatically restores highlights when revisiting an article
- MutationObserver handles Substack's SPA content loading
- Highlights can be removed via `Ctrl+Z`, the toolbar ✕, the sidebar ✕, or double-click (no confirmation prompt)

## Future Ideas

- Cross-device sync via Firebase Firestore
- Support for more sites beyond Substack
- Sticky notes attached to highlights
- Share highlights via link