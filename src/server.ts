// Servidor local do Folga: sonda → classificador → HTTP/SSE (ADR 0001, R15–R17).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { decide, emptyAutoCare, finishRun } from './autocare.ts';
import { classify, emptyHistory, type ClassifyHistory } from './classify.ts';
import { startProbe } from './probe.ts';
import { pushSample, freshWindowMs } from './samples.ts';
import { createReleaser } from './release.ts';
import { openWindow, setStartup, startupInstalled } from './window.ts';
import { createWarnings } from './warnings.ts';
import { createFiles } from './files.ts';
import { createAppData, parseAppDataBases } from './appdata.ts';
import { createSuggestions } from './suggestions.ts';
import { createWatch } from './watch.ts';
import { createNotify } from './notify.ts';
import { createAgent } from './agent.ts';
import { dataDir, defaultSettings } from './platform.ts';
import { DEFAULT_SETTINGS, type AgentProvider, type Emit, type MemoryState, type ProbeSnapshot, type Sample, type Settings, type SuggestionDraft } from './types.ts';

const ROOT = join(import.meta.dirname, '..');
const PORT = Number(process.env.FOLGA_PORT ?? 4780);
const DATA_DIR = dataDir();
const DEFAULTS = defaultSettings();
const DIST = join(ROOT, 'dist');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

mkdirSync(DATA_DIR, { recursive: true });

/** Gravação atômica (ADR 0005): o leitor nunca vê o arquivo pela metade. */
function writeAtomic(file: string, content: string) {
  writeFileSync(file + '.tmp', content);
  renameSync(file + '.tmp', file);
}

// ---------- tokens (R16) ----------
// ui-token: da interface, autoriza tudo. Arquivo com menos de 32 caracteres (vazio, cortado, editado à mão) é regerado.
const tokenFile = join(DATA_DIR, 'ui-token');
let TOKEN = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '';
if (TOKEN.length < 32) { TOKEN = randomBytes(32).toString('hex'); writeAtomic(tokenFile, TOKEN); }
// agent-token: só do processo MCP do agente, novo a cada início, aceito apenas na varredura de arquivos (que só lê).
// O ui-token também aprova sugestões; o agente nunca o vê.
const AGENT_TOKEN = randomBytes(32).toString('hex');
writeAtomic(join(DATA_DIR, 'agent-token'), AGENT_TOKEN);

// ---------- ajustes (ADR 0005: gravação atômica) ----------
const settingsFile = join(DATA_DIR, 'settings.json');
// o disco passa pela mesma validação do PUT (sampleSeconds entra no comando da sonda); inválido volta aos padrões
let settingsFrom = 'padrões (sem arquivo)';   // vai para o server.log: sem isso, um ajuste perdido no logon é invisível
let settingsProblem: string | null = null;    // R34: preenchido só quando havia arquivo e ele não valeu
function loadSettings(): Settings {
  try {
    // tira o BOM: editor ou PowerShell 5.1 gravando o arquivo o coloca, e aí o JSON.parse falha e os
    // ajustes do usuário somem em silêncio (visto num teste nosso em 2026-10-18)
    // arquivo sem o campo é de antes do Mac: percentual, sem migração (spec)
    const r = mergeSettings({ ...DEFAULTS, autoCareTrigger: 'percent' }, JSON.parse(readFileSync(settingsFile, 'utf8').replace(/^﻿/, '')));
    if (typeof r === 'string') throw new Error(r);
    settingsFrom = 'settings.json';
    settingsProblem = null;
    return r;
  } catch (e) {
    if (existsSync(settingsFile)) {
      settingsProblem = e instanceof Error ? e.message : 'o arquivo não pôde ser lido';
      settingsFrom = `padrões (settings.json recusado: ${settingsProblem})`;
    }
    return { ...DEFAULTS };
  }
}
function saveSettings(s: Settings) { writeAtomic(settingsFile, JSON.stringify(s, null, 2)); }
const RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  idleMinutes: [5, 600], busyCpuPercent: [1, 100], sampleSeconds: [1, 60],
  autoCareThreshold: [50, 99], autoCareCooldownMinutes: [1, 240],
  staleDays: [7, 3650], staleMinMB: [1, 100_000],
};
const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  warningsLevel: ['todos', 'criticos'], agentProvider: ['claude', 'gpt'],
  autoCareTrigger: ['percent', 'pressure'], autoCarePressure: ['warn', 'critical'],
};
const BOOLS: readonly (keyof Settings)[] = ['autoCareEnabled', 'watchEnabled'];
/** Valida um PUT parcial; devolve o ajuste completo ou uma mensagem de erro. */
export function mergeSettings(current: Settings, patch: unknown): Settings | string {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'corpo inválido';
  const next: Settings = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, k)) return `campo desconhecido: ${k}`;
    const key = k as keyof Settings;
    const range = RANGES[key];
    if (range) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < range[0] || v > range[1]) return `${k} fora da faixa ${range[0]}–${range[1]}`;
      (next[key] as number) = v;
    } else if (BOOLS.includes(key)) {
      if (typeof v !== 'boolean') return `${k} deve ser verdadeiro ou falso`;
      (next[key] as boolean) = v;
    } else if (ENUMS[key]) {
      if (typeof v !== 'string' || !ENUMS[key]!.includes(v)) return `${k} deve ser um de: ${ENUMS[key]!.join(', ')}`;
      (next[key] as string) = v;
    } else {
      if (!Array.isArray(v) || v.length > 200 || !v.every(x => typeof x === 'string' && x.length > 0 && x.length < 128)) return `${k} deve ser uma lista de nomes`;
      (next[key] as string[]) = v.map(x => x.trim().toLowerCase().replace(/\.exe$/, ''));
    }
  }
  return next;
}
let settings = loadSettings();

