// Servidor real numa porta alta, com pasta de dados temporária e sonda falsa (R15–R17, R07–R09, R14).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type LogEntry, type MemoryState, type ReleaseResponse, type Settings } from '../types.ts';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const dataDir = mkdtempSync(join(tmpdir(), 'folga-http-'));
const startupDir = mkdtempSync(join(tmpdir(), 'folga-início-'));   // nunca a pasta Inicializar real; acento como em C:\Users\Antônio
const filesRoot = mkdtempSync(join(tmpdir(), 'folga-files-'));   // varredura de teste: pasta vazia, nunca as pastas reais do usuário
const root = join(import.meta.dirname, '..', '..');
// já no disco antes de subir: ui-token curto demais (B5) e settings.json com valor que iria para o comando da sonda (B7)
writeFileSync(join(dataDir, 'ui-token'), 'curto');
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ sampleSeconds: "2'); calc; ('", idleMinutes: 15 }));

const server = spawn(process.execPath, ['--no-warnings', join(root, 'src', 'server.ts')], {
  env: {
    ...process.env, FOLGA_PORT: String(PORT), FOLGA_DATA_DIR: dataDir,
    FOLGA_FAKE_PROBE: join(root, 'src', 'tests', 'fake-probe.mjs'),
    FOLGA_FILES_ROOTS: filesRoot, FOLGA_CLOSE_WAIT_MS: '300', FOLGA_MEASURE_WAIT_MS: '300', FOLGA_STARTUP_DIR: startupDir,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

type Res = { status: number; body: any; headers: Record<string, string | string[] | undefined> };
function call(method: string, path: string, opts: { body?: unknown; token?: string; host?: string; type?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${PORT}`, ...opts.headers };
    if (data !== undefined) headers['content-type'] = opts.type ?? 'application/json';
    if (opts.token) headers['x-folga-token'] = opts.token;
    const req = request({ host: '127.0.0.1', port: PORT, method, path, headers }, res => {
      let text = '';
      res.on('data', c => (text += c));
      res.on('end', () => { let body: any = text; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode ?? 0, body, headers: res.headers }); });
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

  // B7: o settings.json do disco passa pela mesma validação do PUT; inválido volta aos padrões (e o valor nunca chega à sonda)
  assert.deepEqual((await call('GET', '/api/settings')).body, DEFAULT_SETTINGS);
  ok('B7: settings.json inválido no disco → padrões');

  assert.equal((await call('GET', '/api/state', { host: 'evil.example:80' })).status, 403);
  assert.equal((await call('GET', '/api/state', { host: `localhost:${PORT}` })).status, 200);
  ok('R15: Host fora de 127.0.0.1/localhost recusado');

  const token = (await call('GET', '/api/token')).body.token as string;
  assert.equal(token, readFileSync(join(dataDir, 'ui-token'), 'utf8').trim());
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.notEqual(token, 'curto');
  ok('token criado na pasta de dados e servido em /api/token; ui-token curto foi regerado (B5a)');

  assert.equal((await call('PUT', '/api/settings', { body: { idleMinutes: 10 } })).status, 403);
  assert.equal((await call('PUT', '/api/settings', { body: { idleMinutes: 10 }, token, type: 'text/plain' })).status, 415);
  assert.equal((await call('POST', '/api/release', { body: { keys: ['notepad'] } })).status, 403);
  ok('R16: sem token 403, sem JSON 415');

  // M6: o agente tem token próprio (novo a cada início), que só vale na varredura de arquivos
  const agentToken = readFileSync(join(dataDir, 'agent-token'), 'utf8').trim();
  assert.match(agentToken, /^[0-9a-f]{64}$/);
  assert.notEqual(agentToken, token);
  const scan = await call('POST', '/api/files/scan', { body: {}, token: agentToken });
  assert.equal(scan.status, 200);
  assert.deepEqual(scan.body.files, []);
  assert.equal((await call('POST', '/api/files/scan', { body: {}, token })).status, 200, 'o ui-token continua valendo na varredura');
  assert.equal((await call('POST', '/api/files/scan', { body: {}, token: 'x'.repeat(64) })).status, 403);
  for (const [method, path, body] of [
    ['POST', '/api/suggestions/abc-1/approve', {}], ['POST', '/api/suggestions/abc-1/ignore', {}], ['POST', '/api/suggestions', {}],
    ['POST', '/api/release', { keys: ['notepad'] }], ['PUT', '/api/settings', { idleMinutes: 10 }], ['PUT', '/api/startup', { on: true }],
    ['POST', '/api/agent/message', { provider: 'claude', text: 'oi' }], ['POST', '/api/agent/reset', {}], ['POST', '/api/window', {}],
  ] as const) {
    assert.equal((await call(method, path, { body, token: agentToken })).status, 403, `${method} ${path} com o agent-token`);
  }
  assert.ok(!existsSync(join(startupDir, 'Folga.lnk')), 'nada foi executado');
  ok('M6: agent-token passa só em POST /api/files/scan; aprovar, liberar, ajustes e o resto dão 403');

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

  assert.equal((await call('GET', '/api/startup')).body.on, false);
  assert.equal((await call('PUT', '/api/startup', { body: { on: true } })).status, 403);
  assert.equal((await call('PUT', '/api/startup', { body: { on: true }, token })).body.on, true);
  assert.ok(existsSync(join(startupDir, 'Folga.lnk')));
  assert.equal((await call('PUT', '/api/startup', { body: { on: false }, token })).body.on, false);
  assert.ok(!existsSync(join(startupDir, 'Folga.lnk')));
  ok('P04: atalho de inicialização liga e desliga (pasta temporária)');

  // A1: percent-encoding inválido derrubava o servidor (URIError numa rejeição não tratada)
  for (const bad of ['/%', '/%E0%A4%A', '/assets/%zz', '/%C0%80%']) assert.equal((await call('GET', bad)).status, 400, bad);
  assert.equal(server.exitCode, null, 'o servidor continua de pé');
  assert.equal((await call('GET', '/api/state')).status, 200);
  ok('A1: GET /% e /%E0%A4%A dão 400 e o servidor continua respondendo');

  // M1: contra iframe de outro site, MIME sniffing e carga de fora; em qualquer resposta
  const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  const seguras = [
    await call('GET', '/'),                  // estática (ou 404 se dist não existe): os cabeçalhos vêm igual
    await call('GET', '/%'),                 // erro 400
    await call('GET', '/api/state'),         // JSON
    await call('GET', '/api/state', { host: 'evil.example:80' }),   // 403
    await call('PUT', '/api/settings', { body: {} }),
    await call('GET', '/api/nao-existe'),
  ];
  for (const r of seguras) {
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['content-security-policy'], CSP);
  }
  assert.ok([200, 404].includes(seguras[0]!.status));
  ok('M1: X-Frame-Options, nosniff e CSP em resposta estática, JSON e de erro');

  // B5b: requisição que outro site dispara (ex.: uma imagem embutida noutro site) é recusada em /api/*
  for (const p of ['/api/state', '/api/disk', '/api/quickclean', '/api/token']) {
    assert.equal((await call('GET', p, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, p);
  }
  assert.equal((await call('POST', '/api/files/scan', { body: {}, token, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  for (const v of ['same-origin', 'same-site', 'none']) assert.equal((await call('GET', '/api/state', { headers: { 'sec-fetch-site': v } })).status, 200, v);
  ok('B5b: Sec-Fetch-Site cross-site recusado em /api/*; same-origin, same-site e none passam');

  console.log(`http: ${passed} casos ok`);
} finally {
  server.kill();
  await sleep(300);
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  await rm(startupDir, { recursive: true, force: true, maxRetries: 5 });
  await rm(filesRoot, { recursive: true, force: true, maxRetries: 5 });
}
