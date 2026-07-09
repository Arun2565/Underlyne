# Underlyne

A Chrome extension to highlight and underline text on Substack articles. Highlights persist across page reloads and browser sessions.

## Features

- **Highlight** text with 5 colors (Ctrl+H / Cmd+H)
- **Underline** text with 5 colors (Ctrl+U / Cmd+U)
- Floating toolbar appears on text selection for quick access
- Highlights persist across page reloads and browser restarts
- View, manage, and delete highlights from the popup
- Export/import highlights as JSON
- Works on any Substack article page (`*.substack.com/p/*`)

## Installation (Developer Mode)

1. Clone or download this repo
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle top-right)
4. Click **Load unpacked** and select the `substack-highlighter` folder
5. The extension is now active. Visit any Substack article and try Ctrl+H or Ctrl+U.

## Usage

| Shortcut | Action |
|----------|--------|
| `Ctrl+H` / `Cmd+H` | Highlight selected text |
| `Ctrl+U` / `Cmd+U` | Underline selected text |
| Click on a highlight | Remove it (with confirmation) |

Change default colors from the extension popup.

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
- Highlights are clickable for removal with confirmation

## Future Ideas

- Cross-device sync via Firebase Firestore
- Support for more sites beyond Substack
- Sticky notes attached to highlights
- Share highlights via link