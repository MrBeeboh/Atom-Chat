import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDesktopHost, DesktopHostError } from '../../scripts/desktop-host-lib.mjs';
import { mergeToolCallDeltas, finalizeToolCalls, parseToolArguments, formatToolStatus, mergeSystemHint, foldSystemIntoUserMessages, repairOpenAiToolTurns } from './desktopHost.js';

describe('desktop host sandbox', () => {
  /** @type {string} */
  let root;
  /** @type {ReturnType<typeof createDesktopHost>} */
  let host;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-docs-'));
    host = createDesktopHost({ root });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the Documents root', async () => {
    fs.writeFileSync(path.join(root, 'hello.txt'), 'hi');
    fs.mkdirSync(path.join(root, 'notes'));
    const listed = await host.invoke('list_dir', { path: '.' });
    expect(listed.ok).toBe(true);
    expect(listed.entries.map((e) => e.name).sort()).toEqual(['hello.txt', 'notes']);
  });

  it('reads a text file relative to Documents', async () => {
    fs.writeFileSync(path.join(root, 'note.md'), '# hi');
    const got = await host.invoke('read_file', { path: 'note.md' });
    expect(got.content).toBe('# hi');
    expect(got.path).toBe('note.md');
  });

  it('rejects path escape with ..', async () => {
    await expect(host.invoke('read_file', { path: '../secret.txt' })).rejects.toMatchObject({
      code: 'OUTSIDE_ROOT',
    });
  });

  it('rejects absolute paths outside the root', async () => {
    await expect(host.invoke('read_file', { path: '/etc/passwd' })).rejects.toBeInstanceOf(DesktopHostError);
  });

  it('rejects writes before grant and allows them after', async () => {
    await expect(host.invoke('write_file', { path: 'a.txt', content: 'x' })).rejects.toMatchObject({
      code: 'WRITE_GRANT_REQUIRED',
    });
    host.grantWrites();
    const written = await host.invoke('write_file', { path: 'a.txt', content: 'hello' });
    expect(written.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('hello');
  });

  it('does not follow a symlink out of Documents', async () => {
    const outside = path.join(os.tmpdir(), `atom-outside-${Date.now()}`);
    fs.writeFileSync(outside, 'nope');
    fs.symlinkSync(outside, path.join(root, 'link.txt'));
    await expect(host.invoke('read_file', { path: 'link.txt' })).rejects.toMatchObject({
      code: 'OUTSIDE_ROOT',
    });
    fs.unlinkSync(outside);
  });

  it('rejects binary files', async () => {
    fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 0, 9]));
    await expect(host.invoke('read_file', { path: 'blob.bin' })).rejects.toMatchObject({
      code: 'BINARY',
    });
  });
});

