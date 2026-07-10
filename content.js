(() => {
  console.log('[Underlyne] Content script loaded');
  const COLORS = ['yellow', 'green', 'blue', 'red', 'purple'];

  let contextValid = true;
  function guard() {
    if (!contextValid) throw new Error('Extension context invalidated');
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      contextValid = false;
      throw new Error('Extension context invalidated');
    }
  }

  function getHighlightClasses(color) {
    return `sh-highlight sh-${color}`;
  }

  function getUnderlineClass(color) {
    return `sh-underline sh-underline-${color}`;
  }

  function generateId() {
    return 'sh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  }

  function getArticleContainer() {
    const selectors = [
      'article[data-testid="main-content"] .body.markup',
      'div[class*="container"] div[class*="body"]',
      'div.available-content',
      'div.post-content',
      'div[class*="post-body"]',
      'div.body',
      'article div.markup',
      'article',
      'main',
      'div[class*="post"]',
      'div.main-content',
      'section.post',
      'div.prose'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 50) return el;
    }
    // fallback: find the element with the most text content (exclude body/html)
    const candidates = document.querySelectorAll('div, article, main, section');
    let best = null;
    let maxLen = 0;
    for (const el of candidates) {
      const len = el.textContent.trim().length;
      if (len > maxLen && len > 100 && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
        maxLen = len;
        best = el;
      }
    }
    return best || document.body;
  }

  function findTextNode(node, offset) {
    if (node.nodeType === Node.TEXT_NODE) {
      return { node, offset: Math.min(offset, node.textContent.length) };
    }
    let accumulated = 0;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const len = child.textContent.length;
        if (accumulated + len > offset) {
          return { node: child, offset: offset - accumulated };
        }
        accumulated += len;
      } else {
        const result = findTextNode(child, offset - accumulated);
        if (result) return result;
      }
    }
    return null;
  }

  function getXPathForNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      let path = '';
      let current = node.parentNode;
      while (current && current !== document.body) {
        let index = 1;
        let sibling = current.previousSibling;
        while (sibling) {
          if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) index++;
          sibling = sibling.previousSibling;
        }
        path = `/${current.tagName.toLowerCase()}[${index}]` + path;
        current = current.parentNode;
      }
      return `/html/body${path}/text()[1]`;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      let path = '';
      let current = node;
      while (current && current !== document.body) {
        let index = 1;
        let sibling = current.previousSibling;
        while (sibling) {
          if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) index++;
          sibling = sibling.previousSibling;
        }
        path = `/${current.tagName.toLowerCase()}[${index}]` + path;
        current = current.parentNode;
      }
      return `/body${path}`;
    }

    return '';
  }

  function resolveXPath(xpath) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch {
      return null;
    }
  }

  function getSelectionData() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (text.length < 1) return null;

    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    let startXPath, endXPath;
    try {
      startXPath = getXPathForNode(startContainer);
      endXPath = getXPathForNode(endContainer);
    } catch {
      return null;
    }

    if (!startXPath || !endXPath) return null;

    return {
      text,
      startXPath,
      startOffset: range.startOffset,
      endXPath,
      endOffset: range.endOffset
    };
  }

  function saveHighlightsDirect(url, highlights) {
    try { guard(); } catch { return; }
    chrome.storage.local.set({ [url]: highlights });
  }

  async function getStoredHighlights(url) {
    try { guard(); } catch { return []; }
    return new Promise(resolve => {
      chrome.storage.local.get(url, result => resolve(result[url] || []));
    });
  }

  function removeSpan(e) {
    try { guard(); } catch { return; }
    const span = e.currentTarget;
    console.log('[Underlyne] removeSpan called', span?.dataset?.shId);
    if (!span || !span.parentNode) return;
    const parent = span.parentNode;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    span.remove();
    const id = span.dataset.shId;
    const url = normalizeUrl(window.location.href);
    chrome.runtime.sendMessage({ action: 'deleteHighlight', url, id });
    chrome.storage.local.get(url, result => {
      let highlights = result[url] || [];
      highlights = highlights.filter(h => h.id !== id);
      chrome.storage.local.set({ [url]: highlights }, () => refreshAnnotationPanel());
    });
  }

  function setupAnnotationLayout() {
    try { guard(); } catch { return; }
    let wrapper = document.getElementById('sh-grid-wrapper');
    let articleCol = document.getElementById('sh-article-col');
    let panel = document.getElementById('sh-annotation-panel');
    const container = getArticleContainer();
    if (!container || container === document.body) return;
    if (wrapper && articleCol && articleCol.contains(container)) return;
    if (wrapper) wrapper.remove();
    wrapper = document.createElement('div');
    wrapper.id = 'sh-grid-wrapper';
    articleCol = document.createElement('div');
    articleCol.id = 'sh-article-col';
    panel = document.createElement('div');
    panel.id = 'sh-annotation-panel';
    panel.innerHTML = '<div class="sh-ae-empty">No highlights yet</div>';
    container.parentNode.insertBefore(wrapper, container);
    wrapper.appendChild(articleCol);
    wrapper.appendChild(panel);
    articleCol.appendChild(container);
  }

  function getSpanOffset(span) {
    const articleCol = document.getElementById('sh-article-col');
    if (!articleCol) return 0;
    const colRect = articleCol.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    return spanRect.top - colRect.top;
  }

  function addAnnotationEntry(data, span) {
    setupAnnotationLayout();
    const panel = document.getElementById('sh-annotation-panel');
    if (!panel) return;
    const empty = panel.querySelector('.sh-ae-empty');
    if (empty) empty.remove();
    let entry = panel.querySelector(`[data-sh-ae-id="${data.id}"]`);
    if (entry) return;
    const offset = getSpanOffset(span);
    entry = document.createElement('div');
    entry.className = 'sh-annotation-entry';
    entry.dataset.shAeId = data.id;
    entry.style.top = offset + 'px';
    const bar = document.createElement('div');
    bar.className = 'sh-ae-bar sh-ae-bar-' + data.color;
    const content = document.createElement('div');
    content.className = 'sh-ae-content';
    const meta = document.createElement('div');
    meta.className = 'sh-ae-meta';
    meta.textContent = data.type === 'underline' ? 'Underline' : data.type === 'both' ? 'Highlight + Underline' : 'Highlight';
    const text = document.createElement('div');
    text.className = 'sh-ae-text';
    text.textContent = data.text;
    const del = document.createElement('button');
    del.className = 'sh-ae-delete';
    del.textContent = '✕';
    del.addEventListener('click', e => {
      e.stopPropagation();
      const targetSpan = document.querySelector(`[data-sh-id="${data.id}"]`);
      if (targetSpan) removeSpan({ currentTarget: targetSpan });
    });
    entry.addEventListener('click', () => {
      const targetSpan = document.querySelector(`[data-sh-id="${data.id}"]`);
      if (targetSpan) {
        targetSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetSpan.style.outline = '2px solid #0284c7';
        targetSpan.style.borderRadius = '2px';
        setTimeout(() => targetSpan.style.outline = '', 1500);
      }
    });
    content.appendChild(meta);
    content.appendChild(text);
    entry.appendChild(bar);
    entry.appendChild(content);
    entry.appendChild(del);
    panel.appendChild(entry);
  }

  function removeAnnotationEntry(id) {
    const panel = document.getElementById('sh-annotation-panel');
    if (!panel) return;
    const entry = panel.querySelector(`[data-sh-ae-id="${id}"]`);
    if (!entry) return;
    entry.remove();
    if (!panel.querySelector('.sh-annotation-entry')) {
      panel.innerHTML = '<div class="sh-ae-empty">No highlights yet</div>';
    }
  }

  function refreshAnnotationPanel() {
    try { guard(); } catch { return; }
    const panel = document.getElementById('sh-annotation-panel');
    if (!panel) return;
    const url = normalizeUrl(window.location.href);
    chrome.storage.local.get(url, result => {
      const highlights = result[url] || [];
      panel.querySelectorAll('.sh-annotation-entry').forEach(el => el.remove());
      if (highlights.length === 0) {
        panel.innerHTML = '<div class="sh-ae-empty">No highlights yet</div>';
        return;
      }
      const empty = panel.querySelector('.sh-ae-empty');
      if (empty) empty.remove();
      const merged = {};
      for (const h of highlights) {
        const key = h.text + '|' + h.startOffset + '|' + h.endOffset;
        if (!merged[key]) merged[key] = { types: {}, data: h };
        merged[key].types[h.type] = h.color;
        if (h.timestamp > (merged[key].data.timestamp || 0)) merged[key].data = h;
      }
      const deduped = Object.values(merged).map(m => {
        const hasH = m.types.highlight;
        const hasU = m.types.underline;
        m.data.type = hasH && hasU ? 'both' : (hasU ? 'underline' : 'highlight');
        m.data.color = hasU ? m.types.underline : m.types.highlight;
        return m.data;
      });
      for (const h of deduped) {
        const span = document.querySelector(`[data-sh-id="${h.id}"]`);
        if (span) addAnnotationEntry(h, span);
      }
    });
  }

  function applyStyleToSelection(type, color) {
    try { guard(); } catch { return; }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (text.length < 1) return;

    const selectionData = getSelectionData();
    if (!selectionData) return;

    // Apply visual styling immediately (no storage dependency)
    const container = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement : range.startContainer;
    const existingId = container?.closest?.('[data-sh-id]')?.dataset?.shId;

    let span;
    if (existingId) {
      span = document.querySelector(`[data-sh-id="${existingId}"]`);
      if (!span) return;
      const hasHl = span.classList.contains('sh-highlight');
      const hasUl = span.classList.contains('sh-underline');
      if (type === 'highlight') {
        span.className = getHighlightClasses(color) + (hasUl ? ' ' + span.className.match(/sh-underline-\S+/)?.[0] : '');
      } else {
        span.className = (hasHl ? span.className.match(/sh-\w+/g)?.filter(c => !c.startsWith('sh-underline'))?.join(' ') || 'sh-highlight' : '') + ' ' + getUnderlineClass(color);
      }
      span.dataset.shType = 'both';
      span.dataset.shColor = color;
    } else {
      span = document.createElement('span');
      span.className = type === 'highlight' ? getHighlightClasses(color) : getUnderlineClass(color);
      span.dataset.shId = generateId();
      span.dataset.shType = type;
      span.dataset.shColor = color;

      try {
        range.surroundContents(span);
      } catch {
        try {
          const fragment = range.extractContents();
          span.appendChild(fragment);
          range.insertNode(span);
        } catch (e) {
          console.error('[Underlyne] Failed to insert span:', e);
          return;
        }
      }
    }

    console.log('[Underlyne] Applied', type, 'span:', span.outerHTML?.slice(0, 200));

    // Persist (best-effort, fire-and-forget)
    const url = normalizeUrl(window.location.href);
    const highlightData = {
      id: span.dataset.shId,
      url,
      type,
      color,
      text: selectionData.text,
      startXPath: selectionData.startXPath,
      startOffset: selectionData.startOffset,
      endXPath: selectionData.endXPath,
      endOffset: selectionData.endOffset,
      timestamp: Date.now()
    };

    try {
      chrome.runtime.sendMessage({
        action: 'saveHighlight',
        url: highlightData.url,
        highlight: highlightData
      });
    } catch (e) {
      console.error('[Underlyne] sendMessage persistence failed, trying direct storage:', e);
      try {
        chrome.storage.local.get(url, result => {
          const stored = result[url] || [];
          stored.push(highlightData);
          chrome.storage.local.set({ [url]: stored });
        });
      } catch (e2) {
        console.error('[Underlyne] Direct storage persistence also failed:', e2);
      }
    }

    addAnnotationEntry(highlightData, span);
    selection.removeAllRanges();
  }

  function wrapRangeInSpan(range, span) {
    try {
      range.surroundContents(span);
      return true;
    } catch {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
      return true;
    }
  }

  function findTextByContent(text, container) {
    const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = treeWalker.nextNode())) {
      const idx = node.textContent.indexOf(text);
      if (idx !== -1) return { node, offset: idx };
    }
    return null;
  }

  function applyHighlightFromData(data) {
    const existingById = document.querySelector(`[data-sh-id="${data.id}"]`);
    if (existingById) {
      const hasHl = existingById.classList.contains('sh-highlight');
      const hasUl = existingById.classList.contains('sh-underline');
      if (data.type === 'underline') {
        if (!hasUl) existingById.className += ' ' + getUnderlineClass(data.color);
      } else {
        if (!hasHl) existingById.className = getHighlightClasses(data.color) + (hasUl ? ' ' + existingById.className.match(/sh-underline-\S+/)?.[0] : '');
      }
      existingById.dataset.shType = 'both';
      existingById.dataset.shColor = data.color;
      return true;
    }

    let startNode = resolveXPath(data.startXPath);
    let endNode = resolveXPath(data.endXPath);

    if (!startNode || !endNode) {
      const container = getArticleContainer();
      const found = findTextByContent(data.text, container || document.body);
      if (found) {
        const range = document.createRange();
        range.setStart(found.node, found.offset);
        range.setEnd(found.node, found.offset + data.text.length);
        const span = document.createElement('span');
        span.className = data.type === 'underline' ? getUnderlineClass(data.color) : getHighlightClasses(data.color);
        span.dataset.shId = data.id;
        span.dataset.shType = data.type || 'highlight';
        span.dataset.shColor = data.color;
        span.addEventListener('dblclick', removeSpan);
        wrapRangeInSpan(range, span);
        return true;
      }
      return false;
    }

    try {
      const range = document.createRange();
      range.setStart(startNode, data.startOffset);
      range.setEnd(endNode, data.endOffset);

      const existingSpan = range.startContainer?.parentElement?.closest?.('[data-sh-id]') ||
        (range.startContainer?.dataset?.shId ? range.startContainer : null);

      if (existingSpan) {
        const hasHl = existingSpan.classList.contains('sh-highlight');
        const hasUl = existingSpan.classList.contains('sh-underline');
        if (data.type === 'underline') {
          if (!hasUl) existingSpan.className += ' ' + getUnderlineClass(data.color);
        } else {
          if (!hasHl) {
            existingSpan.className = getHighlightClasses(data.color) + (hasUl ? ' ' + existingSpan.className.match(/sh-underline-\S+/)?.[0] : '');
          }
        }
        existingSpan.dataset.shType = 'both';
        existingSpan.dataset.shColor = data.color;
        return true;
      }

      const span = document.createElement('span');
      span.className = data.type === 'underline'
        ? getUnderlineClass(data.color)
        : getHighlightClasses(data.color);
      span.dataset.shId = data.id;
      span.dataset.shType = data.type || 'highlight';
      span.dataset.shColor = data.color;

      span.addEventListener('dblclick', removeSpan);

      console.log('[Underlyne] Restored span:', span.outerHTML.slice(0, 200));
      wrapRangeInSpan(range, span);
      return true;
    } catch {
      return false;
    }
  }

  async function restoreHighlights() {
    try { guard(); } catch { return; }
    const url = normalizeUrl(window.location.href);
    console.log('[Underlyne] Restoring highlights for key:', url);
    try {
      const highlights = await new Promise(resolve => {
        chrome.storage.local.get(url, result => resolve(result[url] || []));
      });
      console.log('[Underlyne] Found', highlights.length, 'highlights');

      if (highlights.length === 0) return;

      const container = getArticleContainer();
      if (!container) return;

      let restored = 0;
      for (const data of highlights) {
        try {
          if (applyHighlightFromData(data)) restored++;
        } catch {}
      }
      refreshAnnotationPanel();

      if (restored < highlights.length) {
        let attempts = 0;
        const retry = setInterval(async () => {
          attempts++;
          for (const data of highlights) {
            try {
              applyHighlightFromData(data);
            } catch {}
          }
          refreshAnnotationPanel();
          if (attempts >= 5 || document.querySelectorAll('[data-sh-id]').length >= highlights.length) clearInterval(retry);
        }, 1500);
      }
    } catch (e) {
      console.error('[Underlyne] restoreHighlights error:', e);
    }
  }

  function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'sh-toolbar';

    const hlLabel = document.createElement('span');
    hlLabel.className = 'sh-label';
    hlLabel.textContent = 'H';
    toolbar.appendChild(hlLabel);

    for (const color of ['red', 'yellow', 'green', 'blue', 'purple']) {
      const btn = document.createElement('button');
      btn.className = `sh-toolbar-btn hl-${color}`;
      btn.title = `Highlight ${color}`;
      btn.addEventListener('click', () => {
        applyStyleToSelection('highlight', color);
        hideToolbar();
      });
      toolbar.appendChild(btn);
    }

    const divider1 = document.createElement('div');
    divider1.className = 'sh-divider';
    toolbar.appendChild(divider1);

    const ulLabel = document.createElement('span');
    ulLabel.className = 'sh-label';
    ulLabel.textContent = 'U';
    toolbar.appendChild(ulLabel);

    for (const color of ['red', 'yellow', 'green', 'blue', 'purple']) {
      const btn = document.createElement('button');
      btn.className = `sh-toolbar-btn ul-${color}`;
      btn.title = `Underline ${color}`;
      btn.addEventListener('click', () => {
        applyStyleToSelection('underline', color);
        hideToolbar();
      });
      toolbar.appendChild(btn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.id = 'sh-remove-btn';
    removeBtn.className = 'sh-remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const c = sel.getRangeAt(0).startContainer;
        const el = c.nodeType === Node.TEXT_NODE ? c.parentElement : c;
        const shSpan = el?.closest?.('[data-sh-id]');
        if (shSpan) removeSpan({ currentTarget: shSpan });
      }
      hideToolbar();
    });
    toolbar.appendChild(removeBtn);

    document.body.appendChild(toolbar);
    return toolbar;
  }

  function showToolbar(x, y) {
    const toolbar = document.getElementById('sh-toolbar') || createToolbar();
    const sel = window.getSelection();
    const hasExisting = sel && sel.rangeCount > 0 && (() => {
      const c = sel.getRangeAt(0).startContainer;
      const el = c.nodeType === Node.TEXT_NODE ? c.parentElement : c;
      return !!el?.closest?.('[data-sh-id]');
    })();
    const removeBtn = document.getElementById('sh-remove-btn');
    if (removeBtn) removeBtn.style.display = hasExisting ? 'inline-flex' : 'none';
    toolbar.style.left = `${Math.min(x, window.innerWidth - toolbar.offsetWidth - 10)}px`;
    toolbar.style.top = `${Math.max(10, y - toolbar.offsetHeight - 8)}px`;
    toolbar.classList.add('visible');
  }

  function hideToolbar() {
    const toolbar = document.getElementById('sh-toolbar');
    if (toolbar) toolbar.classList.remove('visible');
  }

  document.addEventListener('mouseup', (e) => {
    const toolbar = document.getElementById('sh-toolbar');
    const panel = document.getElementById('sh-annotation-panel');
    if (toolbar && (e.target === toolbar || toolbar.contains(e.target))) return;
    if (panel && (e.target === panel || panel.contains(e.target))) return;

    setTimeout(() => {
      const selection = window.getSelection();
      console.log('[Underlyne] Selection:', selection?.toString().trim());
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        showToolbar(e.clientX, e.clientY);
      } else {
        hideToolbar();
      }
    }, 10);
  });

  document.addEventListener('mousedown', (e) => {
    const toolbar = document.getElementById('sh-toolbar');
    if (toolbar && !toolbar.contains(e.target)) {
      hideToolbar();
    }
  });


  document.addEventListener('keydown', (e) => {
    const isHighlight = e.altKey && e.key === 'h';
    const isUnderline = e.altKey && e.key === 'u';
    const isHighlightFallback = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H';
    const isUnderlineFallback = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'U';

    if (isHighlight || isHighlightFallback) {
      e.preventDefault();
      try { guard(); } catch { return; }
      chrome.runtime.sendMessage({ action: 'getDefaults' }, (response) => {
        if (response) {
          applyStyleToSelection('highlight', response.highlightColor || 'yellow');
        }
      });
    }

    if (isUnderline || isUnderlineFallback) {
      e.preventDefault();
      try { guard(); } catch { return; }
      chrome.runtime.sendMessage({ action: 'getDefaults' }, (response) => {
        if (response) {
          applyStyleToSelection('underline', response.underlineColor || 'yellow');
        }
      });
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      const selection = window.getSelection();
      const container = selection?.rangeCount ? selection.getRangeAt(0).startContainer : null;
      if (container) {
        const el = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
        const shSpan = el?.closest?.('[data-sh-id]');
        if (shSpan) {
          e.preventDefault();
          removeSpan({ currentTarget: shSpan });
        }
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try { guard(); } catch { return; }
    if (message.action === 'applyHighlight') {
      applyStyleToSelection('highlight', message.color || 'yellow');
      sendResponse({ ok: true });
    } else if (message.action === 'applyUnderline') {
      applyStyleToSelection('underline', message.color || 'yellow');
      sendResponse({ ok: true });
    } else if (message.action === 'restoreHighlights') {
      restoreHighlights().then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  function waitForContentAndRestore() {
    const check = () => {
      const container = getArticleContainer();
      console.log('[Underlyne] Article container:', container?.tagName, container?.className);
      if (container && container.textContent.trim().length > 50) {
        setupAnnotationLayout();
        restoreHighlights();
        return true;
      }
      return false;
    };

    if (!check()) {
      const observer = new MutationObserver(() => {
        if (check()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 15000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForContentAndRestore);
  } else {
    waitForContentAndRestore();
  }

  function scheduleRestore() {
    let attempts = 0;
    const tryRestore = () => {
      attempts++;
      const container = getArticleContainer();
      if (container && container.textContent.trim().length > 50) {
        setupAnnotationLayout();
        restoreHighlights();
      } else if (attempts < 15) {
        setTimeout(tryRestore, 500);
      }
    };
    setTimeout(tryRestore, 300);
  }

let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
    try { guard(); } catch { urlObserver.disconnect(); return; }
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      scheduleRestore();
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });

  window.addEventListener('popstate', () => {
    try { guard(); } catch { return; }
    scheduleRestore();
  });

  const restoreInterval = setInterval(() => {
    try { guard(); } catch { clearInterval(restoreInterval); return; }
    const currentUrl = normalizeUrl(window.location.href);
    chrome.storage.local.get(currentUrl, result => {
      const highlights = result[currentUrl] || [];
      if (highlights.length > 0) {
        const existing = document.querySelectorAll('[data-sh-id]').length;
        if (existing < highlights.length) {
          for (const data of highlights) {
            try { applyHighlightFromData(data); } catch {}
          }
          refreshAnnotationPanel();
        }
      }
    });
  }, 2000);
  setTimeout(() => clearInterval(restoreInterval), 20000);

  window.addEventListener('unload', () => {
    clearInterval(restoreInterval);
    urlObserver.disconnect();
  });
})();