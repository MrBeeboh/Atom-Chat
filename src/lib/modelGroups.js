/**
 * Group flat model ids for selector UI: local server, disk libraries, then cloud providers.
 */
import { modelDisplayName } from '$lib/api.js';

const CLOUD_LABEL = {
  deepseek: 'DeepSeek',
  grok: 'Grok',
  cerebras: 'Cerebras',
  deepinfra: 'DeepInfra',
};

const CLOUD_ORDER = ['deepseek', 'grok', 'cerebras', 'deepinfra'];

const STATIC_GROUPS = [
  {
    bucket: 'local:server',
    title: 'This device',
    hint: 'Models your inference server reports (llama.cpp, LM Studio, …)',
  },
  {
    bucket: 'disk:lmstudio',
    title: 'LM Studio library',
    hint: 'GGUF files under ~/.lmstudio/models',
  },
  {
    bucket: 'disk:other',
    title: 'Local disk',
    hint: 'Other folders on this machine (e.g. ~/models)',
  },
];

function bucketForModelId(id) {
  if (!id || typeof id !== 'string') return 'local:server';
  const colon = id.indexOf(':');
  if (colon > 0 && id.slice(0, colon).trim()) {
    return `cloud:${id.slice(0, colon).toLowerCase()}`;
  }
  const norm = id.replace(/\\/g, '/');
  const isDiskGguf =
    id.endsWith('.gguf') && (id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id));
  if (isDiskGguf) {
    if (norm.toLowerCase().includes('/.lmstudio/')) return 'disk:lmstudio';
    return 'disk:other';
  }
  return 'local:server';
}

function sortByDisplayName(items) {
  return [...items].sort((a, b) =>
    modelDisplayName(a.id).localeCompare(modelDisplayName(b.id), undefined, {
      sensitivity: 'base',
    }),
  );
}

/**
 * @param {{ id: string }[]} models
 * @returns {{ bucket: string, title: string, hint: string, items: { id: string }[] }[]}
 */
export function groupModelsForSelector(models) {
  const list = Array.isArray(models) ? models.filter((m) => m && typeof m.id === 'string' && m.id.trim()) : [];
  const map = new Map();
  for (const m of list) {
    const b = bucketForModelId(m.id);
    if (!map.has(b)) map.set(b, []);
    map.get(b).push(m);
  }

  const out = [];

  for (const def of STATIC_GROUPS) {
    const items = map.get(def.bucket);
    if (!items?.length) continue;
    out.push({
      bucket: def.bucket,
      title: def.title,
      hint: def.hint,
      items: sortByDisplayName(items),
    });
  }

  const cloudBuckets = [...map.keys()].filter((k) => k.startsWith('cloud:'));
  const ranked = [];
  const rest = [];
  for (const k of cloudBuckets) {
    const prov = k.slice('cloud:'.length);
    const idx = CLOUD_ORDER.indexOf(prov);
    if (idx >= 0) ranked.push({ k, idx });
    else rest.push(k);
  }
  ranked.sort((a, b) => a.idx - b.idx);
  rest.sort((a, b) => a.localeCompare(b));

  for (const { k } of ranked) {
    const items = map.get(k);
    if (!items?.length) continue;
    const prov = k.slice('cloud:'.length);
    out.push({
      bucket: k,
      title: CLOUD_LABEL[prov] || prov.charAt(0).toUpperCase() + prov.slice(1),
      hint: 'Requires API key in Settings',
      items: sortByDisplayName(items),
    });
  }
  for (const k of rest) {
    const items = map.get(k);
    if (!items?.length) continue;
    const prov = k.slice('cloud:'.length);
    out.push({
      bucket: k,
      title: CLOUD_LABEL[prov] || prov.charAt(0).toUpperCase() + prov.slice(1),
      hint: 'Requires API key in Settings',
      items: sortByDisplayName(items),
    });
  }

  return out;
}
