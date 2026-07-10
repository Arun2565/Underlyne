const COLORS = ['yellow', 'green', 'blue', 'red', 'purple'];

let currentUrl = '';

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

    list.appendChild(li);
  }
}
function setupEventListeners() {
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