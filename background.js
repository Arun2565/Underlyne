let defaultHighlightColor = 'yellow';
let defaultUnderlineColor = 'yellow';

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(['defaultHighlightColor', 'defaultUnderlineColor']);
  if (result.defaultHighlightColor) defaultHighlightColor = result.defaultHighlightColor;
  if (result.defaultUnderlineColor) defaultUnderlineColor = result.defaultUnderlineColor;
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('substack.com/p/')) return;

  if (command === 'highlight-selection') {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'applyHighlight',
      color: defaultHighlightColor
    });
  } else if (command === 'underline-selection') {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'applyUnderline',
      color: defaultUnderlineColor
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getDefaults') {
    sendResponse({ highlightColor: defaultHighlightColor, underlineColor: defaultUnderlineColor });
    return true;
  }

  if (message.action === 'setDefaults') {
    if (message.highlightColor) {
      defaultHighlightColor = message.highlightColor;
      chrome.storage.local.set({ defaultHighlightColor });
    }
    if (message.underlineColor) {
      defaultUnderlineColor = message.underlineColor;
      chrome.storage.local.set({ defaultUnderlineColor });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'getHighlights') {
    getHighlightsForUrl(message.url).then(sendResponse);
    return true;
  }

  if (message.action === 'saveHighlight') {
    saveHighlight(message.url, message.highlight).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'deleteHighlight') {
    deleteHighlightById(message.url, message.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'clearAllForUrl') {
    clearAllForUrl(message.url).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function getHighlightsForUrl(url) {
  const normalizedUrl = normalizeUrl(url);
  const result = await chrome.storage.local.get(normalizedUrl);
  return result[normalizedUrl] || [];
}

async function saveHighlight(url, highlight) {
  const normalizedUrl = normalizeUrl(url);
  const result = await chrome.storage.local.get(normalizedUrl);
  const highlights = result[normalizedUrl] || [];
  highlights.push(highlight);
  await chrome.storage.local.set({ [normalizedUrl]: highlights });
}

async function deleteHighlightById(url, id) {
  const normalizedUrl = normalizeUrl(url);
  const result = await chrome.storage.local.get(normalizedUrl);
  let highlights = result[normalizedUrl] || [];
  highlights = highlights.filter(h => h.id !== id);
  await chrome.storage.local.set({ [normalizedUrl]: highlights });
}

async function clearAllForUrl(url) {
  const normalizedUrl = normalizeUrl(url);
  await chrome.storage.local.remove(normalizedUrl);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}