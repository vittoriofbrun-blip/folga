// Servidor real numa porta alta, com pasta de dados temporária e sonda falsa (R15–R17, R07–R09, R14).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogEntry, MemoryState, ReleaseResponse, Settings } from '../types.ts';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const dataDir = mkdtempSync(join(tmpdir(), 'folga-http-'));
const root = join(import.meta.dirname, '..', '..');

const server = spawn(process.execPath, ['--no-warnings', join(root, 'src', 'server.ts')], {
  env: {
    ...process.env, FOLGA_PORT: String(PORT), FOLGA_DATA_DIR: dataDir,
    FOLGA_FAKE_PROBE: join(root, 'src', 'tests', 'fake-probe.mjs'),
    FOLGA_CLOSE_WAIT_MS: '300', FOLGA_MEASURE_WAIT_MS: '300',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

type Res = { status: number; body: any };
function call(method: string, path: string, opts: { body?: unknown; token?: string; host?: string; type?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${PORT}` };
    if (data !== undefined) headers['content-type'] = opts.type ?? 'application/json';
    if (opts.token) headers['x-folga-token'] = opts.token;
    const req = request({ host: '127.0.0.1', port: PORT, method, path, headers }, res => {
      let text = '';
      res.on('data', c => (text += c));
      res.on('end', () => { let body: any = text; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode ?? 0, body }); });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitReady() {
  for (let i = 0; i < 100; i++) {
    try { const r = await call('GET', '/api/state'); if (r.status === 200) return r.body as MemoryState; } catch {}
    await sleep(100);
  }
  throw new Error('servidor não subiu');
}

let passed = 0;
const ok = (name: string) => { passed++; console.log(`ok  ${name}`); };

try {
  const state = await waitReady();
  assert.ok(state.apps.some(a => a.key === 'notepad' && a.state !== 'protected'));
  assert.equal(state.apps.find(a => a.key === 'explorer')?.reason, 'system');
  assert.equal(state.apps.find(a => a.key === 'svchost')?.reason, 'other_session');
  ok('estado: notepad candidato, explorer e svchost protegidos');

  assert.equal((await call('GET', '/api/state', { host: 'evil.example:80' })).status, 403);
  assert.equal((await call('GET', '/api/state', { host: `localhost:${PORT}` })).status, 200);
  ok('R15: Host fora de 127.0.0.1/localhost recusado');

  const token = (await call('GET', '/api/token')).body.token as string;
  assert.equal(token, readFileSync(join(dataDir, 'ui-token'), 'utf8').trim());
  assert.match(token, /^[0-9a-f]{64}$/);
  ok('token criado na pasta de dados e servido em /api/token');

  assert.equal((await call('PUT', '/api/settings', { body: { idleMinutes: 10 } })).status, 403);
  assert.equal((await call('PUT', '/api/settings', { body: { idleMinutes: 10 }, token, type: 'text/plain' })).status, 415);
  assert.equal((await call('POST', '/api/release', { body: { keys: ['notepad'] } })).status, 403);
  ok('R16: sem token 403, sem JSON 415');

  const good = await call('PUT', '/api/settings', { body: { idleMinutes: 10, neverClose: ['Code.exe'] }, token });
  assert.equal(good.status, 200);
  assert.equal((good.body as Settings).idleMinutes, 10);
  assert.deepEqual((good.body as Settings).neverClose, ['code']);
  assert.equal(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).idleMinutes, 10);
  for (const bad of [{ autoCareThreshold: 120 }, { idleMinutes: '10' }, { naoExiste: 1 }, { neverClose: 'code' }, [1]]) {
    const r = await call('PUT', '/api/settings', { body: bad, token });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(!String(r.body.erro).includes('\\'), 'R17: erro sem caminho');
  }
  ok('PUT /api/settings valida faixa, tipo e campo, e grava settings.json');

  assert.equal((await call('POST', '/api/release', { body: { keys: ['explorer'] }, token })).status, 409);
  ok('R09: pedido com app protegido recusado');

  const rel = await call('POST', '/api/release', { body: { keys: ['notepad'] }, token });
  assert.equal(rel.status, 200);
  const r = rel.body as ReleaseResponse;
  assert.deepEqual(r.results.map(x => x.outcome), ['fechou']);
  assert.equal(r.availAfter - r.availBefore, 40e6);
  ok('R07/R08: liberar fecha o notepad e mede o disponível');

  const log = (await call('GET', '/api/log?limit=5')).body as LogEntry[];
  assert.equal(log.length, 1);
  assert.equal(log[0]!.origin, 'manual');
  assert.equal(log[0]!.results[0]!.key, 'notepad');
  const st = (await call('GET', '/api/state')).body as MemoryState;
  assert.ok(st.freed.some(f => f.key === 'notepad'));
  assert.ok(!st.apps.some(a => a.key === 'notepad'));
  ok('R14: registro gravado e Liberados no estado');

  console.log(`http: ${passed} casos ok`);
} finally {
  server.kill();
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}