// ---------- estado vivo ----------
// testes: FOLGA_STARTED_AT no passado faz os apps já nascerem parados (sem esperar idleMinutes)
const startedAt = Number(process.env.FOLGA_STARTED_AT) || Date.now();
let history: ClassifyHistory = emptyHistory();
let lastSnap: ProbeSnapshot | null = null;
let samples: Sample[] = [];
let state: MemoryState | null = null;
let lastFreshAt = 0;   // hora da última leitura NOVA da sonda (releitura re-carimba state.t, isto não)
const extraSelfPids = new Set<number>();   // janela do Edge (F-08)
const sse = new Set<ServerResponse>();
const snapshotListeners: ((s: MemoryState) => void)[] = [];

/** PIDs do próprio app: este Node, a sonda e a árvore de filhos deles. */
function selfPids(snap: ProbeSnapshot): number[] {
  const roots = new Set<number>([process.pid, ...extraSelfPids]);
  const probePid = probe.pid();
  if (probePid) roots.add(probePid);
  const children = new Map<number, number[]>();
  for (const p of snap.processes) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const out = new Set<number>();
  const walk = (pid: number) => { if (out.has(pid)) return; out.add(pid); for (const c of children.get(pid) ?? []) walk(c); };
  for (const r of roots) walk(r);
  return [...out];
}

// R13: roda aqui no servidor, com ou sem janela. ponytail: lastRunAt/freio só em memória (somem ao reiniciar).
let ac = emptyAutoCare();
function runAutoCare(keys: string[]) {
  ac.running = true;
  releaser.release(keys, 'auto')
    .then(r => !('erro' in r), () => true)   // erro de pedido (409/503) não conta; falha no meio conta, já pode ter fechado algo
    .then(ran => { ac = finishRun(ac, ran, settings.autoCareCooldownMinutes, Date.now()); if (lastSnap) onSnapshot(lastSnap); });
}

/** fresh = leitura nova da sonda; releituras do mesmo snapshot (ajuste, liberação) não contam para o Auto Care. */
function onSnapshot(snap: ProbeSnapshot, fresh = false) {
  lastSnap = snap;
  if (fresh) lastFreshAt = Date.now();
  const userSession = snap.processes.find(p => p.pid === process.pid)?.session ?? 1;
  const now = Date.now();
  const r = classify(snap, history, settings, { selfPids: selfPids(snap), userSession, startedAt, now });
  if (fresh) history = r.history;   // releitura do mesmo snapshot não pode gerar amostra de CPU zerada
  if (fresh) samples = pushSample(samples, { t: snap.t, mem: snap.memLoad, disk: snap.diskActive ?? null });
  state = {
    t: now, memLoad: snap.memLoad, totalPhys: snap.totalPhys, availPhys: snap.availPhys,
    apps: r.apps, freed: releaser.freed(), settings, startedAt,
    autoCare: { nextEligibleAt: null, lastRunAt: null }, samples,
    memPressure: snap.memPressure, swapUsed: snap.swapUsed,
  };
  if (fresh) {
    const d = decide({ ...ac, running: ac.running || releaser.isBusy() }, state, settings, now);
    ac = { ...d.mem, running: ac.running };
    if (d.keys) runAutoCare(d.keys);
  }
  state.autoCare = { nextEligibleAt: ac.nextEligibleAt, lastRunAt: ac.lastRunAt };
  // só leitura nova acorda quem espera (a liberação confere o mundo real); cópia porque o ouvinte se remove
  if (fresh) for (const fn of [...snapshotListeners]) fn(state);
  const line = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const res of sse) res.write(line);
}

