/** Generate a simple unique id */
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Resize/compress image data URLs for vision APIs (avoids LM Studio 400 on large base64).
 * Always re-encodes to JPEG for smaller payload; max dimension 768px for non-Qwen models.
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
export function resizeImageForVision(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    return Promise.resolve(dataUrl);
  }
  const maxDim = 768;
  const jpegQuality = 0.8;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/jpeg', jpegQuality);
        resolve(out || dataUrl);
      } catch (e) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Approximate max payload size (bytes) for images below which we skip resize. */
const VISION_SKIP_RESIZE_BELOW_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Resize multiple image data URLs for vision API. Preserves order.
 * Skips resize entirely if total base64 payload is already under 1 MB.
 * @param {string[]} dataUrls
 * @returns {Promise<string[]>}
 */
export async function resizeImageDataUrlsForVision(dataUrls) {
  if (!Array.isArray(dataUrls) || dataUrls.length === 0) return dataUrls;
  const totalBytes = dataUrls.reduce((sum, url) => sum + (typeof url === 'string' ? Math.floor((url.length * 3) / 4) : 0), 0);
  if (totalBytes <= VISION_SKIP_RESIZE_BELOW_BYTES) return dataUrls;
  return Promise.all(dataUrls.map(resizeImageForVision));
}

/**
 * True if this model is Qwen-VL 4B or 8B — those work with full-size images; skip resize to preserve quality.
 * @param {string} [modelId]
 * @returns {boolean}
 */
export function shouldSkipImageResizeForVision(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  const lower = modelId.toLowerCase();
  return /qwen.*vl.*(4b|8b)|(4b|8b).*qwen.*vl/.test(lower);
}

/** Format date for sidebar list */
export function formatTime(date) {
  const d = typeof date === 'number' ? new Date(date) : date;
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

/** Group conversations by date: Today, Yesterday, This week, Older */
export function groupByDate(conversations) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400_000;
  const weekAgo = today - 7 * 86400_000;

  const groups = { today: [], yesterday: [], week: [], older: [] };
  for (const c of conversations || []) {
    const ts = c.updatedAt ?? c.createdAt ?? 0;
    if (ts >= today) groups.today.push(c);
    else if (ts >= yesterday) groups.yesterday.push(c);
    else if (ts >= weekAgo) groups.week.push(c);
    else groups.older.push(c);
  }
  return groups;
}

/**
 * Svelte action: make a panel draggable by its handle. Handle must be a direct child of the panel.
 * Updates getPos/setPos and persists to localStorage on drag end; clamps to viewport.
 */
export function makeDraggable(handleEl, params) {
  if (!params || !handleEl) return;
  const { storageKey, getPos, setPos } = params;
  const panelEl = handleEl.parentElement;
  if (!panelEl) return;

  let dragging = false;
  function move(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    setPos({ x: startLeft + dx, y: startTop + dy });
  }
  function up() {
    dragging = false;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    const pos = getPos();
    const rect = panelEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.max(0, Math.min(vw - rect.width, pos.x));
    const y = Math.max(0, Math.min(vh - rect.height, pos.y));
    setPos({ x, y });
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(storageKey, JSON.stringify({ x, y }));
  }
  let startX, startY, startLeft, startTop;
  function down(e) {
    if (e.button !== 0) return;
    if (e.target?.closest?.('button')) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    const p = getPos();
    startLeft = p.x;
    startTop = p.y;
    dragging = true;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
  handleEl.addEventListener('pointerdown', down);
  return {
    destroy() {
      handleEl.removeEventListener('pointerdown', down);
      if (dragging) {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      }
    },
  };
}

/**
 * Svelte action: make an element resizable by dragging its bottom-right corner.
 * Updates getSize/setSize and persists to localStorage on resize end.
 */
export function makeResizable(element, params) {
  if (!params || !element) return;
  const { storageKey, getSize, setSize, minWidth = 100, minHeight = 60 } = params;

  let resizing = false;
  let startX, startY, startWidth, startHeight;

  function move(e) {
    if (!resizing) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newWidth = Math.max(minWidth, startWidth + dx);
    const newHeight = Math.max(minHeight, startHeight + dy);
    setSize({ w: newWidth, h: newHeight });
  }

  function up() {
    resizing = false;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    const size = getSize();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(size));
    }
  }

  function down(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    const size = getSize();
    startWidth = size.w;
    startHeight = size.h;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  const handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:se-resize;z-index:10';
  handle.addEventListener('pointerdown', down);
  element.style.position = 'relative';
  element.appendChild(handle);

  return {
    destroy() {
      handle.removeEventListener('pointerdown', down);
      if (resizing) {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      }
      if (element.contains(handle)) element.removeChild(handle);
    },
  };
}
