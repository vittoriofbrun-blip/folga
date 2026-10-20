// Dados dos apps: mede cada pasta de dados de app; apaga de vez SÓ o cache recriável que uma entrada de
// CACHE_RULES produz, de app fechado (allowlist, R22). O resto aparece com tamanho e "o Folga não limpa".
// Segurança: o id que chega no clean nunca vira caminho; os alvos são recalculados das regras e de nomes lidos
// do disco, link nunca é seguido (o rm do Node apaga o link, não o alvo) e o dono é reconferido antes de cada rm.
import type { Stats } from 'node:fs';
import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { newBudget, walk } from './files.ts';
import type { AppDataEntry, AppDataItem, AppDataScan } from './types.ts';

export type AppDataBase = 'appSupport' | 'caches' | 'containers' | 'groupContainers' | 'localAppData' | 'roamingAppData';
export type CacheRule = {
  id: string; os: 'darwin' | 'win32'; label: string; base: AppDataBase; dir: string;   // '*' = cada pasta-filha
  owner: readonly string[] | 'folder'; profiles?: boolean; subdirs?: readonly string[]; versions?: readonly string[];
};

const CHROMIUM = ['Cache', 'Code Cache', 'GPUCache', 'GraphiteDawnCache', 'DawnWebGPUCache', 'ShaderCache'] as const;
const GPU = CHROMIUM.slice(2);   // Cache e Code Cache do Chrome/Edge são da limpeza rápida

// Pastas e bundle ids conferidos ao vivo em 20/10/2026. Fathom ficou de fora: a pasta existe, o app não está instalado.
export const CACHE_RULES: readonly CacheRule[] = [
  { id: 'claude', os: 'darwin', label: 'Claude', base: 'appSupport', dir: 'Claude', owner: ['com.anthropic.claudefordesktop'], subdirs: CHROMIUM, versions: ['claude-code', 'claude-code-vm'] },
  { id: 'code', os: 'darwin', label: 'VS Code', base: 'appSupport', dir: 'Code', owner: ['com.microsoft.vscode'], subdirs: [...CHROMIUM, 'CachedData'] },
  { id: 'miro', os: 'darwin', label: 'Miro', base: 'appSupport', dir: 'RealtimeBoard', owner: ['com.electron.realtimeboard'], subdirs: CHROMIUM },
  { id: 'chrome', os: 'darwin', label: 'Chrome', base: 'appSupport', dir: 'Google/Chrome', owner: ['com.google.chrome'], profiles: true, subdirs: GPU },
  { id: 'caches', os: 'darwin', label: 'Cache', base: 'caches', dir: '*', owner: 'folder' },
  { id: 'claude', os: 'win32', label: 'Claude', base: 'roamingAppData', dir: 'Claude', owner: ['claude'], subdirs: CHROMIUM, versions: ['claude-code'] },
  { id: 'code', os: 'win32', label: 'VS Code', base: 'roamingAppData', dir: 'Code', owner: ['code'], subdirs: [...CHROMIUM, 'CachedData'] },
  { id: 'chrome', os: 'win32', label: 'Chrome', base: 'localAppData', dir: 'Google/Chrome/User Data', owner: ['chrome'], profiles: true, subdirs: GPU },
  { id: 'edge', os: 'win32', label: 'Edge', base: 'localAppData', dir: 'Microsoft/Edge/User Data', owner: ['msedge'], profiles: true, subdirs: GPU },
];

const VM = 'Disco da máquina virtual do Claude: não é cache, o Folga não limpa.';
export const NOT_CACHE: readonly { os: 'darwin' | 'win32'; base: AppDataBase; path: string; text: string }[] = [
  { os: 'darwin', base: 'appSupport', path: 'Claude/vm_bundles', text: VM },
  { os: 'win32', base: 'roamingAppData', path: 'Claude/vm_bundles', text: VM },
];

