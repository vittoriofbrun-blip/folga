// Compila probe/probe.cs com o csc.exe que ja vem no Windows (ADR 0002). Saida: probe/bin/probe.exe
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const src = join(root, 'probe', 'probe.cs');
const outDir = join(root, 'probe', 'bin');
const out = join(outDir, 'probe.exe');

if (!existsSync(csc)) {
  console.error(`csc.exe nao encontrado em ${csc}. A sonda precisa do .NET Framework 4.x (vem no Windows 10/11).`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const r = spawnSync(csc, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', `/out:${out}`, src], {
  shell: false, encoding: 'utf8',
});
if (r.error) { console.error('falha ao rodar o csc:', r.error.message); process.exit(1); }
if (r.stdout.trim()) console.log(r.stdout.trim());
if (r.stderr.trim()) console.error(r.stderr.trim());
if (r.status !== 0) { console.error(`csc terminou com codigo ${r.status}`); process.exit(r.status || 1); }
console.log(`ok: ${out}`);
