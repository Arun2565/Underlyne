const COLORS = ['yellow', 'green', 'blue', 'red', 'purple'];

let currentUrl = '';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !(tab.url.includes('substack.com/p/') || tab.url.includes('substack.com/inbox/post/'))) {
    document.getElementById('highlights-section').innerHTML =
      '<p style="text-align:center;padding:20px;color:#aaa">Open a Substack article to see highlights.</p>';
    return;
  }

  currentUrl = tab.url;
  await loadDefaults();
  await renderHighlights();
  setupEventListeners();
});

async function loadDefaults() {
  const result = await chrome.runtime.sendMessage({ action: 'getDefaults' });
  if (!result) return;

  renderColorOptions('hl-colors', result.highlightColor || 'yellow', 'highlight');
  renderColorOptions('ul-colors', result.underlineColor || 'yellow', 'underline');
}

function renderColorOptions(containerId, activeColor, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (const color of COLORS) {
    const swatch = document.createElement('div');
    swatch.className = `color-swatch swatch-${color}`;
    if (color === activeColor) swatch.classList.add('active');
    swatch.dataset.color = color;
    swatch.addEventListener('click', async () => {
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      const payload = {};
      if (type === 'highlight') payload.highlightColor = color;
      else payload.underlineColor = color;
      await chrome.runtime.sendMessage({ action: 'setDefaults', ...payload });
    });
    container.appendChild(swatch);
  }
}