const WHERE: Record<AppDataBase, string> = {
  appSupport: 'Suporte a Aplicativos', caches: 'Caches', containers: 'Contêineres', groupContainers: 'Contêineres de Grupo',
  localAppData: 'AppData Local', roamingAppData: 'AppData Roaming',
};
const PROFILE = /^(Default|Profile \d+|Guest Profile|System Profile)$/;
const BUNDLE_ID = /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i;
const NO_CACHE = 'Sem cache reconhecido: o Folga não limpa.';

/** Maior versão numérica (por parte); null se a lista for vazia ou algum nome não for versão. */
export function newestVersion(names: readonly string[]): string | null {
  if (!names.length || names.some(n => !/^\d+(\.\d+)*$/.test(n))) return null;
  const cmp = (a: string, b: string) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  return names.reduce((a, b) => (cmp(b, a) > 0 ? b : a));
}

/** Pasta de verdade: não é link, e o caminho montado é o próprio caminho real (nenhum pedaço dele é link). */
async function isRealDir(p: string) {
  try { const st = await lstat(p); return st.isDirectory() && !st.isSymbolicLink() && await realpath(p) === p; } catch { return false; }
}
/** Pastas-filhas (link fica de fora: Dirent de readdir não segue link). */
async function childDirs(p: string) {
  try { return (await readdir(p, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
}

type Target = AppDataItem & { owners: string[]; app: string; entry: string };

export function createAppData(deps: {
  platform?: NodeJS.Platform; bases?: Partial<Record<AppDataBase, string>>;
  runningKeys: () => ReadonlySet<string> | null; now?: () => number; maxEntries?: number; maxMs?: number;
}) {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;
  // ponytail: alocado, como o du; clone do APFS conta nas duas cópias
  const bytesOf = (st: Stats) => (process.platform === 'win32' ? st.size : st.blocks * 512);

  function defaultBases(): Partial<Record<AppDataBase, string>> {
    if (platform === 'darwin') {
      const lib = join(homedir(), 'Library');
      return { appSupport: join(lib, 'Application Support'), caches: join(lib, 'Caches'), containers: join(lib, 'Containers'), groupContainers: join(lib, 'Group Containers') };
    }
    if (platform === 'win32') return { localAppData: process.env.LOCALAPPDATA, roamingAppData: process.env.APPDATA };
    return {};
  }

  async function realBases() {
    const out: Array<[AppDataBase, string]> = [];
    for (const [k, v] of Object.entries(deps.bases ?? defaultBases()) as Array<[AppDataBase, string | undefined]>) {
      if (!v) continue;
      try { out.push([k, await realpath(v)]); } catch { /* não existe: fora */ }
    }
    return out;
  }

  /** Alvos que as regras produzem nesta máquina. Caminho = base real + dir da regra + nomes lidos do disco. */
  async function targets(bases: Map<AppDataBase, string>): Promise<Target[]> {
    const out: Target[] = [];
    const add = async (rule: CacheRule, b: string, rel: string[], owners: string[], app: string) => {
      const path = join(b, ...(rule.dir === '*' ? [] : rule.dir.split('/')), ...rel);
      if (!await isRealDir(path)) return;
      out.push({
        id: `${rule.id}:${rel.join('/')}`, label: `${app}: ${rel.join('/')}`, path, bytes: 0, files: 0, actionable: false,
        owners, app, entry: `${rule.base}:${rule.dir === '*' ? rel[0] : rule.dir.split('/')[0]}`,
      });
    };
    for (const rule of CACHE_RULES) {
      const b = bases.get(rule.base);
      if (rule.os !== platform || !b) continue;
      if (rule.dir === '*') {
        for (const n of await childDirs(b)) {
          // dono = a pasta e cada prefixo de bundle id dela: com.x.app.ShipIt é do com.x.app
          const parts = n.toLowerCase().split('.');
          const owners = parts.slice(2).map((_, i) => parts.slice(0, i + 3).join('.'));
          if (BUNDLE_ID.test(n) && !/^com\.apple\./i.test(n)) await add(rule, b, [n], owners, n);
        }
        continue;
      }
      if (rule.owner === 'folder') continue;
      const owners = [...rule.owner];
      const ruleDir = join(b, ...rule.dir.split('/'));
      if (!await isRealDir(ruleDir)) continue;
      const homes = rule.profiles ? (await childDirs(ruleDir)).filter(n => PROFILE.test(n)).map(n => [n]) : [[]];
      for (const h of homes) for (const s of rule.subdirs ?? []) await add(rule, b, [...h, s], owners, rule.label);
      for (const v of rule.versions ?? []) {
        if (!await isRealDir(join(ruleDir, v))) continue;
        const names = await childDirs(join(ruleDir, v));
        const newest = newestVersion(names);
        if (newest) for (const n of names) if (n !== newest) await add(rule, b, [v, n], owners, rule.label);
      }
    }
    return out;
  }

  async function collect(): Promise<{ scan: AppDataScan; byId: Map<string, Target> }> {
    const t0 = now();
    const bases = new Map(await realBases());
    const all = await targets(bases);
    const keys = deps.runningKeys();
    for (const t of all) {
      t.actionable = keys !== null && !t.owners.some(o => keys.has(o));
      if (!t.actionable) t.note = keys === null ? 'Ainda lendo os apps abertos: tente de novo' : `${t.app} aberto: feche para limpar`;
    }
    const budget = newBudget(deps.maxEntries ?? 500_000, deps.maxMs ?? 60_000, now);
    const entries: AppDataEntry[] = [];
    for (const [base, b] of bases) {
      for (const name of await childDirs(b)) {
        const path = join(b, name);
        const items = all.filter(t => t.entry === `${base}:${name}`);
        const nots = NOT_CACHE.filter(n => n.os === platform && n.base === base && n.path.split('/')[0] === name)
          .map(n => ({ text: n.text, path: join(b, ...n.path.split('/')), bytes: 0 }));
        const e: AppDataEntry = { id: `${base}:${name}`, name, where: WHERE[base], bytes: 0, items: [], notes: [] };
        await walk(path, 64, null, budget, (p, st) => {
          const n = bytesOf(st);
          e.bytes += n;
          for (const t of items) if (p.startsWith(t.path + sep)) { t.bytes += n; t.files++; }
          for (const x of nots) if (p.startsWith(x.path + sep)) x.bytes += n;
        });
        e.items = items.map(({ owners: _o, app: _a, entry: _e, ...i }) => i);
        e.notes = nots.filter(x => x.bytes > 0).map(({ text, bytes }) => ({ text, bytes }));
        if (!items.length) e.notes.push({ text: NO_CACHE, bytes: e.bytes });
        entries.push(e);
      }
    }
    entries.sort((a, b) => b.bytes - a.bytes);
    return {
      scan: {
        t: now(), durationMs: now() - t0, truncated: budget.stopped,
        totalBytes: entries.reduce((a, e) => a + e.bytes, 0), entries: entries.slice(0, 40),
      },
      byId: new Map(all.map(t => [t.id, t])),
    };
  }

  // single-flight + cache de 5 min; `fresh` coleta de novo; clean invalida
  let cached: { p: Promise<AppDataScan>; at: number | null } | null = null;
  function preview(opts: { fresh?: boolean } = {}): Promise<AppDataScan> {
    if (cached && !opts.fresh && (cached.at === null || now() - cached.at < 5 * 60_000)) return cached.p;
    const c: { p: Promise<AppDataScan>; at: number | null } = { p: collect().then(r => r.scan), at: null };
    c.p.then(() => { c.at = now(); }, () => { if (cached === c) cached = null; });
    cached = c;
    return c.p;
  }

  async function clean(ids: string[]) {
    const { byId } = await collect();
    cached = null;
    let bytes = 0, files = 0, skipped = 0;
    for (const id of new Set(ids)) {
      const t = typeof id === 'string' ? byId.get(id) : undefined;
      const keys = deps.runningKeys();
      // reconfere logo antes: dono fechado, pasta de verdade no mesmo caminho real
      if (!t || !t.actionable || keys === null || t.owners.some(o => keys.has(o)) || !await isRealDir(t.path)) { skipped++; continue; }
      try { await rm(t.path, { recursive: true }); bytes += t.bytes; files += t.files; } catch { skipped++; }
    }
    return { bytes, files, skipped };
  }

  return { preview, clean };
}
