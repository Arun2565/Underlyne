async function getStoredDefaults() {
  const result = await chrome.storage.local.get(['defaultHighlightColor', 'defaultUnderlineColor']);
  return {
    highlightColor: result.defaultHighlightColor || 'yellow',
    underlineColor: result.defaultUnderlineColor || 'yellow'
  };
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !(tab.url.includes('substack.com/p/') || tab.url.includes('substack.com/inbox/post/'))) return;

  const defaults = await getStoredDefaults();

  if (command === 'highlight-selection') {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'applyHighlight',
      color: defaults.highlightColor
    });
  } else if (command === 'underline-selection') {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'applyUnderline',
      color: defaults.underlineColor
    });
  } else if (command === 'reload-extension') {
    await chrome.tabs.reload(tab.id);
    chrome.runtime.reload();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getDefaults') {
    getStoredDefaults().then(sendResponse);
    return true;
  }

  if (message.action === 'setDefaults') {
    const updates = {};
    if (message.highlightColor) updates.defaultHighlightColor = message.highlightColor;
    if (message.underlineColor) updates.defaultUnderlineColor = message.underlineColor;
    chrome.storage.local.set(updates).then(() => sendResponse({ ok: true }));
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

  if (message.action === 'updateHighlightNote') {
    updateHighlightNote(message.url, message.id, message.note).then(() => sendResponse({ ok: true }));
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

async function updateHighlightNote(url, id, note) {
  const normalizedUrl = normalizeUrl(url);
  const result = await chrome.storage.local.get(normalizedUrl);
  let highlights = result[normalizedUrl] || [];
  const idx = highlights.findIndex(h => h.id === id);
  if (idx !== -1) {
    highlights[idx] = { ...highlights[idx], note };
    await chrome.storage.local.set({ [normalizedUrl]: highlights });
  }
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