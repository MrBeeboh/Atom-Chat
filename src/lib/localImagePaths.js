/**
 * Detect local image paths in assistant text and map them to Atom's Documents file API.
 * Browsers cannot load file:// from the Vite origin; /api/desktop-host/file serves them.
 */

const IMAGE_EXT = String.raw`png|jpe?g|gif|webp|svg|bmp`;

/** Markdown image: ![alt](path) */
const MD_IMG_RE = new RegExp(String.raw`!\[[^\]]*\]\(([^)\s]+)\)`, 'g');

/** Explicit Atom / tool marker: [Image: path-or-url] */
const BRACKET_IMG_RE = new RegExp(String.raw`\[Image:\s*([^\]]+)\]`, 'gi');

/**
 * Bare local paths under Documents (absolute, ~/Documents, or Documents/...).
 * Skips http(s) and data: URLs.
 */
const BARE_LOCAL_RE = new RegExp(
  String.raw`(?:^|[\s\`'"(\[])((?:file://)?(?:~/Documents/|/home/[^/\s\`'")]+/Documents/|/Users/[^/\s\`'")]+/Documents/|Documents/)[^\s\`'")]+\.(?:${IMAGE_EXT}))`,
  'gi',
);

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeLocalImagePath(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('file://')) {
    s = decodeURIComponent(s.slice('file://'.length));
  }
  if (/^https?:\/\//i.test(s) || s.startsWith('data:') || s.startsWith('/api/')) {
    return '';
  }
  // Strip optional trailing punctuation from prose.
  s = s.replace(/[.,;:!?)]+$/, '');
  if (!new RegExp(String.raw`\.(?:${IMAGE_EXT})$`, 'i').test(s)) return '';

  if (s.startsWith('~/Documents/')) {
    return s.slice('~/Documents/'.length);
  }
  const homeDocs = s.match(/^\/(?:home|Users)\/[^/]+\/Documents\/(.+)$/);
  if (homeDocs) return homeDocs[1];
  if (s.startsWith('Documents/')) return s.slice('Documents/'.length);
  // Relative path already under Documents (e.g. from markdown ![alt](chart.png))
  if (!s.startsWith('/') && !s.startsWith('~')) return s.replace(/^\.\//, '');
  // Absolute path under Documents is fine for the API (resolveInRoot accepts it)
  if (s.includes('/Documents/')) return s;
  return '';
}

/**
 * @param {string} content
 * @returns {string[]} unique Documents-relative (or absolute-under-Documents) paths
 */
export function extractLocalImagePaths(content) {
  if (!content || typeof content !== 'string') return [];
  const found = [];
  const seen = new Set();

  function add(raw) {
    const norm = normalizeLocalImagePath(raw);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    found.push(norm);
  }

  for (const re of [MD_IMG_RE, BRACKET_IMG_RE, BARE_LOCAL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      add(m[1]);
    }
  }
  return found;
}

/**
 * @param {string} pathUnderDocuments
 * @returns {string}
 */
export function localImageServeUrl(pathUnderDocuments) {
  const p = String(pathUnderDocuments || '').trim();
  if (!p) return '';
  return `/api/desktop-host/file?path=${encodeURIComponent(p)}`;
}

/**
 * Rewrite markdown image targets that point at local Documents files so {@html} imgs load.
 * @param {string} raw
 * @returns {string}
 */
export function rewriteLocalMarkdownImages(raw) {
  if (!raw || typeof raw !== 'string') return raw || '';
  return raw.replace(MD_IMG_RE, (full, src) => {
    const norm = normalizeLocalImagePath(src);
    if (!norm) return full;
    return full.replace(src, localImageServeUrl(norm));
  });
}
