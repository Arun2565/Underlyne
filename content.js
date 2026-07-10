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
      'div[class*="post"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
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

  function normalizeAnnotationText(text) {
    return (text || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  }

  function deduplicateAnnotations(highlights) {
    const newestByAnnotation = new Map();
    for (const annotation of highlights) {
      const key = `${annotation.type || 'highlight'}|${normalizeAnnotationText(annotation.text)}`;
      const existing = newestByAnnotation.get(key);
      if (!existing || (annotation.timestamp || 0) >= (existing.timestamp || 0)) newestByAnnotation.set(key, annotation);
    }
    return Array.from(newestByAnnotation.values());
  }

  function removeDuplicateSpans(keepId, text, type) {
    const normalizedText = normalizeAnnotationText(text);
    document.querySelectorAll('[data-sh-id]').forEach(existing => {
      if (existing.dataset.shId === keepId || normalizeAnnotationText(existing.textContent) !== normalizedText) return;
      const isSameType = type === 'highlight'
        ? existing.classList.contains('sh-highlight')
        : existing.classList.contains('sh-underline');
      if (!isSameType || !existing.parentNode) return;
      const parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      existing.remove();
    });
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
    console.log('[Underlyne] Deleting highlight id=' + id + ' url=' + url);
    chrome.runtime.sendMessage({ action: 'deleteHighlight', url, id });
    chrome.storage.local.get(url, result => {
      let before = (result[url] || []).length;
      let highlights = result[url] || [];
      highlights = highlights.filter(h => h.id !== id);
      let after = highlights.length;
      console.log('[Underlyne] Storage update: ' + before + ' -> ' + after + ' highlights');
      chrome.storage.local.set({ [url]: highlights }, () => {
        console.log('[Underlyne] Storage write complete, refreshing sidebar');
        refreshSidebar();
      });
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
    removeDuplicateSpans(highlightData.id, highlightData.text, highlightData.type);

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
          const stored = (result[url] || []).filter(item =>
            normalizeAnnotationText(item.text) !== normalizeAnnotationText(highlightData.text) ||
            (item.type || 'highlight') !== (highlightData.type || 'highlight')
          );
          stored.push(highlightData);
          chrome.storage.local.set({ [url]: stored });
        });
      } catch (e2) {
        console.error('[Underlyne] Direct storage persistence also failed:', e2);
      }
    }

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
      refreshSidebar();

      if (restored < highlights.length) {
        let attempts = 0;
        const retry = setInterval(async () => {
          attempts++;
          for (const data of highlights) {
            try {
              applyHighlightFromData(data);
            } catch {}
          }
          refreshSidebar();
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

    const sidebarBtn = document.createElement('button');
    sidebarBtn.id = 'sh-sidebar-btn';
    sidebarBtn.className = 'sh-sidebar-btn';
    sidebarBtn.textContent = '☰';
    sidebarBtn.title = 'Toggle sidebar';
    sidebarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });
    toolbar.appendChild(sidebarBtn);

    document.body.appendChild(toolbar);
    return toolbar;
  }

  function createSidebar() {
    if (document.getElementById('sh-sidebar')) return;
    const sidebar = document.createElement('div');
    sidebar.id = 'sh-sidebar';
    sidebar.innerHTML = '<div id="sh-sidebar-header"><span id="sh-sidebar-title">Underlyne</span><div id="sh-sidebar-actions"><button id="sh-sidebar-export" type="button" title="Export annotations as Markdown" aria-label="Export annotations as Markdown"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg></button><button id="sh-sidebar-close" type="button" title="Close annotations" aria-label="Close annotations">✕</button></div></div><div id="sh-sidebar-list"></div>';
    sidebar.querySelector('#sh-sidebar-close').addEventListener('click', hideSidebar);
    sidebar.querySelector('#sh-sidebar-export').addEventListener('click', exportAnnotationsAsMarkdown);
    const sidebarList = sidebar.querySelector('#sh-sidebar-list');
    sidebarList.addEventListener('click', e => {
      const item = e.target.closest('.sh-sidebar-item');
      if (!item) return;
      const id = item.dataset.shId;
      if (!id) return;
      if (e.target.closest('.sh-sidebar-del')) {
        const span = document.querySelector(`[data-sh-id="${id}"]`);
        if (span) {
          removeSpan({ currentTarget: span });
        } else {
          const url = normalizeUrl(window.location.href);
          chrome.storage.local.get(url, result => {
            let highlights = result[url] || [];
            highlights = highlights.filter(h => h.id !== id);
            chrome.storage.local.set({ [url]: highlights }, () => refreshSidebar());
          });
          chrome.runtime.sendMessage({ action: 'deleteHighlight', url, id });
        }
      } else focusAnnotation(item);
    });
    sidebarList.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('.sh-sidebar-item');
      if (!item) return;
      e.preventDefault();
      focusAnnotation(item);
    });
    document.body.appendChild(sidebar);
  }

  function exportAnnotationsAsMarkdown() {
    try { guard(); } catch { return; }
    const url = normalizeUrl(window.location.href);
    chrome.storage.local.get(url, result => {
      const highlights = result[url] || [];
      if (highlights.length === 0) {
        const button = document.getElementById('sh-sidebar-export');
        if (button) {
          const originalTitle = button.title;
          button.title = 'No annotations to export';
          setTimeout(() => { button.title = originalTitle; }, 2000);
        }
        return;
      }

      const order = Array.from(document.querySelectorAll('[data-sh-id]')).map(span => span.dataset.shId);
      const orderMap = new Map(order.map((id, index) => [id, index]));
      const orderedHighlights = [...highlights].sort((a, b) => {
        const aIndex = orderMap.get(a.id);
        const bIndex = orderMap.get(b.id);
        if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
        if (aIndex !== undefined) return -1;
        if (bIndex !== undefined) return 1;
        return (a.timestamp || 0) - (b.timestamp || 0);
      });
      const typeLabels = { highlight: 'Highlight', underline: 'Underline' };
      const colorLabels = { yellow: 'Yellow', green: 'Green', blue: 'Blue', red: 'Red', purple: 'Purple' };
      const lines = [
        `# ${document.title || 'Underlyne Annotations'}`,
        '',
        `Source: ${window.location.href}`,
        `Exported: ${new Date().toLocaleString()}`,
        '',
        '## Annotations',
        ''
      ];
      for (const annotation of orderedHighlights) {
        const text = (annotation.text || '').replace(/\n+/g, ' ').trim();
        const type = typeLabels[annotation.type] || annotation.type || 'Annotation';
        const color = colorLabels[annotation.color] || annotation.color || 'Yellow';
        lines.push(`- **“${text}”** — ${type} (${color})`);
      }
      lines.push('', '---', `*${orderedHighlights.length} annotation${orderedHighlights.length === 1 ? '' : 's'}*`);

      const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      const articleName = (document.title || 'underlyne-annotations')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'underlyne-annotations';
      link.download = `${articleName}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    });
  }

  function focusAnnotation(item) {
    const id = item.dataset.shId;
    let span = document.querySelector(`[data-sh-id="${id}"]`);
    const annotation = item._annotationData;
    if (!span && annotation) {
      try { applyHighlightFromData(annotation); } catch {}
      span = document.querySelector(`[data-sh-id="${id}"]`);
    }
    let target = span;
    if (!target && annotation?.startXPath) {
      const node = resolveXPath(annotation.startXPath);
      target = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    }
    if (!target) return;
    document.querySelectorAll('.sh-sidebar-item.is-active').forEach(entry => entry.classList.remove('is-active'));
    item.classList.add('is-active');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!span) return;
    span.classList.remove('sh-annotation-focus');
    void span.offsetWidth;
    span.classList.add('sh-annotation-focus');
    setTimeout(() => span.classList.remove('sh-annotation-focus'), 1600);
  }

  function getSectionHeading(el) {
    let node = el;
    for (let i = 0; i < 20; i++) {
      if (!node || node === document.body) break;
      const prev = node.previousElementSibling;
      if (prev && /^H[1-6]$/.test(prev.tagName)) return prev.textContent.trim();
      const parentPrev = node.parentElement?.previousElementSibling;
      if (parentPrev && /^H[1-6]$/.test(parentPrev.tagName)) return parentPrev.textContent.trim();
      node = node.parentElement;
    }
    return null;
  }

  function refreshSidebar() {
    try { guard(); } catch { return; }
    const sidebar = document.getElementById('sh-sidebar');
    if (!sidebar || !sidebar.classList.contains('visible')) return;
    const url = normalizeUrl(window.location.href);
    chrome.storage.local.get(url, result => {
      const highlights = result[url] || [];
      const uniqueHighlights = deduplicateAnnotations(highlights);
      if (uniqueHighlights.length !== highlights.length) {
        chrome.storage.local.set({ [url]: uniqueHighlights });
      }
      const list = document.getElementById('sh-sidebar-list');
      if (!list) return;
      if (uniqueHighlights.length === 0) {
        list.innerHTML = '<div class="sh-sidebar-empty">No highlights yet</div>';
        return;
      }
      const merged = {};
      for (const h of uniqueHighlights) {
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

      const domOrder = new Map(
        Array.from(document.querySelectorAll('[data-sh-id]')).map((span, index) => [span.dataset.shId, index])
      );
      const ordered = deduped
        .map(h => ({ h, span: document.querySelector(`[data-sh-id="${h.id}"]`) }))
        .sort((a, b) => {
          const aIndex = domOrder.get(a.h.id);
          const bIndex = domOrder.get(b.h.id);
          if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
          if (aIndex !== undefined) return -1;
          if (bIndex !== undefined) return 1;
          return (a.h.timestamp || 0) - (b.h.timestamp || 0);
        });

      list.innerHTML = '';
      let previousSection = null;
      for (const { h, span } of ordered) {
        const section = span ? getSectionHeading(span) : null;
        if (section && section !== previousSection) {
          const head = document.createElement('div');
          head.className = 'sh-sidebar-section';
          head.textContent = section;
          list.appendChild(head);
        }
        previousSection = section;
        const item = document.createElement('div');
        item.className = 'sh-sidebar-item';
        item.dataset.shId = h.id;
        item._annotationData = h;
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `Jump to annotation: ${h.text}`);
        const bar = document.createElement('div');
        bar.className = `sh-sidebar-bar sh-bar-${h.color}`;
        const body = document.createElement('div');
        body.className = 'sh-sidebar-body';
        const meta = document.createElement('div');
        meta.className = 'sh-sidebar-meta';
        if (h.type === 'both') {
          meta.textContent = 'Highlight + Underline';
        } else {
          meta.textContent = h.type === 'underline' ? 'Underline' : 'Highlight';
        }
        const text = document.createElement('div');
        text.className = 'sh-sidebar-text';
        text.textContent = h.text;
        const del = document.createElement('button');
        del.className = 'sh-sidebar-del';
        del.textContent = '✕';
        del.title = 'Delete annotation';
        del.setAttribute('aria-label', 'Delete annotation');
        body.appendChild(meta);
        body.appendChild(text);
        item.appendChild(bar);
        item.appendChild(body);
        item.appendChild(del);
        list.appendChild(item);
      }
    });
  }

  function showSidebar() {
    createSidebar();
    const sidebar = document.getElementById('sh-sidebar');
    sidebar.classList.add('visible');
    refreshSidebar();
  }

  function hideSidebar() {
    const sidebar = document.getElementById('sh-sidebar');
    if (sidebar) sidebar.classList.remove('visible');
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('sh-sidebar');
    if (sidebar && sidebar.classList.contains('visible')) {
      hideSidebar();
    } else {
      showSidebar();
    }
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
    const sidebar = document.getElementById('sh-sidebar');
    if (toolbar && (e.target === toolbar || toolbar.contains(e.target))) return;
    if (sidebar && (e.target === sidebar || sidebar.contains(e.target))) return;

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
    } else if (message.action === 'getAnnotationsWithContext') {
      const spans = document.querySelectorAll('[data-sh-id]');
      const annotations = Array.from(spans).map(span => {
        const parent = span.parentNode;
        const fullText = parent ? parent.textContent : '';
        const spanText = span.textContent;
        const idx = fullText.indexOf(spanText);
        let contextBefore = '';
        let contextAfter = '';
        if (idx !== -1) {
          contextBefore = fullText.substring(Math.max(0, idx - 60), idx).trim();
          contextAfter = fullText.substring(idx + spanText.length, idx + spanText.length + 60).trim();
        }
        return {
          id: span.dataset.shId,
          type: span.dataset.shType || 'highlight',
          color: span.dataset.shColor || 'yellow',
          text: spanText,
          contextBefore,
          contextAfter
        };
      });
      sendResponse({ annotations, articleTitle: document.title, url: window.location.href });
      return true;
    } else if (message.action === 'getHighlightsOrder') {
      const spans = document.querySelectorAll('[data-sh-id]');
      const order = Array.from(spans).map(span => span.dataset.shId);
      sendResponse({ order });
      return true;
    }
  });

  function waitForContentAndRestore() {
    const check = () => {
      const container = getArticleContainer();
      console.log('[Underlyne] Article container:', container?.tagName, container?.className);
      if (container && container.textContent.trim().length > 50) {
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
          refreshSidebar();
        }
      }
    });
  }, 2000);
  setTimeout(() => clearInterval(restoreInterval), 20000);

  const highlightObserver = new MutationObserver(mutations => {
    try { guard(); } catch { highlightObserver.disconnect(); return; }
    // Rendering the sidebar changes the DOM too. Ignore those mutations so a
    // refresh does not immediately rebuild the list again and swallow clicks.
    const articleChanged = mutations.some(mutation => {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target.parentElement;
      return !target?.closest?.('#sh-sidebar');
    });
    if (!articleChanged) return;
    refreshSidebar();
  });
  highlightObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('unload', () => {
    clearInterval(restoreInterval);
    urlObserver.disconnect();
    highlightObserver.disconnect();
  });
})();
