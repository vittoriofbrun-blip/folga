// F-15: monitor de avisos (D15, R26), discos e apps de inicialização. Só leitura.
import { spawn, type ChildProcess } from 'node:child_process';
import { open, readdir, stat, statfs as fsStatfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse } from 'node:path';
import { macHelper } from './platform.ts';
import type { DiskInfo, Emit, MemoryState, Settings, StartupApp, Severity, View, Warning, WarningKind } from './types.ts';

export type WarningsDeps = {
  getState: () => MemoryState | null;
  getSettings: () => Settings;
  probeAlive: () => boolean;
  lastAutoCareRun: () => number | null;
  settingsProblem: () => string | null;   // R34: null = os ajustes vieram do settings.json
  emit: Emit;
  // opcionais, só para testes: o servidor passa apenas os obrigatórios
  exec?: (file: string, args: string[]) => Promise<string>;
  now?: () => number;
  platform?: NodeJS.Platform;
  macVolume?: () => Promise<unknown | null>;   // sonda --volume; injetável nos testes
  statfs?: (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  startupFolder?: string;
  crashDir?: string;   // Mac: padrão ~/Library/Logs/DiagnosticReports
};

const FAST_MS = 30_000;            // memória, disco, Auto Care
const PROBE_MS = 5_000;            // sonda (sem spawn; só para o limite de 30 s ser preciso)
const CRASH_MS = 10 * 60_000;
const AV_MS = 30 * 60_000;
const PROBE_DOWN_MS = 30_000;
const AUTOCARE_SHOWN_MS = 60 * 60_000;
const STARTUP_CACHE_MS = 5 * 60_000;
const MEM_CRITICAL = 97;
const DISK_ATTENTION = 10;
const DISK_CRITICAL = 5;

const SYSROOT = () => process.env.SystemRoot ?? 'C:\\Windows';
const PS = () => join(SYSROOT(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const CMD = () => join(SYSROOT(), 'System32', 'cmd.exe');
const REG = () => join(SYSROOT(), 'System32', 'reg.exe');
const U8 = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;';

// Scripts fixos: nenhum dado entra neles. Application Error (1000) e Application Hang (1002); sem filtrar o
// provedor, outros softwares que usam os mesmos Ids (ex.: serviços com Id 1000 = "iniciado") viram falso travamento.
const PS_CRASHES = U8 + "$e=@(Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='Application Error','Application Hang';Id=1000,1002;StartTime=(Get-Date).AddHours(-24)} -MaxEvents 50 -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{id=$_.Id;app=[string]$_.Properties[0].Value} }); ConvertTo-Json -InputObject $e -Compress";
const PS_AV = U8 + "ConvertTo-Json -InputObject @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | Select-Object displayName,productState) -Compress";

// ---------------------------------------------------------------- funções puras (testadas)

/** productState do SecurityCenter2: bits 12-15 = produto ativo (1); bits 4-7 = definições em dia (0). */
export function decodeAvState(state: number) {
  return { active: ((state >> 12) & 0xF) === 1, upToDate: ((state >> 4) & 0xF) === 0 };
}

export type AvProduct = { displayName: string; productState: number };
export function parseAv(json: string): AvProduct[] {
  const raw: unknown = json.trim() ? JSON.parse(json) : [];
  return (Array.isArray(raw) ? raw : [raw]).flatMap(p => {
    const o = p as { displayName?: unknown; productState?: unknown } | null;
    return o && typeof o.displayName === 'string' && typeof o.productState === 'number'
      ? [{ displayName: o.displayName, productState: o.productState }] : [];
  });
}

type Candidate = Omit<Warning, 'firstSeen' | 'lastSeen' | 'active'> & { since?: number };
const cand = (kind: WarningKind, id: string, severity: Severity, title: string, detail: string, view?: View, since?: number): Candidate =>
  ({ id, kind, severity, title, detail, ...(view ? { view } : {}), ...(since ? { since } : {}) });

/** Aviso só se nenhum produto está ativo, ou se nenhum ativo está com as definições em dia. */
export function avWarning(products: AvProduct[]): Candidate | null {
  const active = products.filter(p => decodeAvState(p.productState).active);
  if (!active.length) {
    return cand('antivirus', 'antivirus', 'critico', 'Antivírus desligado',
      products.length ? `Nenhum antivírus está ativo (${products.map(p => p.displayName).join(', ')}).` : 'O Windows não encontrou nenhum antivírus.');
  }
  if (!active.some(p => decodeAvState(p.productState).upToDate)) {
    return cand('antivirus', 'antivirus', 'critico', 'Antivírus desatualizado',
      `${active[0]?.displayName ?? 'O antivírus'} está com as definições antigas.`);
  }
  return null;
}

/** Nome vindo de arquivo/log: sem controle nem quebra de linha, até 80 caracteres. */
export function cleanName(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Um aviso por app (id com o nome em minúsculo), com a contagem de travamentos. */
export function crashCandidates(names: string[]): Candidate[] {
  const byApp = new Map<string, { name: string; n: number }>();
  for (const name of names) {
    if (!name) continue;
    const cur = byApp.get(name.toLowerCase());
    if (cur) cur.n++; else byApp.set(name.toLowerCase(), { name, n: 1 });
  }
  return [...byApp].map(([key, { name, n }]) =>
    cand('travamento', `travamento:${key}`, 'atencao', `${name} travou`,
      `Travou ${n === 1 ? '1 vez' : `${n} vezes`} nas últimas 24 h.`));
}

/** Saída do Get-WinEvent → um aviso por app (nome sem .exe, minúsculo no id). */
export function parseCrashes(json: string): Candidate[] {
  const raw: unknown = json.trim() ? JSON.parse(json) : [];
  const names: string[] = [];
  for (const e of Array.isArray(raw) ? raw : [raw]) {
    const app = (e as { app?: unknown } | null)?.app;
    if (typeof app === 'string') names.push(app.trim().replace(/\.exe$/i, ''));
  }
  return crashCandidates(names);
}

// bug_type de travamento nos .ips: só os vistos em relatório real deste Mac. 309 = crash de processo (node, 21/10/2026).
// Outro tipo só entra aqui com fixture real ao lado.
const MAC_CRASH_TYPES = new Set(['309']);
const DAY_MS = 24 * 60 * 60_000;
const CRASH_FILES = 50;
const CRASH_HEAD = 4096;

/** Primeira linha de um .ips: um JSON com app_name e bug_type. Qualquer outra coisa = null. */
export function parseIpsHeader(firstLine: string): { app: string; bugType: string } | null {
  try {
    const o = JSON.parse(firstLine) as { app_name?: unknown; name?: unknown; bug_type?: unknown } | null;
    const app = typeof o?.app_name === 'string' && o.app_name ? o.app_name : o?.name;
    if (typeof app !== 'string' || !app || typeof o?.bug_type !== 'string') return null;
    return { app, bugType: o.bug_type };
  } catch { return null; }
}

/** Formato antigo (.crash): linha "Process:   Nome [pid]". */
export function parseCrashText(text: string): string | null {
  const m = /^Process:\s+(.+?)\s+\[\d+\]\s*$/m.exec(text);
  return m ? m[1]! : null;
}

/** Relatórios de até 24 h → um aviso por app. `file` com "/" (Retired/…) e extensões fora de .ips/.crash ficam de fora. */
export function macCrashes(entries: { file: string; mtimeMs: number; head: string }[], now: number): Candidate[] {
  const names: string[] = [];
  for (const e of entries) {
    if (e.file.includes('/') || now - e.mtimeMs > DAY_MS) continue;
    let app: string | null = null;
    if (e.file.endsWith('.ips')) {
      const h = parseIpsHeader(e.head.split('\n')[0] ?? '');
      if (h && MAC_CRASH_TYPES.has(h.bugType)) app = h.app;
    } else if (e.file.endsWith('.crash')) app = parseCrashText(e.head);
    const name = app === null ? '' : cleanName(app);
    if (name) names.push(name);
  }
  return crashCandidates(names);
}

/** Lê os relatórios mais novos da pasta (só o nível de cima, sem `Retired`). Pasta ilegível = lança: os avisos ficam. */
export async function readCrashEntries(dir: string, now: number): Promise<{ file: string; mtimeMs: number; head: string }[]> {
  const found: { file: string; mtimeMs: number }[] = [];
  for (const file of await readdir(dir)) {
    if (!/\.(ips|crash)$/.test(file)) continue;
    try {
      const st = await stat(join(dir, file));
      if (st.isFile() && now - st.mtimeMs <= DAY_MS) found.push({ file, mtimeMs: st.mtimeMs });
    } catch { /* sumiu entre o readdir e o stat */ }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const out: { file: string; mtimeMs: number; head: string }[] = [];
  for (const f of found.slice(0, CRASH_FILES)) {
    try {
      const fh = await open(join(dir, f.file), 'r');
      try {
        const buf = Buffer.alloc(CRASH_HEAD);
        const { bytesRead } = await fh.read(buf, 0, CRASH_HEAD, 0);
        out.push({ ...f, head: buf.toString('utf8', 0, bytesRead) });
      } finally { await fh.close(); }
    } catch { /* arquivo ilegível: pula só ele */ }
  }
  return out;
}

export const defaultCrashDir = () => join(homedir(), 'Library', 'Logs', 'DiagnosticReports');

const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const hm = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const GB = 1024 ** 3;

export function memoryWarning(memLoad: number, threshold: number): Candidate | null {
  if (memLoad < Math.min(threshold, MEM_CRITICAL)) return null;
  const critical = memLoad >= MEM_CRITICAL;
  return cand('memoria', 'memoria', critical ? 'critico' : 'atencao',
    critical ? 'Memória quase esgotada' : 'Memória alta',
    `${nf0.format(memLoad)} % da memória está em uso.`, 'memoria');
}

/** Disco do Mac: livre = o que o statfs diz (nunca somado ao purgeable); purgeable = o que o macOS libera sozinho. */
export function macDiskInfo(sf: { bsize: number; blocks: number; bavail: number }, vol: { name: string; important: number } | null): DiskInfo {
  const total = sf.bsize * sf.blocks, free = sf.bsize * sf.bavail;
  return vol ? { drive: vol.name, total, free, purgeable: Math.max(0, vol.important - free) } : { drive: 'Mac', total, free };
}

export function diskWarning(d: DiskInfo): Candidate | null {
  if (!(d.total > 0)) return null;
  const freePct = (d.free / d.total) * 100;
  if (freePct >= DISK_ATTENTION) return null;
  const critical = freePct < DISK_CRITICAL;
  return cand('disco', `disco:${d.drive}`, critical ? 'critico' : 'atencao',
    critical ? `Disco ${d.drive} quase cheio` : `Pouco espaço no disco ${d.drive}`,
    `${nf1.format(d.free / GB)} GB livres de ${nf1.format(d.total / GB)} GB (${nf1.format(freePct)} % livre).`, 'arquivos');
}

/**
 * R34: os ajustes salvos não foram lidos e o Folga está nos padrões. Crítico porque é silencioso e tira
 * proteções que o usuário escolheu: o Auto Care volta a desligado e as listas de "nunca fechar" somem.
 */
export function settingsWarning(problem: string | null): Candidate | null {
  if (!problem) return null;
  return cand('ajustes', 'ajustes', 'critico', 'Seus ajustes não foram lidos',
    `O Folga está com os padrões de fábrica: ${problem}. Abra Ajustes, confira e salve de novo.`, 'ajustes');
}

export function autoCareWarning(lastRun: number | null, now: number): Candidate | null {
  if (lastRun === null || now - lastRun >= AUTOCARE_SHOWN_MS) return null;
  return cand('autocare', 'autocare', 'info', `O Auto Care liberou memória às ${hm.format(lastRun)}`,
    'Ele fechou apps parados para abrir espaço. Veja o que saiu no Registro.', 'registro', lastRun);
}

/** reg.exe query: linhas "    Nome    REG_SZ    dado". Nome pode ter espaços; tipo REG_* delimita. */
export function parseRegQuery(text: string): { name: string; type: string; data: string }[] {
  const out: { name: string; type: string; data: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s+(.+?)\s+(REG_[A-Z_]+)(?:\s+(.*))?$/.exec(line);
    if (m) out.push({ name: m[1]!, type: m[2]!, data: (m[3] ?? '').trim() });
  }
  return out;
}

/** StartupApproved: primeiro byte com o bit baixo ligado (03, 07) = desativado; 02/06 = ativo. */
export function approvedEnabled(hex: string | undefined): boolean {
  if (!hex || hex.length < 2) return true;
  const b = parseInt(hex.slice(0, 2), 16);
  return Number.isNaN(b) ? true : (b & 1) === 0;
}

// ---------------------------------------------------------------- monitor

const RANK: Record<Severity, number> = { critico: 0, atencao: 1, info: 2 };
const RUN = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPR = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\';
const REG_SOURCES: { key: string; approved: string; source: StartupApp['source'] }[] = [
  { key: `HKCU\\${RUN}`, approved: `HKCU\\${APPR}Run`, source: 'registro_usuario' },
  { key: `HKLM\\${RUN}`, approved: `HKLM\\${APPR}Run`, source: 'registro_maquina' },
  { key: `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run`, approved: `HKLM\\${APPR}Run32`, source: 'registro_maquina' },
];

export function createWarnings(deps: WarningsDeps) {
  const now = deps.now ?? Date.now;
  const children = new Set<ChildProcess>();
  let stopped = false;   // só stop() liga; apply() antes de start() vale (testes chamam run.* direto)
  const timers: NodeJS.Timeout[] = [];
  const busy = new Set<string>();
  const active = new Map<string, Warning>();
  let lastSig = '';
  let downSince: number | null = null;
  let startupCache: { t: number; apps: StartupApp[] } | null = null;

  // Padrão: spawn com caminho absoluto, shell:false, sem janela. stop() mata o que estiver rodando.
  const exec = deps.exec ?? ((file: string, args: string[]) => new Promise<string>((resolve, reject) => {
    const c = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    children.add(c);
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => c.kill(), 20_000);
    timeout.unref();
    c.stdout.on('data', (d: Buffer) => chunks.push(d));
    c.on('error', e => { clearTimeout(timeout); children.delete(c); reject(e); });
    c.on('close', code => {
      clearTimeout(timeout); children.delete(c);
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
      else reject(new Error(`saiu com ${code}`));
    });
  }));
  const statfs = deps.statfs ?? ((p: string) => fsStatfs(p));
  const ps = (script: string) => exec(PS(), ['-NoProfile', '-NonInteractive', '-Command', script]);
  // cmd + chcp 65001: sem isso o reg.exe escreve em cp850 e "Antônio" sai errado. Chaves fixas, sem espaços.
  const regQuery = (key: string) => exec(CMD(), ['/d', '/c', 'chcp', '65001', '>nul', '&', REG(), 'query', key]).catch(() => '');

  function list(): Warning[] {
    return [...active.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.lastSeen - a.lastSeen);
  }

  // R26: id estável; mesmo aviso só atualiza lastSeen; causa que some sai da lista; emite só se algo visível mudou.
  function apply(kind: WarningKind, found: (Candidate | null)[]) {
    if (stopped) return;
    const t = now();
    const keep = new Set<string>();
    for (const c of found) {
      if (!c) continue;
      const { since, ...w } = c;
      keep.add(w.id);
      active.set(w.id, { ...w, firstSeen: since ?? active.get(w.id)?.firstSeen ?? t, lastSeen: t, active: true });
    }
    for (const [id, w] of active) if (w.kind === kind && !keep.has(id)) active.delete(id);
    const sig = [...active.values()].map(w => `${w.id}|${w.severity}|${w.title}|${w.detail}`).sort().join('\n');
    if (sig !== lastSig) { lastSig = sig; deps.emit('warnings', list()); }
  }

  // --volume é caro e o aviso roda a cada minuto: guarda 10 min
  let volAt = 0;
  let vol: { name: string; important: number } | null = null;
  async function disk(): Promise<DiskInfo[]> {
    if ((deps.platform ?? process.platform) === 'darwin') {
      // statfs do volume de dados (o home), não do "/" lacrado
      let s;
      try { s = await statfs(homedir()); } catch { return []; }
      if (now() - volAt > 10 * 60_000) {
        const r = await (deps.macVolume ?? (() => macHelper(['--volume', homedir()], null, 15_000)))() as { name?: unknown; important?: unknown } | null;
        // falha da sonda mantém o último valor bom (o nome do disco entra no id do aviso) e tenta de novo na próxima leitura
        if (r && typeof r.name === 'string' && typeof r.important === 'number') { vol = { name: r.name, important: r.important }; volAt = now(); }
      }
      return [macDiskInfo(s, vol)];
    }
    const sys = (process.env.SystemDrive ?? 'C:').toUpperCase();
    const profile = parse(homedir()).root.replace(/\\$/, '').toUpperCase();
    const drives = [...new Set([sys, profile].filter(d => /^[A-Z]:$/.test(d)))];
    const out: DiskInfo[] = [];
    for (const drive of drives) {
      try {
        const s = await statfs(`${drive}\\`);
        out.push({ drive, total: s.bsize * s.blocks, free: s.bsize * s.bavail });
      } catch { /* disco sumiu/sem acesso: fica de fora */ }
    }
    return out;
  }

  const job = (name: string, fn: () => Promise<void> | void) => async () => {
    if (busy.has(name)) return;
    busy.add(name);
    try { await fn(); } catch { /* falha de consulta não muda os avisos que já existem */ } finally { busy.delete(name); }
  };

  const run = {
    probe: job('probe', () => {
      const t = now();
      if (deps.probeAlive()) downSince = null; else downSince ??= t;
      apply('sonda', [downSince !== null && t - downSince > PROBE_DOWN_MS
        ? cand('sonda', 'sonda', 'critico', 'A sonda parou de responder',
          'O Folga não está recebendo leituras de memória. Feche e abra o app.') : null]);
    }),
    fast: job('fast', async () => {
      const s = deps.getState();
      if (s) apply('memoria', [memoryWarning(s.memLoad, deps.getSettings().autoCareThreshold)]);
      apply('autocare', [autoCareWarning(deps.lastAutoCareRun(), now())]);
      apply('ajustes', [settingsWarning(deps.settingsProblem())]);
      const disks = await disk();
      if (disks.length) apply('disco', disks.map(diskWarning));
    }),
    crashes: job('crashes', async () => {
      if ((deps.platform ?? process.platform) === 'darwin') {
        const t = now();
        return apply('travamento', macCrashes(await readCrashEntries(deps.crashDir ?? defaultCrashDir(), t), t));
      }
      apply('travamento', parseCrashes(await ps(PS_CRASHES)));
    }),
    antivirus: job('antivirus', async () => apply('antivirus', [avWarning(parseAv(await ps(PS_AV)))])),
  };

  async function readStartupApps(): Promise<StartupApp[]> {
    const apps: StartupApp[] = [];
    const queries = await Promise.all(REG_SOURCES.map(async s => [s, await regQuery(s.key), await regQuery(s.approved)] as const));
    for (const [s, runText, apprText] of queries) {
      const approved = new Map(parseRegQuery(apprText).map(r => [r.name.toLowerCase(), r.data]));
      for (const r of parseRegQuery(runText)) {
        apps.push({ name: r.name, command: r.data, source: s.source, enabled: approvedEnabled(approved.get(r.name.toLowerCase())) });
      }
    }
    const folder = deps.startupFolder ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const approved = new Map(parseRegQuery(await regQuery(`HKCU\\${APPR}StartupFolder`)).map(r => [r.name.toLowerCase(), r.data]));
    for (const f of await readdir(folder).catch(() => [] as string[])) {
      if (!/\.(lnk|url)$/i.test(f)) continue;
      apps.push({ name: f.replace(/\.(lnk|url)$/i, ''), command: join(folder, f), source: 'pasta_inicializar', enabled: approvedEnabled(approved.get(f.toLowerCase())) });
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  return {
    start(): void {
      if (timers.length) return;
      stopped = false;
      const every = (fn: () => Promise<void>, ms: number) => { fn(); timers.push(setInterval(fn, ms).unref()); };
      every(run.probe, PROBE_MS);
      every(run.fast, FAST_MS);
      every(run.crashes, CRASH_MS);
      every(run.antivirus, AV_MS);
    },
    stop(): void {
      stopped = true;
      for (const t of timers.splice(0)) clearInterval(t);
      for (const c of children) c.kill();
      children.clear();
    },
    list,
    disk,
    async startupApps(): Promise<StartupApp[]> {
      if (startupCache && now() - startupCache.t < STARTUP_CACHE_MS) return startupCache.apps;
      const apps = await readStartupApps();
      startupCache = { t: now(), apps };
      return apps;
    },
    /** Um ciclo de cada fonte, direto (testes e script de verificação). */
    run,
  };
}
export type Warnings = ReturnType<typeof createWarnings>;