const probeArgs = (): [string, string[]] => {
  const fake = process.env.FOLGA_FAKE_PROBE;   // testes: script node que imita a sonda
  const interval = String(Math.round(Number(settings.sampleSeconds)) || 2);   // vai no -Command do PowerShell: só número
  if (fake) return [process.execPath, [fake, '--interval', interval]];
  if (process.platform === 'darwin') return [join(ROOT, 'probe', 'bin', 'probe-mac'), ['--interval', interval]];
  // .exe compilado: só com FOLGA_PROBE_EXE=1, porque o antivírus apaga exe sem assinatura (ADR 0002)
  if (process.env.FOLGA_PROBE_EXE === '1') return [join(ROOT, 'probe', 'bin', 'probe.exe'), ['--interval', interval]];
  // Padrão: o mesmo probe.cs compilado em memória pelo Add-Type do PowerShell 5.1 (~32 MB)
  const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const cs = join(ROOT, 'probe', 'probe.cs').replaceAll("'", "''");
  return [ps, ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Path '${cs}'; [Probe]::Main(@('--interval','${interval}'))`]];
};
const [probeCmd, probeArgv] = probeArgs();
let probeUp = false;
const probe = startProbe(probeCmd, probeArgv, s => onSnapshot(s, true), alive => { probeUp = alive; });

const releaser = createReleaser({
  dataDir: DATA_DIR,
  probe,
  getState: () => state,
  getSettings: () => settings,
  closeWaitMs: Number(process.env.FOLGA_CLOSE_WAIT_MS) || undefined,     // testes encurtam as esperas
  measureWaitMs: Number(process.env.FOLGA_MEASURE_WAIT_MS) || undefined,
  waitForSnapshot: () => new Promise(resolve => {
    const fn = (s: MemoryState) => { snapshotListeners.splice(snapshotListeners.indexOf(fn), 1); resolve(s); };
    snapshotListeners.push(fn);
  }),
});

// ---------- v2: avisos, arquivos, sugestões, agente (cada módulo recebe só o que usa) ----------
const emit: Emit = (event, data) => {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sse) res.write(line);
};
const warnings = createWarnings({
  getState: () => state, getSettings: () => settings, probeAlive: () => probeUp,
  lastAutoCareRun: () => ac.lastRunAt, emit, settingsProblem: () => settingsProblem,
});
/** Apps abertos, para apagar cache: só com sonda viva e leitura nova (3 intervalos, mín. 10 s). Senão null = tratar tudo como aberto. */
const runningKeys = () => (state && probeUp && Date.now() - lastFreshAt <= freshWindowMs(settings.sampleSeconds)
  ? new Set(state.apps.map(a => a.key)) : null);
const files = createFiles({
  getSettings: () => settings, roots: process.env.FOLGA_FILES_ROOTS?.split(';'),   // testes: pastas no lugar das do usuário
  runningKeys,                                                                      // Mac: navegador aberto pela sonda
});
// FOLGA_APPDATA_BASES (testes e verificação ao vivo): JSON { "appSupport": "/tmp/…", … }. Ele SUBSTITUI as bases
// padrão (não mescla): a base que o teste não listar não é lida. Torto (JSON quebrado, null, lista, base desconhecida,
// caminho relativo) → não sobe: nunca cai nas pastas reais nem em '/'.
const appData = createAppData({
  runningKeys,
  bases: process.env.FOLGA_APPDATA_BASES ? parseAppDataBases(process.env.FOLGA_APPDATA_BASES) : undefined,
});
const suggestions = createSuggestions({
  dataDir: DATA_DIR, files, getState: () => state, emit, appData,
  release: async keys => { const r = await releaser.release(keys, 'manual'); if (lastSnap) onSnapshot(lastSnap); return r; },
});
const agent = createAgent({
  dataDir: DATA_DIR, port: PORT, emit, selfPids: extraSelfPids,
  addSuggestion: draft => suggestions.add(draft, 'agente'),
});
// R30: o vigia propõe sozinho; quem executa continua sendo o clique do usuário em suggestions.approve
const notify = createNotify({ port: PORT });
const watch = createWatch({
  getState: () => state, getSettings: () => settings,
  disks: () => warnings.disk(), quickClean: () => files.quickCleanPreview(),
  listSuggestions: () => suggestions.list(), propose: draft => suggestions.add(draft, 'vigia'),
  notify: (title, body) => notify.toast(title, body),
  checkMs: Number(process.env.FOLGA_WATCH_MS) || undefined,   // testes encurtam o ciclo
});
warnings.start();
watch.start();

// ---------- HTTP ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

// M1: nenhuma página nossa pode ser colocada num iframe de outro site (clickjacking). style-src com 'unsafe-inline'
// porque o React usa o atributo style; os scripts do Vite são módulos em /assets, então script-src fica 'self'.
const SECURITY_HEADERS: Record<string, string> = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new Error('corpo grande demais');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

async function serveStatic(pathname: string, res: ServerResponse) {
  let rel: string;
  try { rel = normalize(decodeURIComponent(pathname)).replace(/^([\\/])+/, ''); }   // %, %E0%A4%A… lançam URIError
  catch { return send(res, 400, { erro: 'endereço inválido' }); }
  let file = join(DIST, rel);
  if (!file.startsWith(DIST + sep) && file !== DIST) return send(res, 404, { erro: 'não encontrado' });
  if (!extname(file) || !existsSync(file)) file = join(DIST, 'index.html');   // SPA
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { erro: 'interface não compilada; rode npm run build' });
  }
}

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);   // vale para send(), arquivos e SSE
  try {
    // R15: só 127.0.0.1/localhost (barra DNS rebinding)
    if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return send(res, 403, { erro: 'host não permitido' });
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (!path.startsWith('/api/')) return method === 'GET' ? await serveStatic(path, res) : send(res, 405, { erro: 'método' });   // await: erro assíncrono cai no catch daqui

    // outro site disparando a requisição (ex.: uma imagem de outro site apontando para uma GET cara): o navegador avisa em Sec-Fetch-Site
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { erro: 'origem não permitida' });

    // R16: escrita só com JSON e token. O agent-token vale só na varredura de arquivos.
    if (method === 'POST' || method === 'PUT') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { erro: 'use application/json' });
      const given = req.headers['x-folga-token'];
      const agentScan = method === 'POST' && path === '/api/files/scan' && given === AGENT_TOKEN;
      if (given !== TOKEN && !agentScan) return send(res, 403, { erro: 'token inválido' });
    }

    if (method === 'GET' && path === '/api/token') return send(res, 200, { token: TOKEN });   // sem CORS: outro site não lê
    if (method === 'GET' && path === '/api/state') return state ? send(res, 200, state) : send(res, 503, { erro: 'lendo…' });
    if (method === 'GET' && path === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': ok\n\n');
      if (state) res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      sse.add(res);
      req.on('close', () => sse.delete(res));
      return;
    }
    if (method === 'GET' && path === '/api/settings') return send(res, 200, settings);
    if (method === 'PUT' && path === '/api/settings') {
      const merged = mergeSettings(settings, await readJson(req));
      if (typeof merged === 'string') return send(res, 400, { erro: merged });
      // a sonda do Windows não lê pressão de memória: o Auto Care por pressão nunca dispararia
      if (process.platform === 'win32' && merged.autoCareTrigger === 'pressure') {
        return send(res, 400, { erro: 'Auto Care por pressão de memória só existe no Mac; no Windows use o percentual' });
      }
      settings = merged;
      saveSettings(settings);
      // R34: acabamos de gravar um arquivo válido, então o aviso "seus ajustes não foram lidos" perdeu a
      // razão de existir. Sem isto, salvar em Ajustes — que é o que o próprio aviso manda fazer — não o tirava.
      if (settingsProblem !== null) {
        settingsProblem = null;
        settingsFrom = 'settings.json';
        void warnings.run.fast();   // tira o aviso agora, sem esperar o ciclo de 30 s
      }
      if (lastSnap) onSnapshot(lastSnap);   // reclassifica já com o ajuste novo
      return send(res, 200, settings);
    }
    if (method === 'POST' && path === '/api/release') {
      const body = await readJson(req) as { keys?: unknown };
      const keys = body?.keys;
      if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100 || !keys.every(k => typeof k === 'string')) {
        return send(res, 400, { erro: 'keys deve ser uma lista de apps' });
      }
      const r = await releaser.release(keys as string[], 'manual');
      if ('erro' in r) return send(res, r.status, { erro: r.erro });
      if (lastSnap) onSnapshot(lastSnap);
      return send(res, 200, r);
    }
    if (method === 'POST' && path === '/api/window') {
      return showWindow() ? send(res, 200, { ok: true }) : send(res, 500, { erro: 'Edge não encontrado' });
    }
    if (method === 'GET' && path === '/api/startup') return send(res, 200, { on: startupInstalled() });
    if (method === 'PUT' && path === '/api/startup') {
      const body = await readJson(req) as { on?: unknown };
      if (typeof body?.on !== 'boolean') return send(res, 400, { erro: 'on deve ser verdadeiro ou falso' });
      return send(res, 200, { on: await setStartup(body.on, ROOT) });
    }
    if (method === 'GET' && path === '/api/log') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 1000);
      return send(res, 200, await releaser.readLog(limit));
    }

    // ----- v2: avisos (F-15) -----
    if (method === 'GET' && path === '/api/warnings') return send(res, 200, warnings.list());
    if (method === 'GET' && path === '/api/disk') return send(res, 200, await warnings.disk());
    if (method === 'GET' && path === '/api/startup-apps') return send(res, 200, await warnings.startupApps());

    // ----- v2: arquivos e sugestões (F-17) -----
    if (method === 'GET' && path === '/api/files/stale') return send(res, 200, files.last());
    if (method === 'POST' && path === '/api/files/scan') {
      const body = (await readJson(req) ?? {}) as { olderThanDays?: unknown; minMB?: unknown };
      const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
      return send(res, 200, await files.scan({ olderThanDays: num(body.olderThanDays, 7, 3650), minMB: num(body.minMB, 1, 100_000) }));
    }
    if (method === 'GET' && path === '/api/quickclean') return send(res, 200, await files.quickCleanPreview());
    if (method === 'GET' && path === '/api/appdata') return send(res, 200, await appData.preview());
    if (method === 'GET' && path === '/api/suggestions') return send(res, 200, suggestions.list());
    if (method === 'POST' && path === '/api/suggestions') {
      const r = await suggestions.add(await readJson(req) as SuggestionDraft, 'folga');
      return 'erro' in r ? send(res, r.status, { erro: r.erro }) : send(res, 200, r);
    }
    const sug = path.match(/^\/api\/suggestions\/([\w-]{1,64})\/(approve|ignore)$/);
    if (method === 'POST' && sug) {
      const r = sug[2] === 'approve' ? await suggestions.approve(sug[1]!) : suggestions.ignore(sug[1]!);
      return 'erro' in r ? send(res, r.status, { erro: r.erro }) : send(res, 200, r);
    }

    // ----- v2: assistente (F-18) -----
    if (method === 'GET' && path === '/api/agent') return send(res, 200, agent.conversation());
    if (method === 'POST' && path === '/api/agent/message') {
      const body = await readJson(req) as { provider?: unknown; text?: unknown };
      if (body?.provider !== 'claude' && body?.provider !== 'gpt') return send(res, 400, { erro: 'provider deve ser claude ou gpt' });
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) return send(res, 400, { erro: 'mensagem vazia ou longa demais' });
      const r = await agent.send(body.provider as AgentProvider, body.text);
      return 'erro' in r ? send(res, r.status, { erro: r.erro }) : send(res, 202, r);
    }
    if (method === 'POST' && path === '/api/agent/reset') return send(res, 200, agent.reset());
    if (method === 'POST' && path === '/api/agent/stop') { agent.stop(); return send(res, 200, { ok: true }); }

    return send(res, 404, { erro: 'rota' });
  } catch {
    // R17: sem caminho, pilha ou detalhe interno
    if (!res.headersSent) send(res, 500, { erro: 'erro interno' });
    else res.end();
  }
});

// rede de segurança: uma rejeição esquecida não derruba o servidor (Node 24 encerraria o processo); só o nome do erro
process.on('unhandledRejection', e => console.error('rejeição não tratada:', e instanceof Error ? e.name : typeof e));

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `porta ${PORT} ocupada` : 'erro no servidor');
  probe.stop();
  process.exitCode = 1;
});

/** Abre a janela do Edge e põe a árvore dela entre os PIDs do próprio app (R05). */
function showWindow(): boolean {
  const pid = openWindow(`http://127.0.0.1:${PORT}`, DATA_DIR, gone => extraSelfPids.delete(gone));
  if (pid) extraSelfPids.add(pid);
  return pid !== null;
}

server.listen(PORT, '127.0.0.1', () => {
  // uma linha por início: no logon é a única testemunha do que o servidor leu (R32)
  console.log(`[${new Date().toISOString()}] Folga em http://127.0.0.1:${PORT} | dados em ${DATA_DIR} | ajustes de ${settingsFrom} | Auto Care ${settings.autoCareEnabled ? `em ${settings.autoCareThreshold} %` : 'desligado'}`);
  if (process.env.FOLGA_OPEN_WINDOW === '1') showWindow();
});

const shutdown = () => {
  warnings.stop();
  agent.stop();
  probe.stop();
  for (const res of sse) res.end();
  server.close();
  setTimeout(() => process.exit(0), 1_500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
