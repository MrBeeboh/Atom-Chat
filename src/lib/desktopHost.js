/**
 * Browser client for the local Documents host, plus OpenAI-style tool defs.
 * The host itself runs in Vite (or scripts/desktop-host.mjs), not in the page.
 */

export const DESKTOP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and folders under the user Documents directory. Path is relative to Documents (use "." for the top).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from Documents. Default "."' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file under Documents. Binary files are rejected. Large files are truncated.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Relative path from Documents' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a UTF-8 text file under Documents. Requires a one-time write grant for this ATOM session. Creates or replaces the file.',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', description: 'Relative path from Documents' },
          content: { type: 'string', description: 'Full file contents' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_scad',
      description:
        'Run OpenSCAD to export an STL under Documents. Paths are relative to Documents. Optional defines are a name→value object (example: {"part":"base"}). Requires a session jobs grant. Does not start a print.',
      parameters: {
        type: 'object',
        required: ['scad', 'output'],
        properties: {
          scad: { type: 'string', description: 'Relative .scad path from Documents' },
          output: { type: 'string', description: 'Relative .stl output path from Documents' },
          defines: {
            type: 'object',
            description: 'OpenSCAD -D variables. Keys are identifiers; string values are letters, digits, and _./+- only.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'slice_print',
      description:
        'Slice an STL with OrcaSlicer via slice_print.py and upload gcode to Moonraker. Always stages only — never starts the printer. Requires a session jobs grant. After staging, tell the user to review, then use start_print if they explicitly say to start.',
      parameters: {
        type: 'object',
        required: ['stl', 'name'],
        properties: {
          stl: { type: 'string', description: 'Relative .stl path from Documents' },
          name: { type: 'string', description: 'Printer filename without .gcode (letters, digits, dot, underscore, hyphen)' },
          fast: { type: 'boolean', description: 'Use the fast slice profile' },
          supports: { type: 'boolean', description: 'Enable breakaway supports in the preset' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_print',
      description:
        'Start a previously staged gcode on the Ender-3 via Moonraker. Only call this after the user explicitly says to start that named print. The UI will ask for a one-time confirm. Heats the bed and nozzle.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Same --name used with slice_print (no .gcode)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Run a bash command on this PC as the logged-in user. Returns stdout, stderr, and the exit code. Use for the real machine, not only Documents.',
      parameters: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string', description: 'Bash command line.' },
        },
      },
    },
  },
];

export const MAX_DESKTOP_TOOL_ROUNDS = 12;
export const DESKTOP_JOB_TOOLS = ['export_scad', 'slice_print'];
export const DESKTOP_START_TOOLS = ['start_print'];

function desktopHostBase() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return '/api/desktop-host';
  return 'http://127.0.0.1:5176';
}

export function desktopSystemHint(root) {
  const folder = root || '~/Documents';
  return [
    `You can use tools to list, read, and write files under the user's Documents folder (${folder}).`,
    'Paths must be relative to that folder (example: "DRONE Builds/notes.md").',
    'Start with list_dir when you are unsure what is there. Prefer read_file before write_file.',
    'Only write when the user asked you to change or create a file. Do not try to access anything outside Documents.',
    'For 3D printing: export_scad writes an STL, slice_print slices with OrcaSlicer and uploads to the printer but does NOT start.',
    'shell runs a bash command on this PC and returns stdout, stderr, and the exit code. Use it when the user asks you to run something.',
    'Never claim you cannot run OpenSCAD, slice_print, or shell — those tools exist.',
    'start_print heats the printer. Call it only after the user clearly says to start that named job.',
  ].join(' ');
}

/** Many GGUF chat templates allow only one system message, and it must be first. */
export function mergeSystemHint(messages, hint) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const systems = [];
  const rest = [];
  for (const m of list) {
    if (m?.role === 'system') systems.push(m);
    else rest.push(m);
  }
  if (hint) systems.push({ role: 'system', content: hint });
  const content = systems
    .map((m) => (typeof m.content === 'string' ? m.content.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
  if (!content) return rest;
  return [{ role: 'system', content }, ...rest];
}

/**
 * Qwen GGUF templates emit their own system block when `tools` is set.
 * A second role:system then throws "System message must be at the beginning."
 * Fold ours into the first user message so the wire payload has zero system roles.
 */
export function foldSystemIntoUserMessages(messages) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const systems = [];
  const rest = [];
  for (const m of list) {
    if (m?.role === 'system') systems.push(m);
    else rest.push(m);
  }
  const hint = systems
    .map((m) => (typeof m.content === 'string' ? m.content.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
  if (!hint) return rest;
  const idx = rest.findIndex((m) => m.role === 'user');
  if (idx === -1) return [{ role: 'user', content: hint }, ...rest];
  const user = rest[idx];
  if (typeof user.content === 'string') {
    rest[idx] = { ...user, content: `${hint}\n\n${user.content}` };
  } else if (Array.isArray(user.content)) {
    rest[idx] = { ...user, content: [{ type: 'text', text: hint }, ...user.content] };
  } else {
    rest[idx] = { ...user, content: hint };
  }
  return rest;
}

/**
 * OpenAI/llama.cpp require every role:tool message to sit immediately after an
 * assistant message that has tool_calls. ATOM stores those two rows in a tight
 * loop with Date.now(), so IndexedDB can load the tool result first. The next
 * user turn then 400s: "Messages with role 'tool' must be a response to a
 * preceding message with 'tool_calls'".
 *
 * Re-attach tool rows to the assistant that owns their tool_call_id; drop orphans.
 * @param {Array<{ role?: string, tool_calls?: Array, tool_call_id?: string }>} messages
 */
export function repairOpenAiToolTurns(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const tools = [];
  const rest = [];
  for (const m of list) {
    if (m?.role === 'tool') tools.push(m);
    else rest.push(m);
  }
  if (!tools.length) return list;

  const used = new Set();
  const out = [];
  for (const m of rest) {
    out.push(m);
    if (m?.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length) continue;
    const ids = new Set(m.tool_calls.map((c) => c?.id).filter(Boolean));
    tools.forEach((t, i) => {
      if (used.has(i)) return;
      if (t.tool_call_id && ids.has(t.tool_call_id)) {
        out.push(t);
        used.add(i);
      }
    });
  }
  return out;
}

export async function fetchDesktopHostStatus(signal) {
  try {
    const res = await fetch(`${desktopHostBase()}/status`, { signal });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return data?.ok ? data : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function grantDesktopWrites() {
  const res = await fetch(`${desktopHostBase()}/grant-writes`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not grant writes.');
  }
  return res.json();
}

export async function grantDesktopJobs() {
  const res = await fetch(`${desktopHostBase()}/grant-jobs`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not grant print jobs.');
  }
  return res.json();
}

export async function grantDesktopStart() {
  const res = await fetch(`${desktopHostBase()}/grant-start`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not grant print start.');
  }
  return res.json();
}

export async function invokeDesktopTool(name, args) {
  const res = await fetch(`${desktopHostBase()}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args || {} }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, code: body.code || 'HTTP_ERROR', error: body.error || `Tool ${name} failed.` };
  }
  return body;
}

export function parseToolArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function mergeToolCallDeltas(acc, deltas) {
  if (!Array.isArray(deltas)) return acc;
  for (const d of deltas) {
    const i = Number.isInteger(d?.index) ? d.index : acc.length;
    if (!acc[i]) acc[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
    if (d.id) acc[i].id = d.id;
    if (d.type) acc[i].type = d.type;
    if (d.function?.name) acc[i].function.name += d.function.name;
    if (typeof d.function?.arguments === 'string') acc[i].function.arguments += d.function.arguments;
  }
  return acc;
}

export function finalizeToolCalls(acc) {
  return (acc || [])
    .filter((c) => c?.function?.name)
    .map((c, i) => ({
      id: c.id || `call_${i}`,
      type: 'function',
      function: {
        name: c.function.name,
        arguments: c.function.arguments || '{}',
      },
    }));
}

export function formatToolStatus(toolCalls) {
  if (!toolCalls?.length) return '';
  return toolCalls
    .map((c) => {
      const args = parseToolArguments(c.function?.arguments);
      const detail = args.command || args.path || args.output || args.stl || args.scad || args.name || args.query || args.url || '';
      return `${c.function?.name || 'tool'}${detail ? ` ${detail}` : ''}`;
    })
    .join(' · ');
}

function toolPath(args) {
  return args.path || args.output || args.stl || args.scad || args.name || '';
}

/**
 * Run model tool_calls against the Documents host.
 * First write / print-job in a session prompts; start_print always prompts.
 */
export async function executeDesktopToolCalls(toolCalls, { confirmWrites, confirmJobs, confirmStart } = {}) {
  const actions = [];
  const messages = [];
  for (const call of toolCalls || []) {
    const name = call.function?.name;
    const args = parseToolArguments(call.function?.arguments);
    if (name === 'write_file') {
      const status = await fetchDesktopHostStatus();
      if (status.ok && !status.writesGranted) {
        const allowed = confirmWrites ? await confirmWrites(args.path || '') : false;
        if (!allowed) {
          const denied = { ok: false, code: 'WRITE_DENIED', error: 'User denied writes for this session.' };
          actions.push({ name, path: toolPath(args), ok: false });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(denied),
          });
          continue;
        }
        await grantDesktopWrites();
      }
    }
    if (DESKTOP_JOB_TOOLS.includes(name)) {
      const status = await fetchDesktopHostStatus();
      if (status.ok && !status.jobsGranted) {
        const allowed = confirmJobs ? await confirmJobs(name, args) : false;
        if (!allowed) {
          const denied = { ok: false, code: 'JOBS_DENIED', error: 'User denied OpenSCAD / slice jobs for this session.' };
          actions.push({ name, path: toolPath(args), ok: false });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(denied),
          });
          continue;
        }
        await grantDesktopJobs();
      }
    }
    if (DESKTOP_START_TOOLS.includes(name)) {
      const allowed = confirmStart ? await confirmStart(args.name || '') : false;
      if (!allowed) {
        const denied = { ok: false, code: 'START_DENIED', error: 'User denied starting the print.' };
        actions.push({ name, path: toolPath(args), ok: false });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(denied),
        });
        continue;
      }
      await grantDesktopStart();
    }
    const result = await invokeDesktopTool(name, args);
    actions.push({ name, path: toolPath(args), ok: result.ok !== false });
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(result),
    });
  }
  return { messages, actions };
}
