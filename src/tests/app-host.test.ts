// Servidor dentro do Folga.app (FOLGA_APP=1): o fim do stdin (app caiu, até por kill -9) encerra o servidor,
// e os processos do bundle (local.folga.app) contam como o próprio Folga, nunca como app a liberar.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryState } from '../types.ts';

const root = join(import.meta.dirname, '..', '..');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const exited = (c: ChildProcess, ms: number) => new Promise<number | null | 'vivo'>(res => {
  const t = setTimeout(() => res('vivo'), ms);
  c.once('exit', code => { clearTimeout(t); res(code); });
});

async function subir(extra: Record<string, string>, stdin: 'pipe' | 'ignore') {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const dataDir = mkdtempSync(join(tmpdir(), 'folga-app-'));
  const child = spawn(process.execPath, ['--no-warnings', join(root, 'src', 'server.ts')], {
    env: {
      ...process.env, FOLGA_PORT: String(port), FOLGA_DATA_DIR: dataDir, FAKE_MAC: '1', FAKE_APP_PID: '9100',
      FOLGA_FAKE_PROBE: join(root, 'src', 'tests', 'fake-probe.mjs'), FOLGA_APP: '', ...extra,
    },
    stdio: [stdin, 'ignore', 'inherit'],
  });
  let state: MemoryState | null = null;
  for (let i = 0; i < 100 && !state?.apps?.length; i++) {
    await sleep(100);
    try { state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json() as MemoryState; } catch { /* subindo */ }
  }
  if (!state?.apps?.length) { child.kill('SIGKILL'); assert.fail('servidor não subiu'); }
  return { child, state: state!, dataDir };
}

if (process.platform === 'darwin') {
  const { child, state, dataDir } = await subir({ FOLGA_APP: '1' }, 'pipe');
  try {
    const self = state.apps.find(a => a.key === '__self');
    assert.ok(self?.pids.includes(9100), `9100 fora do __self: ${JSON.stringify(state.apps.map(a => [a.key, a.pids]))}`);
    assert.ok(!state.apps.some(a => a.key === 'local.folga.app'), 'o app apareceu como app a liberar');
    console.log('ok  processos do local.folga.app contam como o próprio Folga');
    child.stdin!.end();
    assert.equal(await exited(child, 3000), 0, 'stdin fechado não encerrou o servidor em 3 s');
    console.log('ok  stdin fechado (app caiu) → servidor sai com 0 em ≤ 3 s');
  } finally {
    child.kill('SIGKILL');
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

{
  const { child, dataDir } = await subir({}, 'ignore');   // como o launch.mjs
  try {
    assert.equal(await exited(child, 3000), 'vivo', 'sem FOLGA_APP o servidor não pode cair por causa do stdin');
    console.log('ok  sem FOLGA_APP e stdin ignorado → continua no ar');
  } finally {
    child.kill('SIGKILL');
    await sleep(300);
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}
