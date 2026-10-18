// Roda cada src/tests/*.test.ts em sequência (sem framework). Sai com 1 se algum falhar.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'src', 'tests');
let files = [];
try { files = readdirSync(dir).filter(f => f.endsWith('.test.ts')).sort(); } catch { /* sem testes ainda */ }

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--no-warnings', join(dir, f)], { stdio: 'inherit' });
  console.log(`${r.status === 0 ? '[ok]  ' : '[FAIL]'} ${f}`);
  if (r.status !== 0) failed++;
}
console.log(`${files.length - failed}/${files.length} suítes verdes`);
process.exitCode = failed ? 1 : 0;
