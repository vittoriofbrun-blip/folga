// Auto Care de ponta a ponta no servidor real com sonda falsa (R10–R14): dispara sozinho, fecha só o parado,
// grava origin 'auto' e liga o freio.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type LogEntry, type MemoryState } from '../types.ts';

const PORT = 19000 + Math.floor(Math.random() * 1000);
const dataDir = mkdtempSync(join(tmpdir(), 'folga-ac-'));
const root = join(import.meta.dirname, '..', '..');
// a sonda falsa sobe em 63 % de memória; a linha em 50 % faz o Auto Care disparar
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, autoCareEnabled: true, autoCareThreshold: 50 }));

const server = spawn(process.execPath, ['--no-warnings', join(root, 'src', 'server.ts')], {
  env: {
    ...process.env, FOLGA_PORT: String(PORT), FOLGA_DATA_DIR: dataDir,
    FOLGA_FAKE_PROBE: join(root, 'src', 'tests', 'fake-probe.mjs'),
    FOLGA_CLOSE_WAIT_MS: '300', FOLGA_MEASURE_WAIT_MS: '300',
    FOLGA_STARTED_AT: String(Date.now() - 2 * 3_600_000),   // há 2 h: o notepad nunca focado já está parado
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const get = async <T>(path: string): Promise<T> => (await fetch(`http://127.0.0.1:${PORT}${path}`)).json() as Promise<T>;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

try {
  let log: LogEntry[] = [];
  for (let i = 0; i < 60 && log.length === 0; i++) {
    await sleep(200);
    try { log = await get<LogEntry[]>('/api/log?limit=5'); } catch { /* subindo */ }
  }
  assert.equal(log.length, 1, 'o Auto Care deveria ter rodado sozinho uma vez');
  assert.equal(log[0]!.origin, 'auto');
  assert.deepEqual(log[0]!.results.map(r => [r.key, r.outcome]), [['notepad', 'fechou']]);
  console.log('ok  R10/R11: disparou sozinho e fechou só o app parado (notepad), origin auto');

  await sleep(1_500);
  const st = await get<MemoryState>('/api/state');
  assert.ok(st.apps.some(a => a.key === 'explorer'), 'explorer (protegido) continua vivo');
  assert.ok(st.autoCare.lastRunAt !== null);
  assert.ok(st.autoCare.nextEligibleAt !== null && st.autoCare.nextEligibleAt > Date.now() + 9 * 60_000, 'freio de ~10 min');
  assert.equal((await get<LogEntry[]>('/api/log?limit=5')).length, 1, 'o freio impede a segunda execução');
  console.log('ok  R12: lastRunAt e freio expostos no estado; não rodou de novo');
  console.log('autocare-server: 2 casos ok');
} finally {
  server.kill();
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}
