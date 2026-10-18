// F-17: arquivos parados, limpeza rápida e Lixeira (D16, D17, R21, R22).
// Nada aqui apaga arquivo do usuário de vez: arquivo do usuário só vai para a Lixeira (R22); só temporários
// com mais de 7 dias e cache de navegador fechado são apagados, e quem chama é a aprovação de um cartão.
import { spawn } from 'node:child_process';
import { realpathSync, type Dirent, type Stats } from 'node:fs';
import { lstat, opendir, readdir, realpath, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { QuickCleanCategory, QuickCleanItem, Settings, StaleBasis, StaleFile, StaleScan } from './types.ts';

export type Browser = 'chrome' | 'edge';
export type FilesDeps = {
  getSettings: () => Settings;
  roots?: string[];          // testes: pastas permitidas no lugar das do usuário
  tempDirs?: string[];       // testes: temporários no lugar de %TEMP%
  cacheDirs?: Partial<Record<Browser, string[]>>;   // testes: pastas de cache no lugar das dos navegadores
  // opcionais, só para testes
  recentDir?: string;                                // pasta "Recent" do Windows
  accessTracking?: boolean;                          // pula o fsutil
  browsersOpen?: () => Promise<Record<Browser, boolean>>;
  trash?: () => Promise<{ bytes: number; files: number }>;
  maxEntries?: number; maxMs?: number; now?: () => number;
};
export type Inspected = { path: string; size: number; lastUsed: number; basis: StaleBasis };
export type InspectError = { erro: string };

const DAY = 86_400_000;
const MAX_ENTRIES = 100_000;
const MAX_MS = 20_000;
const MAX_DEPTH = 10;
const MAX_FINDINGS = 500;
const TEMP_DAYS = 7;
const SKIP_DIRS = new Set(['node_modules', '.git', 'appdata', '$recycle.bin']);

const SYSROOT = () => process.env.SystemRoot ?? 'C:\\Windows';
const PS = () => join(SYSROOT(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const U8 = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;';

// Scripts fixos: nenhum caminho entra no texto do script (R21); os dados vão por stdin, em JSON UTF-8.
// AllDialogs (e não OnlyErrorDialogs, que suprime a confirmação do Windows): se um arquivo for grande demais para
// a Lixeira ou a Lixeira estiver desligada, o Windows pergunta em vez de apagar de vez em silêncio (R22).
const PS_RECYCLE = U8 + "Add-Type -AssemblyName Microsoft.VisualBasic;" +
  "$r=New-Object IO.StreamReader([Console]::OpenStandardInput(),[Text.Encoding]::UTF8);" +
  "$list=$r.ReadToEnd()|ConvertFrom-Json;" +   // sem @(): no PS 5.1 isso embrulharia a lista inteira em 1 item
  "foreach($p in @($list)){ try{ [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile([string]$p,'AllDialogs','SendToRecycleBin') }catch{} }";
// Tamanho da Lixeira do usuário (todas as unidades) pelo Shell.
const PS_TRASH = U8 + "$s=(New-Object -ComObject Shell.Application).Namespace(10);$b=0;$n=0;" +
  "foreach($i in $s.Items()){ $n++; $b+=[double]$i.Size };" +
  "ConvertTo-Json -InputObject ([pscustomobject]@{bytes=$b;files=$n}) -Compress";

function run(file: string, args: string[], input: string | null, timeoutMs: number): Promise<string> {
  return new Promise(res => {
    // shell:false e caminho absoluto: armadilha de spawn no Windows (CLAUDE.md)
    const c = spawn(file, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => c.kill(), timeoutMs);
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', d => { out += d; });
    c.on('error', () => { clearTimeout(timer); res(''); });
    c.on('close', () => { clearTimeout(timer); res(out); });
    c.stdin.on('error', () => {});
    c.stdin.end(input ?? undefined, 'utf8');
  });
}
const runPS = (script: string, input: unknown, timeoutMs: number) =>
  run(PS(), ['-NoProfile', '-NonInteractive', '-Command', script], input === null ? null : JSON.stringify(input), timeoutMs);

const lc = (s: string) => s.toLowerCase();
const exists = (p: string) => lstat(p).then(() => true, () => false);

/** `child` está estritamente dentro de `root`? (relative do win32 ignora maiúsculas; outra unidade vira caminho absoluto) */
function inside(root: string, child: string) {
  const rel = relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

async function realOrNull(p: string) { try { return await realpath(p); } catch { return null; } }

/** Passeio com teto de entradas e de tempo. Não segue link nem junção; lê metadados com lstat, em lotes. */
type Budget = { entries: number; maxEntries: number; deadline: number; now: () => number; stopped: boolean };
async function walk(
  root: string, maxDepth: number, skipDir: ((name: string) => boolean) | null, b: Budget,
  onFile: (path: string, st: Stats) => void | Promise<void>,
) {
  const stack: Array<[string, number]> = [[root, 0]];
  let active = 0;
  async function visit(dir: string, depth: number) {
    const files: string[] = [];
    try {
      const d = await opendir(dir);
      try {
        for await (const e of d as AsyncIterable<Dirent>) {
          if (b.entries >= b.maxEntries || b.now() > b.deadline) { b.stopped = true; break; }
          b.entries++;
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) {
            if (depth < maxDepth && !(skipDir && skipDir(e.name))) stack.push([join(dir, e.name), depth + 1]);
          } else if (e.isFile()) files.push(join(dir, e.name));
        }
      } finally { await d.close().catch(() => {}); }
    } catch { /* sem acesso à pasta: segue */ }
    for (let i = 0; i < files.length && !b.stopped; i += 64) {
      await Promise.all(files.slice(i, i + 64).map(async f => {
        try { const st = await lstat(f); if (st.isFile()) await onFile(f, st); } catch { /* sumiu ou travado */ }
      }));
    }
  }
  // 6 pastas ao mesmo tempo: pasta grande de temporários leva segundos em fila única
  async function worker() {
    while (!b.stopped) {
      const it = stack.pop();
      if (!it) { if (active === 0) return; await new Promise(r => setImmediate(r)); continue; }
      active++;
      try { await visit(it[0], it[1]); } finally { active--; }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
}
const newBudget = (maxEntries: number, maxMs: number, now: () => number): Budget =>
  ({ entries: 0, maxEntries, deadline: now() + maxMs, now, stopped: false });

export function createFiles(deps: FilesDeps) {
  const now = deps.now ?? Date.now;
  let lastScan: StaleScan | null = null;
  let trackingCache: boolean | null = null;

  // ---------- pastas permitidas ----------
  function allowedRoots(): string[] {
    const candidates = deps.roots ?? (() => {
      const bases = [homedir(), process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial]
        .filter((x): x is string => !!x);
      const out: string[] = [];
      for (const base of bases) for (const n of ['Downloads', 'Desktop', 'Documents', 'Pictures', 'Videos', 'Music']) out.push(join(base, n));
      return out;
    })();
    const seen = new Set<string>();
    const real: string[] = [];
    for (const c of candidates) {
      let r: string;
      try { r = realpathSync.native(c); } catch { continue; }   // não existe: fora
      if (!seen.has(lc(r))) { seen.add(lc(r)); real.push(r); }
    }
    // pasta dentro de outra pasta permitida só duplicaria a varredura
    return real.filter(r => !real.some(o => o !== r && inside(o, r)));
  }

  // ---------- sinal de uso ----------
  async function accessTracking(): Promise<boolean> {
    if (deps.accessTracking !== undefined) return deps.accessTracking;
    if (trackingCache === null) {
      const out = await run(join(SYSROOT(), 'System32', 'fsutil.exe'), ['behavior', 'query', 'disablelastaccess'], null, 8_000);
      const v = /=\s*(\d)/.exec(out)?.[1];
      trackingCache = v === '0' || v === '2';   // 0 e 2 = ligado; 1 e 3 = desligado; sem resposta = tratar como desligado
    }
    return trackingCache;
  }

  /** nome do atalho em Recent (sem .lnk, minúsculo) → hora do atalho */
  async function recentMap(): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    const dir = deps.recentDir ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent');
    let names: string[] = [];
    try { names = await readdir(dir); } catch { return m; }
    for (let i = 0; i < names.length; i += 64) {
      await Promise.all(names.slice(i, i + 64).filter(n => lc(n).endsWith('.lnk')).map(async n => {
        try {
          const t = (await lstat(join(dir, n))).mtimeMs;
          const k = lc(n.slice(0, -4));
          if (t > (m.get(k) ?? 0)) m.set(k, t);
        } catch { /* ignora */ }
      }));
    }
    return m;
  }

  /** Último uso: o maior entre acesso/modificação e o atalho de mesmo nome em Recent. */
  function usage(name: string, st: Stats, tracking: boolean, recent: Map<string, number>): { lastUsed: number; basis: StaleBasis } {
    const own = tracking ? Math.max(st.atimeMs, st.mtimeMs) : st.mtimeMs;
    const lnk = recent.get(lc(name)) ?? 0;
    return lnk > own
      ? { lastUsed: lnk, basis: 'recentes' }
      : { lastUsed: own, basis: tracking ? 'acesso' : 'modificacao' };
  }

  // ---------- varredura ----------
  async function doScan(opts: { olderThanDays?: number; minMB?: number }): Promise<StaleScan> {
    const s = deps.getSettings();
    const days = opts.olderThanDays ?? s.staleDays;
    const minBytes = (opts.minMB ?? s.staleMinMB) * 1024 * 1024;
    const t0 = now();
    const roots = allowedRoots();
    const tracking = await accessTracking();
    const recent = await recentMap();
    const b = newBudget(deps.maxEntries ?? MAX_ENTRIES, deps.maxMs ?? MAX_MS, now);
    const found: StaleFile[] = [];
    let total = 0;
    for (const root of roots) {
      await walk(root, MAX_DEPTH, n => n.startsWith('.') || SKIP_DIRS.has(lc(n)), b, (path, st) => {
        if (st.size < minBytes) return;
        const name = basename(path);
        const u = usage(name, st, tracking, recent);
        if ((t0 - u.lastUsed) / DAY < days) return;
        total += st.size;
        found.push({ path, name, root, size: st.size, lastUsed: u.lastUsed, lastModified: st.mtimeMs, basis: u.basis });
      });
      if (b.stopped) break;
    }
    found.sort((a, c) => c.size - a.size);
    const scan: StaleScan = {
      t: t0, durationMs: now() - t0, roots, scanned: b.entries, truncated: b.stopped, accessTracking: tracking,
      olderThanDays: days, minBytes, files: found.slice(0, MAX_FINDINGS), totalBytes: total,
    };
    lastScan = scan;
    return scan;
  }
  // Uma varredura por vez: a segunda espera a primeira.
  let chain: Promise<unknown> = Promise.resolve();
  function scan(opts: { olderThanDays?: number; minMB?: number } = {}): Promise<StaleScan> {
    const p = chain.then(() => doScan(opts));
    chain = p.catch(() => {});
    return p;
  }

  // ---------- revalidação de caminhos (R21) ----------
  /** Um caminho só passa se estiver dentro de uma pasta permitida, existir e for arquivo comum (não pasta, não link). */
  async function inspect(paths: string[]): Promise<Array<Inspected | InspectError>> {
    const roots = allowedRoots();
    const tracking = await accessTracking();
    const recent = await recentMap();
    const one = async (raw: unknown): Promise<Inspected | InspectError> => {
      if (typeof raw !== 'string' || !raw || raw.length > 1024 || /[\u0000-\u001f]/.test(raw)) return { erro: 'caminho inválido' };
      // só letra de unidade (nada de \\servidor, \\?\, \\.\ nem caminho relativo) e nenhum ':' depois dela (fluxos NTFS)
      if (!/^[A-Za-z]:[\\/]/.test(raw) || raw.indexOf(':', 2) !== -1) return { erro: 'caminho inválido ou fora das pastas permitidas' };
      const full = resolve(raw);   // normaliza '..' e '/'
      // o que vale é o caminho real (resolve 8.3, caixa e junções): ele tem que estar dentro de uma pasta permitida
      const real = await realOrNull(full);
      if (!real) return { erro: roots.some(r => inside(r, full)) ? 'o arquivo não existe mais' : 'fora das pastas permitidas' };
      if (!roots.some(r => inside(r, real))) return { erro: 'fora das pastas permitidas' };
      const [st, st2] = await Promise.all([lstat(full).catch(() => null), lstat(real).catch(() => null)]);
      if (!st || !st2) return { erro: 'o arquivo não existe mais' };
      if (st.isSymbolicLink() || st2.isSymbolicLink()) return { erro: 'é um atalho ou link, não um arquivo' };
      if (!st2.isFile()) return { erro: 'não é um arquivo comum' };
      return { path: real, size: st2.size, ...usage(basename(real), st2, tracking, recent) };
    };
    const out: Array<Inspected | InspectError> = [];
    for (let i = 0; i < paths.length; i += 32) out.push(...await Promise.all(paths.slice(i, i + 32).map(one)));
    return out;
  }

  // ---------- Lixeira ----------
  async function recycle(paths: string[]): Promise<{ ok: string[]; failed: string[] }> {
    const checked = await inspect(paths);
    const send: string[] = [];
    const sentFor = new Map<string, string>();   // caminho real → pedido original
    const failed: string[] = [];
    paths.forEach((p, i) => {
      const c = checked[i]!;
      if ('erro' in c) failed.push(p); else { send.push(c.path); sentFor.set(c.path, p); }
    });
    const ok: string[] = [];
    if (send.length) {
      await runPS(PS_RECYCLE, send, 120_000);
      // quem decide é o disco: saiu do lugar = foi para a Lixeira
      for (const real of send) (await exists(real) ? failed : ok).push(sentFor.get(real)!);
    }
    return { ok, failed };
  }

  // ---------- limpeza rápida ----------
  const tempDirs = () => deps.tempDirs ?? [tmpdir()];
  function cacheDirs(): Record<Browser, string[]> {
    if (deps.cacheDirs) return { chrome: deps.cacheDirs.chrome ?? [], edge: deps.cacheDirs.edge ?? [] };
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return { chrome: [join(local, 'Google', 'Chrome', 'User Data')], edge: [join(local, 'Microsoft', 'Edge', 'User Data')] };
  }
  async function profileCaches(userData: string): Promise<string[]> {
    const out: string[] = [];
    let profiles: Dirent[] = [];
    try { profiles = await readdir(userData, { withFileTypes: true }); } catch { return out; }
    for (const p of profiles) {
      if (!p.isDirectory()) continue;
      for (const sub of [['Cache', 'Cache_Data'], ['Code Cache']]) {
        const d = join(userData, p.name, ...sub);
        if (await exists(d)) out.push(d);
      }
    }
    return out;
  }
  async function browsersOpen(): Promise<Record<Browser, boolean>> {
    if (deps.browsersOpen) return deps.browsersOpen();
    const out = await run(join(SYSROOT(), 'System32', 'tasklist.exe'), ['/FO', 'CSV', '/NH'], null, 15_000);
    // sem resposta da tasklist = tratar como aberto (nunca apagar o cache de um navegador que pode estar em uso)
    if (!out) return { chrome: true, edge: true };
    return { chrome: /"chrome\.exe"/i.test(out), edge: /"msedge\.exe"/i.test(out) };
  }

  /** Arquivos que a limpeza apagaria: temporários com mais de 7 dias e caches de navegador fechado. */
  async function collect(): Promise<{
    temp: Array<[string, Stats]>;
    cache: Record<Browser, Array<[string, Stats]>>;
    open: Record<Browser, boolean>;
  }> {
    const limit = now() - TEMP_DAYS * DAY;
    const budget = () => newBudget(MAX_ENTRIES * 5, 60_000, now);
    const temp: Array<[string, Stats]> = [];
    const cache: Record<Browser, Array<[string, Stats]>> = { chrome: [], edge: [] };
    const dirs = cacheDirs();
    // temporários, caches e a consulta de processos andam juntos: o preview aparece quando o mais lento termina
    const [open] = await Promise.all([
      browsersOpen(),
      (async () => { const b = budget(); for (const d of tempDirs()) await walk(d, 32, null, b, (p, st) => { if (st.mtimeMs < limit) temp.push([p, st]); }); })(),
      ...(['chrome', 'edge'] as const).map(async br => {
        const targets = deps.cacheDirs ? dirs[br] : (await Promise.all(dirs[br].map(profileCaches))).flat();
        const b = budget();
        for (const d of targets) await walk(d, 32, null, b, (p, st) => { cache[br].push([p, st]); });
      }),
    ]);
    return { temp, cache, open };
  }
  const sum = (l: Array<[string, Stats]>) => l.reduce((a, [, st]) => a + st.size, 0);

  async function quickCleanPreview(): Promise<QuickCleanItem[]> {
    const [{ temp, cache, open }, t] = await Promise.all([collect(), deps.trash ? deps.trash() : trashInfo()]);
    const items: QuickCleanItem[] = [{
      category: 'temp_usuario', label: 'Arquivos temporários com mais de 7 dias', bytes: sum(temp), files: temp.length, actionable: true,
    }];
    // cache: só o de navegador fechado conta como "a apagar"; se todos estiverem abertos, mostra o tamanho só como informação
    const closed = (['chrome', 'edge'] as const).filter(b => !open[b] && cache[b].length);
    const opened = (['chrome', 'edge'] as const).filter(b => open[b] && cache[b].length);
    const pick = closed.length ? closed : opened;
    const list = pick.flatMap(b => cache[b]);
    const name = (b: Browser) => (b === 'chrome' ? 'Chrome' : 'Edge');
    items.push({
      category: 'cache_navegador', label: 'Cache dos navegadores', bytes: sum(list), files: list.length, actionable: closed.length > 0,
      ...(opened.length ? { note: `${opened.map(name).join(' e ')} ${opened.length > 1 ? 'abertos' : 'aberto'}: feche para limpar o cache` } : {}),
    });
    items.push({
      category: 'lixeira', label: 'Lixeira do Windows', bytes: t.bytes, files: t.files, actionable: false, note: 'Esvazie pela Lixeira do Windows',
    });
    return items;
  }
  async function trashInfo(): Promise<{ bytes: number; files: number }> {
    try {
      const j = JSON.parse(await runPS(PS_TRASH, null, 20_000)) as { bytes?: number; files?: number };
      return { bytes: Math.max(0, Number(j.bytes) || 0), files: Math.max(0, Number(j.files) || 0) };
    } catch { return { bytes: 0, files: 0 }; }
  }

  /** Apaga de vez só o que o preview marca como acionável. `categories` limita ao que o cartão aprovado mostrava. */
  async function quickClean(opts: { categories?: QuickCleanCategory[] } = {}): Promise<{ bytes: number; files: number; skipped: number }> {
    const want = new Set<QuickCleanCategory>(opts.categories ?? ['temp_usuario', 'cache_navegador']);
    const { temp, cache, open } = await collect();
    const limit = now() - TEMP_DAYS * DAY;
    const todo: Array<[string, Stats, boolean]> = [];   // [caminho, stat, exige mtime antigo]
    if (want.has('temp_usuario')) for (const [p, st] of temp) todo.push([p, st, true]);
    if (want.has('cache_navegador')) for (const b of ['chrome', 'edge'] as const) if (!open[b]) for (const [p, st] of cache[b]) todo.push([p, st, false]);
    let bytes = 0, files = 0, skipped = 0;
    for (let i = 0; i < todo.length; i += 32) {
      await Promise.all(todo.slice(i, i + 32).map(async ([p, , old]) => {
        try {
          const st = await lstat(p);   // reconfere logo antes: ainda arquivo comum e (se temporário) ainda antigo
          if (!st.isFile() || (old && st.mtimeMs >= limit)) { skipped++; return; }
          await unlink(p);
          bytes += st.size; files++;
        } catch { skipped++; }   // travado, em uso ou sem permissão: fica
      }));
    }
    return { bytes, files, skipped };
  }

  return {
    allowedRoots,
    last(): StaleScan | null { return lastScan; },
    scan, inspect, quickCleanPreview, recycle, quickClean,
  };
}
export type Files = ReturnType<typeof createFiles>;