async function renderHighlights() {
  const result = await chrome.runtime.sendMessage({
    action: 'getHighlights',
    url: currentUrl
  });
  const highlights = result || [];
  const list = document.getElementById('highlights-list');
  const emptyState = document.getElementById('empty-state');
  const countEl = document.getElementById('count');

  countEl.textContent = highlights.length;
  list.innerHTML = '';
  emptyState.style.display = highlights.length === 0 ? 'block' : 'none';

  for (const hl of highlights) {
    const li = document.createElement('li');
    li.className = 'highlight-item';

    const swatch = document.createElement('div');
    swatch.className = `hl-swatch ${hl.type || 'highlight'} swatch-${hl.color || 'yellow'}`;
    li.appendChild(swatch);

    const typeLabel = document.createElement('span');
    typeLabel.className = 'hl-type';
    typeLabel.textContent = hl.type === 'underline' ? 'U' : 'H';
    li.appendChild(typeLabel);

    const text = document.createElement('span');
    text.className = 'hl-text';
    text.textContent = hl.text || '(empty)';
    li.appendChild(text);

    const delBtn = document.createElement('button');
    delBtn.className = 'hl-delete';
    delBtn.textContent = '\u00d7';
    delBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        action: 'deleteHighlight',
        url: currentUrl,
        id: hl.id
      });
      li.remove();
      const remaining = list.querySelectorAll('.highlight-item').length;
      document.getElementById('count').textContent = remaining;
      document.getElementById('empty-state').style.display = remaining === 0 ? 'block' : 'none';
    });
    li.appendChild(delBtn);

    const noteInput = document.createElement('textarea');
    noteInput.className = 'hl-note-input';
    noteInput.rows = 1;
    noteInput.placeholder = 'Add note...';
    noteInput.value = hl.note || '';
    let noteTimeout;
    noteInput.addEventListener('input', () => {
      clearTimeout(noteTimeout);
      noteTimeout = setTimeout(async () => {
        await chrome.runtime.sendMessage({
          action: 'updateHighlightNote',
          url: currentUrl,
          id: hl.id,
          note: noteInput.value
        });
      }, 400);
    });
    li.appendChild(noteInput);

    list.appendChild(li);
  }
}
function setupEventListeners() {
  document.getElementById('btn-html-preview').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { action: 'getAnnotationsWithContext' });
      if (!result || !result.annotations || result.annotations.length === 0) {
        alert('No annotations found on this page.');
        return;
      }
      const colorNames = { yellow: '#FDD835', green: '#43A047', blue: '#1E88E5', red: '#E53935', purple: '#8E24AA' };
      const typeLabels = { highlight: 'Highlight', underline: 'Underline' };
      const rows = result.annotations.map(a => `
        <div class="entry">
          <div class="bar" style="background:${colorNames[a.color] || '#FDD835'}"></div>
          <div class="body">
            <div class="meta">${typeLabels[a.type] || a.type} &middot; ${a.color.charAt(0).toUpperCase() + a.color.slice(1)}</div>
            <div class="text ${a.type} ${a.type === 'underline' ? 'ul-' + a.color : a.color}">${escapeHtml(a.text)}</div>
            <div class="context">${escapeHtml(a.contextBefore)} <mark>${escapeHtml(a.text)}</mark> ${escapeHtml(a.contextAfter)}</div>
          </div>
        </div>
      `).join('');
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Underlyne Annotations</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; color: #1a1a1a; padding: 32px; max-width: 800px; margin: 0 auto; }
h1 { font-size: 22px; margin-bottom: 4px; }
.source { font-size: 13px; color: #666; margin-bottom: 24px; word-break: break-all; }
.header { margin-bottom: 32px; }
.entry { display: flex; gap: 12px; margin-bottom: 20px; padding: 12px; background: #fff; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.bar { width: 4px; flex-shrink: 0; border-radius: 2px; }
.body { flex: 1; min-width: 0; }
.meta { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
.text { font-size: 15px; line-height: 1.6; margin-bottom: 6px; }
.text.highlight { padding: 1px 2px; border-radius: 2px; }
.text.underline { text-decoration: none !important; }
.text.yellow { background: #FDD835; }
.text.green { background: #43A047; }
.text.blue { background: #1E88E5; }
.text.red { background: #E53935; }
.text.purple { background: #8E24AA; }
.text.ul-yellow { background-image: linear-gradient(to bottom, transparent 90%, #FDD835 90%); }
.text.ul-green { background-image: linear-gradient(to bottom, transparent 90%, #43A047 90%); }
.text.ul-blue { background-image: linear-gradient(to bottom, transparent 90%, #1E88E5 90%); }
.text.ul-red { background-image: linear-gradient(to bottom, transparent 90%, #E53935 90%); }
.text.ul-purple { background-image: linear-gradient(to bottom, transparent 90%, #8E24AA 90%); }
.context { font-size: 13px; color: #666; line-height: 1.5; }
.context mark { background: #fff3cd; padding: 0 2px; border-radius: 1px; color: #333; }
.footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #999; text-align: center; }
</style>
</head>
<body>
<div class="header">
  <h1>Underlyne &ndash; Annotations</h1>
  <div class="source">${escapeHtml(result.articleTitle)}<br>${escapeHtml(result.url)}</div>
</div>
${rows}
<div class="footer">Exported on ${new Date().toLocaleString()} &middot; ${result.annotations.length} annotation${result.annotations.length !== 1 ? 's' : ''}</div>
</body>
</html>`;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'underlyne-annotations-' + Date.now() + '.html';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Could not get annotations. Reload the page and try again.');
    }
  });

  document.getElementById('btn-notes').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({
      action: 'getHighlights',
      url: currentUrl
    });
    const highlights = result || [];
    if (highlights.length === 0) {
      alert('No annotations on this page.');
      return;
    }
    const colorNames = { yellow: '#FDD835', green: '#43A047', blue: '#1E88E5', red: '#E53935', purple: '#8E24AA' };
    const typeLabels = { highlight: 'Highlight', underline: 'Underline' };
    const rows = highlights.map(h => {
      const noteHtml = h.note ? `<div class="note">${escapeHtml(h.note)}</div>` : '';
      return `<div class="entry">
        <div class="bar" style="background:${colorNames[h.color] || '#FDD835'}"></div>
        <div class="body">
          <div class="meta">${typeLabels[h.type] || h.type} &middot; ${h.color.charAt(0).toUpperCase() + h.color.slice(1)}</div>
          <div class="text ${h.type} ${h.type === 'underline' ? 'ul-' + h.color : h.color}">${escapeHtml(h.text)}</div>
          ${noteHtml}
        </div>
      </div>`;
    }).join('');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Underlyne Notes</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; color: #1a1a1a; padding: 32px; max-width: 800px; margin: 0 auto; }
h1 { font-size: 22px; margin-bottom: 4px; }
.source { font-size: 13px; color: #666; margin-bottom: 24px; word-break: break-all; }
.header { margin-bottom: 32px; }
.entry { display: flex; gap: 12px; margin-bottom: 20px; padding: 12px; background: #fff; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.bar { width: 4px; flex-shrink: 0; border-radius: 2px; }
.body { flex: 1; min-width: 0; }
.meta { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
.text { font-size: 15px; line-height: 1.6; margin-bottom: 6px; }
.text.highlight { padding: 1px 2px; border-radius: 2px; }
.text.underline { text-decoration: none !important; }
.text.yellow { background: #FDD835; }
.text.green { background: #43A047; }
.text.blue { background: #1E88E5; }
.text.red { background: #E53935; }
.text.purple { background: #8E24AA; }
.text.ul-yellow { background-image: linear-gradient(to bottom, transparent 90%, #FDD835 90%); }
.text.ul-green { background-image: linear-gradient(to bottom, transparent 90%, #43A047 90%); }
.text.ul-blue { background-image: linear-gradient(to bottom, transparent 90%, #1E88E5 90%); }
.text.ul-red { background-image: linear-gradient(to bottom, transparent 90%, #E53935 90%); }
.text.ul-purple { background-image: linear-gradient(to bottom, transparent 90%, #8E24AA 90%); }
.note { font-size: 13px; color: #555; line-height: 1.5; padding: 8px 10px; background: #f0f4ff; border-radius: 4px; border-left: 3px solid #1a1a2e; margin-top: 6px; }
.footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #999; text-align: center; }
</style>
</head>
<body>
<div class="header">
  <h1>Underlyne &ndash; Notes</h1>
  <div class="source">${escapeHtml(tab.title)}<br>${escapeHtml(currentUrl)}</div>
</div>
${rows}
<div class="footer">Exported on ${new Date().toLocaleString()} &middot; ${highlights.length} annotation${highlights.length !== 1 ? 's' : ''}</div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    chrome.tabs.create({ url });
  });

  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (!confirm('Clear all highlights and underlines for this page?')) return;
    await chrome.runtime.sendMessage({
      action: 'clearAllForUrl',
      url: currentUrl
    });
    renderHighlights();
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({
      action: 'getHighlights',
      url: currentUrl
    });
    const json = JSON.stringify(result || [], null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = 'substack-highlights-' + Date.now() + '.json';
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });

  const importArea = document.getElementById('import-input');
  document.getElementById('btn-import').addEventListener('click', () => {
    importArea.style.display = importArea.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('btn-do-import').addEventListener('click', async () => {
    const textarea = document.getElementById('import-textarea');
    try {
      const data = JSON.parse(textarea.value);
      if (!Array.isArray(data)) throw new Error('Not an array');
      for (const item of data) {
        if (item.id && item.text) {
          await chrome.runtime.sendMessage({
            action: 'saveHighlight',
            url: currentUrl,
            highlight: { ...item, url: currentUrl }
          });
        }
      }
      textarea.value = '';
      importArea.style.display = 'none';
      renderHighlights();
    } catch (e) {
      alert('Invalid JSON. Please paste a valid highlights export.');
    }
  });
}