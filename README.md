# Underlyne

Underlyne is a lightweight, local-first Chrome extension for reading Substack more deliberately. Select text in an article to highlight or underline it, then revisit, navigate, and export your saved annotations from a clean in-page sidebar.

Your annotations stay in the browser unless you choose to export them.

## What it does

- Highlight or underline text in yellow, green, blue, red, or purple.
- Use the floating toolbar or keyboard shortcuts while reading.
- Restore annotations after a page reload or browser restart.
- Open the Underlyne sidebar to see annotations in article order.
- Click an annotation in the sidebar to jump to its text in the article.
- Remove annotations from the article, toolbar, sidebar, or keyboard.
- Export the current article's annotations as a Markdown file named after the article.
- Keep one annotation per selected text and annotation type; choosing a new colour updates the previous one instead of creating a duplicate.

## Install locally

Underlyne is currently intended for local/developer installation.

1. Download or clone this repository.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the `Underlyne` project folder.
6. Open a supported Substack article and select some text.

After changing the extension files, select the reload button for Underlyne on the extensions page, then refresh the article.

## How to use it

1. Select text in a Substack article.
2. Choose a highlight or underline colour in the floating toolbar, or use a shortcut.
3. Select the toolbar's list icon to open the annotation sidebar.
4. Click a sidebar annotation to return to its location in the article.
5. Select the sidebar's download icon to export a `.md` file.

| Shortcut | Action |
| --- | --- |
| `Alt+H` | Highlight the current selection using the default colour |
| `Alt+U` | Underline the current selection using the default colour |
| `Ctrl+Shift+H` / `Cmd+Shift+H` | Highlight through the browser extension command |
| `Ctrl+Shift+U` / `Cmd+Shift+U` | Underline through the browser extension command |
| `Ctrl+Z` / `Cmd+Z` | Remove the annotation at the current selection |

Deletion is immediate; there is no confirmation prompt.

## Where it works

Underlyne runs on web pages hosted at `https://*.substack.com/*` and is designed for published Substack article pages, including standard `/p/` article URLs and inbox-post views.

It does not currently support Substack publications served from custom domains, non-article Substack pages, or the native Substack mobile app.

## Privacy and storage

- Annotation data is saved in `chrome.storage.local` on the current browser profile.
- Data is keyed to the article URL without query parameters or fragments.
- No account, cloud sync, analytics, or external server is used.
- Markdown export is generated locally in the browser.

## Project structure

```text
Underlyne/
├── manifest.json         # Manifest V3 configuration and permissions
├── background.js         # Keyboard commands and storage message routing
├── content.js            # Selection, persistence, restoration, toolbar, and sidebar
├── contentStyles.css     # In-page annotation, toolbar, and sidebar styles
├── icons/                # Extension icons
└── README.md
```

## How persistence works

When you create an annotation, Underlyne stores the selected text, its type and colour, plus its location in the article. On a return visit it attempts to restore that location; if the page structure has changed, it also tries to locate the saved text in the article.

If an author substantially edits or removes the selected passage, restoration may not be possible. In that case, Underlyne does not show the stale annotation in the sidebar as a clickable item.

## Roadmap

- Optional cross-device sync
- Support for custom-domain Substack publications and additional reading sites
- Search, tags, and topic collections
- An LLM-powered, source-linked personal wiki built from annotations
