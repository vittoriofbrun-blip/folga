// Sobe o servidor (4780) e o Vite (5180) juntos; Ctrl+C derruba os dois.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const kids = [
  spawn(process.execPath, ['--no-warnings', '--watch', join(root, 'src', 'server.ts')], { stdio: 'inherit', cwd: root }),
  spawn(process.execPath, [vite], { stdio: 'inherit', cwd: root }),
];
const stop = () => { for (const k of kids) k.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const k of kids) k.on('exit', stop);
