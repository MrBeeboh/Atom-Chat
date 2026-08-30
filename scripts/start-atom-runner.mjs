import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', cwd: root, shell: false });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

if (platform() === 'win32') {
  run('cmd.exe', ['/c', path.join(root, 'start_atom_ui.bat')]);
} else {
  run('bash', [path.join(root, 'start-atom.sh')]);
}
