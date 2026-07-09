(() => {
  const COLORS = ['yellow', 'green', 'blue', 'red', 'purple'];

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
      'div.available-content',
      'div.post-content',
      'div[class*="post-body"]',
      'div.body',
      'article div.markup',
      'article'
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

  function applyStyleToSelection(type, color) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (text.length < 1) return;

    const span = document.createElement('span');
    span.className = type === 'highlight' ? getHighlightClasses(color) : getUnderlineClass(color);
    span.dataset.shId = generateId();
    span.dataset.shType = type;
    span.dataset.shColor = color;

    try {
      range.surroundContents(span);
    } catch {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    }

    span.addEventListener('click', function onClick() {
      const type = this.dataset.shType || 'highlight';
      const color = this.dataset.shColor || 'yellow';
      if (confirm(`Remove this ${type}?`)) {
        const parent = this.parentNode;
        while (this.firstChild) {
          parent.insertBefore(this.firstChild, this);
        }
        this.remove();
        const url = normalizeUrl(window.location.href);
        const id = this.dataset.shId;
        if (id) {
          chrome.runtime.sendMessage({
            action: 'deleteHighlight',
            url,
            id
          });
        }
      }
    });

    const selectionData = getSelectionData();
    if (selectionData) {
      const highlightData = {
        id: span.dataset.shId,
        url: normalizeUrl(window.location.href),
        type,
        color,
        text: selectionData.text,
        startXPath: selectionData.startXPath,
        startOffset: selectionData.startOffset,
        endXPath: selectionData.endXPath,
        endOffset: selectionData.endOffset,
        timestamp: Date.now()
      };

      chrome.runtime.sendMessage({
        action: 'saveHighlight',
        url: highlightData.url,
        highlight: highlightData
      });
    }

    selection.removeAllRanges();
  }

  function applyHighlightFromData(data) {
    const startNode = resolveXPath(data.startXPath);
    const endNode = resolveXPath(data.endXPath);

    if (!startNode || !endNode) return false;

    try {
      const range = document.createRange();
      range.setStart(startNode, data.startOffset);
      range.setEnd(endNode, data.endOffset);

      const span = document.createElement('span');
      span.className = data.type === 'underline'
        ? getUnderlineClass(data.color)
        : getHighlightClasses(data.color);
      span.dataset.shId = data.id;
      span.dataset.shType = data.type || 'highlight';
      span.dataset.shColor = data.color;

      span.addEventListener('click', function onClick() {
        const t = this.dataset.shType || 'highlight';
        if (confirm(`Remove this ${t}?`)) {
          const parent = this.parentNode;
          while (this.firstChild) {
            parent.insertBefore(this.firstChild, this);
          }
          this.remove();
          chrome.runtime.sendMessage({
            action: 'deleteHighlight',
            url: data.url,
            id: data.id
          });
        }
      });

      range.surroundContents(span);
      return true;
    } catch {
      return false;
    }
  }

  async function restoreHighlights() {
    const url = normalizeUrl(window.location.href);
    const result = await chrome.storage.local.get(url);
    const highlights = result[url] || [];

    if (highlights.length === 0) return;

    const container = getArticleContainer();
    if (!container) return;

    for (const data of highlights) {
      try {
        applyHighlightFromData(data);
      } catch {}
    }
  }

  function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'sh-toolbar';

    const hlLabel = document.createElement('span');
    hlLabel.className = 'sh-label';
    hlLabel.textContent = 'H';
    toolbar.appendChild(hlLabel);

    for (const color of ['yellow', 'green', 'blue', 'red', 'purple']) {
      const btn = document.createElement('button');
      btn.className = `sh-toolbar-btn hl-${color}`;
      btn.title = `Highlight ${color}`;
      btn.addEventListener('click', () => {
        applySelectionToStyle('highlight', color);
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

    for (const color of ['yellow', 'green', 'blue', 'red', 'purple']) {
      const btn = document.createElement('button');
      btn.className = `sh-toolbar-btn ul-${color}`;
      btn.title = `Underline ${color}`;
      btn.addEventListener('click', () => {
        applySelectionToStyle('underline', color);
        hideToolbar();
      });
      toolbar.appendChild(btn);
    }

    document.body.appendChild(toolbar);
    return toolbar;
  }

  function showToolbar(x, y) {
    const toolbar = document.getElementById('sh-toolbar') || createToolbar();
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
    if (toolbar && (e.target === toolbar || toolbar.contains(e.target))) return;

    setTimeout(() => {
      const selection = window.getSelection();
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'getDefaults' }, (response) => {
        if (response) {
          applySelectionToStyle('highlight', response.highlightColor || 'yellow');
        }
      });
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'getDefaults' }, (response) => {
        if (response) {
          applySelectionToStyle('underline', response.underlineColor || 'yellow');
        }
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'applyHighlight') {
      applySelectionToStyle('highlight', message.color || 'yellow');
      sendResponse({ ok: true });
    } else if (message.action === 'applyUnderline') {
      applySelectionToStyle('underline', message.color || 'yellow');
      sendResponse({ ok: true });
    } else if (message.action === 'restoreHighlights') {
      restoreHighlights().then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  function waitForContentAndRestore() {
    const check = () => {
      const container = getArticleContainer();
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

  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (window.location.href.includes('substack.com/p/')) {
        setTimeout(waitForContentAndRestore, 500);
      }
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });
})();