describe('tool call stream assembly', () => {
  it('merges incremental tool call deltas', () => {
    const acc = [];
    mergeToolCallDeltas(acc, [{ index: 0, id: 'c1', function: { name: 'read_' } }]);
    mergeToolCallDeltas(acc, [{ index: 0, function: { name: 'file', arguments: '{"path":' } }]);
    mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: '"n.md"}' } }]);
    const calls = finalizeToolCalls(acc);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_file');
    expect(parseToolArguments(calls[0].function.arguments)).toEqual({ path: 'n.md' });
  });

  it('formats a status line', () => {
    expect(
      formatToolStatus([
        { function: { name: 'read_file', arguments: '{"path":"a.md"}' } },
        { function: { name: 'list_dir', arguments: '{"path":"."}' } },
      ]),
    ).toBe('read_file a.md · list_dir .');
  });

  it('merges a hint into the existing first system message', () => {
    const merged = mergeSystemHint(
      [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'hi' }],
      'You can use Documents tools.',
    );
    expect(merged).toHaveLength(2);
    expect(merged.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(merged[0].content).toContain('Be concise.');
    expect(merged[0].content).toContain('You can use Documents tools.');
    expect(merged[1].role).toBe('user');
  });

  it('collapses two system messages into one', () => {
    const merged = mergeSystemHint(
      [
        { role: 'system', content: 'A' },
        { role: 'system', content: 'B' },
        { role: 'user', content: 'hi' },
      ],
      'C',
    );
    expect(merged.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(merged[0].content).toBe('A\n\nB\n\nC');
    expect(merged[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('folds system text into the first user message and drops system roles', () => {
    const folded = foldSystemIntoUserMessages([
      { role: 'system', content: 'Use Documents tools.' },
      { role: 'user', content: 'list my files' },
    ]);
    expect(folded.every((m) => m.role !== 'system')).toBe(true);
    expect(folded[0].content).toContain('Use Documents tools.');
    expect(folded[0].content).toContain('list my files');
  });

  it('reattaches tool results that loaded before their assistant tool_calls row', () => {
    const repaired = repairOpenAiToolTurns([
      { role: 'user', content: 'list files' },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_dir', arguments: '{}' } }] },
      { role: 'user', content: 'what wall did you hit?' },
    ]);
    expect(repaired.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(repaired[2].tool_call_id).toBe('c1');
  });

  it('drops orphan tool rows with no matching assistant tool_calls', () => {
    const repaired = repairOpenAiToolTurns([
      { role: 'user', content: 'hi' },
      { role: 'tool', tool_call_id: 'orphan', content: '{}' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(repaired.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('desktop print jobs', () => {
  /** @type {string} */
  let root;
  /** @type {ReturnType<typeof createDesktopHost>} */
  let host;
  /** @type {Array<{ cmd?: string, args?: string[], fetch?: string }>} */
  let runs;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-docs-'));
    fs.mkdirSync(path.join(root, '3d_Printing', 'PRINTS'), { recursive: true });
    fs.writeFileSync(path.join(root, '3d_Printing', 'PRINTS', 'slice_print.py'), '# fake\n');
    fs.mkdirSync(path.join(root, 'cad'));
    fs.writeFileSync(path.join(root, 'cad', 'part.scad'), 'cube(1);\n');
    fs.writeFileSync(path.join(root, 'cad', 'part.stl'), 'solid fake\nendsolid fake\n');
    runs = [];
    host = createDesktopHost({
      root,
      binaries: {
        openscad: '/usr/bin/openscad',
        python: '/usr/bin/python3',
        moonrakerUrl: 'http://192.168.0.18:7125',
      },
      runArgv: async (cmd, args) => {
        runs.push({ cmd, args });
        if (String(cmd).includes('openscad')) {
          const outIdx = args.indexOf('-o');
          if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], 'solid x\n');
        }
        return { code: 0, stdout: 'STAGED only. Operator approval required before start.', stderr: '' };
      },
      fetchImpl: async (url) => {
        runs.push({ fetch: String(url) });
        return {
          ok: true,
          status: 200,
          text: async () => '{"result":"ok"}',
        };
      },
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects export_scad before the jobs grant', async () => {
    await expect(
      host.invoke('export_scad', { scad: 'cad/part.scad', output: 'cad/out.stl', defines: { part: 'base' } }),
    ).rejects.toMatchObject({ code: 'JOBS_GRANT_REQUIRED' });
  });

  it('exports STL via OpenSCAD argv (no shell) after grant', async () => {
    host.grantJobs();
    const got = await host.invoke('export_scad', {
      scad: 'cad/part.scad',
      output: 'cad/out.stl',
      defines: { part: 'base' },
    });
    expect(got.ok).toBe(true);
    expect(got.output).toBe('cad/out.stl');
    expect(runs[0].cmd).toBe('/usr/bin/openscad');
    expect(runs[0].args).toEqual(['-D', 'part="base"', '-o', path.join(root, 'cad', 'out.stl'), path.join(root, 'cad', 'part.scad')]);
    expect(fs.existsSync(path.join(root, 'cad', 'out.stl'))).toBe(true);
  });

  it('rejects path escape and unsafe defines', async () => {
    host.grantJobs();
    await expect(
      host.invoke('export_scad', { scad: '../secret.scad', output: 'cad/out.stl' }),
    ).rejects.toMatchObject({ code: 'OUTSIDE_ROOT' });
    await expect(
      host.invoke('export_scad', {
        scad: 'cad/part.scad',
        output: 'cad/out.stl',
        defines: { part: 'base"; system("rm -rf /")' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DEFINE' });
  });

  it('stages with slice_print and refuses start on that tool', async () => {
    host.grantJobs();
    const got = await host.invoke('slice_print', { stl: 'cad/part.stl', name: 'cam_v2_base', fast: true });
    expect(got.staged).toBe(true);
    expect(got.start).toBe(false);
    expect(runs[0].args).toContain('--fast');
    expect(runs[0].args).not.toContain('--start');
    await expect(
      host.invoke('slice_print', { stl: 'cad/part.stl', name: 'cam_v2_base', start: true }),
    ).rejects.toMatchObject({ code: 'START_SEPARATE' });
  });

  it('requires a one-shot start grant and consumes it', async () => {
    await expect(host.invoke('start_print', { name: 'cam_v2_base' })).rejects.toMatchObject({
      code: 'START_GRANT_REQUIRED',
    });
    host.grantStart();
    const got = await host.invoke('start_print', { name: 'cam_v2_base' });
    expect(got.started).toBe(true);
    expect(runs.some((r) => String(r.fetch || '').includes('cam_v2_base.gcode'))).toBe(true);
    expect(host.status().startGranted).toBe(false);
    await expect(host.invoke('start_print', { name: 'cam_v2_base' })).rejects.toMatchObject({
      code: 'START_GRANT_REQUIRED',
    });
  });

  it('rejects a dangerous print name', async () => {
    host.grantStart();
    await expect(host.invoke('start_print', { name: '../etc/passwd' })).rejects.toMatchObject({
      code: 'INVALID_NAME',
    });
  });
});
