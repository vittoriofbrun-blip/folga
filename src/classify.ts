// F-02: agrupa processos em apps e decide parado / em uso / protegido (R02-R06).
// Função pura: o tempo vem em ctx.now, nada de node:* nem estado global.
import type { AppGroup, AppReason, AppState, ProbeProcess, ProbeSnapshot, Settings } from './types.ts';
import { SYSTEM_PROCESSES } from './types.ts';

export type ClassifyHistory = {
  lastFocusedAt: Record<string, number>;                        // por chave de app
  cpu: Record<number, { t: number; cpuTimeMs: number }>;        // última leitura por pid
  cpuSamples: Record<string, { t: number; percent: number }[]>; // por chave, últimos 30 s
  busy?: Record<string, true>;                                  // acima da linha de CPU na leitura anterior (R04)
};
export const emptyHistory = (): ClassifyHistory => ({ lastFocusedAt: {}, cpu: {}, cpuSamples: {}, busy: {} });
export type ClassifyContext = { selfPids: readonly number[]; userSession: number; startedAt: number; now: number };

const CPU_WINDOW_MS = 30_000;
const BUSY_RELEASE = 0.6;   // R04: ocupado só volta a parado abaixo de 60 % da linha (3 % no padrão de 5 %)
// R29: navegador Chromium fechado janela por janela reabre só a última (visto em scripts/qa-chrome.ts).
// ponytail: Edge, Brave e os outros são o mesmo motor (inferido, só o Chrome foi testado); Firefox sem teste.
const CHROMIUM = new Set(['chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'chromium']);
const SELF_KEY = '__self';

export function appKey(name: string): string {
  return name.toLowerCase().replace(/\.exe$/, '');
}

const ORDER: Record<AppState, number> = { idle: 0, in_use: 1, protected: 2 };

export function classify(
  snap: ProbeSnapshot, history: ClassifyHistory, settings: Settings, ctx: ClassifyContext,
): { apps: AppGroup[]; history: ClassifyHistory } {
  // clone: o history recebido não é alterado
  const lastFocusedAt = { ...history.lastFocusedAt };
  const cpu: ClassifyHistory['cpu'] = {};
  const cpuSamples: ClassifyHistory['cpuSamples'] = {};
  const busy: Record<string, true> = {};

  // 1-2. agrupa (self antes, para a janela do Folga não se misturar ao msedge do usuário)
  const groups = new Map<string, ProbeProcess[]>();
  for (const p of snap.processes) {
    const key = ctx.selfPids.includes(p.pid) ? SELF_KEY : appKey(p.name);
    const list = groups.get(key);
    if (list) list.push(p); else groups.set(key, [p]);
  }

  const neverClose = new Set(settings.neverClose.map(appKey));
  const audioPids = new Set(snap.audioPids ?? []);
  const apps: AppGroup[] = [];

  for (const [key, procs] of groups) {
    // 3. CPU: delta de tempo de CPU ÷ delta de relógio, em % de um núcleo
    let sample = 0;
    for (const p of procs) {
      const prev = history.cpu[p.pid];
      if (prev && snap.t > prev.t && p.cpuTimeMs >= prev.cpuTimeMs) {
        sample += ((p.cpuTimeMs - prev.cpuTimeMs) / (snap.t - prev.t)) * 100;
      } // ponytail: pid novo, relógio parado ou contador menor (pid reaproveitado) contribui 0
      cpu[p.pid] = { t: snap.t, cpuTimeMs: p.cpuTimeMs };
    }
    const samples = [...(history.cpuSamples[key] ?? []), { t: snap.t, percent: sample }]
      .filter((s) => snap.t - s.t <= CPU_WINDOW_MS);
    cpuSamples[key] = samples;
    const cpuPercent = Math.round((samples.reduce((a, s) => a + s.percent, 0) / samples.length) * 10) / 10;
    // histerese: sem ela, um app rondando a linha troca de grupo a cada leitura
    const busyNow = cpuPercent >= settings.busyCpuPercent * (history.busy?.[key] ? BUSY_RELEASE : 1);
    if (busyNow) busy[key] = true;

    // 4. foco
    const inForeground = snap.foregroundPid !== null && procs.some((p) => p.pid === snap.foregroundPid);
    if (inForeground) lastFocusedAt[key] = ctx.now;
    const focused = lastFocusedAt[key] ?? null;

    // 5. estado, primeira regra que casar: self, other_session, system, no_window, never_close,
    //    foreground, audio (tocando som com a janela no fundo), busy, recent, idle
    const mine = procs.filter((p) => p.session === ctx.userSession);
    const windows = mine.reduce((n, p) => n + (p.windowCount ?? (p.hasVisibleWindow ? 1 : 0)), 0);
    let state: AppState;
    let reason: AppReason;
    if (key === SELF_KEY) { state = 'protected'; reason = 'self'; }
    else if (mine.length === 0) { state = 'protected'; reason = 'other_session'; }
    else if (SYSTEM_PROCESSES.includes(key) || !mine.some((p) => p.accessible)) { state = 'protected'; reason = 'system'; }
    else if (!mine.some((p) => p.hasVisibleWindow)) { state = 'protected'; reason = 'no_window'; }
    else if (neverClose.has(key)) { state = 'protected'; reason = 'never_close'; }
    else if (inForeground) { state = 'in_use'; reason = 'foreground'; }
    else if (procs.some((p) => audioPids.has(p.pid))) { state = 'in_use'; reason = 'audio'; }
    else if (busyNow) { state = 'in_use'; reason = 'busy'; }
    else if (ctx.now - (focused ?? ctx.startedAt) < settings.idleMinutes * 60_000) { state = 'in_use'; reason = 'recent'; }
    else if (CHROMIUM.has(key) && windows > 1) { state = 'in_use'; reason = 'multi_window'; }
    else { state = 'idle'; reason = 'idle'; }

    // apps empacotados (Paint, Bloco de Notas) trazem o próprio "x.exe" como descrição: não serve de nome
    const description = procs.map((p) => p.description.trim()).find((d) => d !== '' && !/\.exe$/i.test(d));
    const first = procs[0]!; // grupo nunca é vazio
    const fileName = first.name.replace(/\.exe$/i, '');
    apps.push({
      key,
      name: key === SELF_KEY ? 'Folga' : description ?? fileName.charAt(0).toUpperCase() + fileName.slice(1),
      pids: procs.map((p) => p.pid),
      privateWorkingSet: procs.reduce((a, p) => a + p.privateWorkingSet, 0),
      cpuPercent, state, reason, lastFocusedAt: focused, windows,
    });
  }

  // 6. idle, in_use, protected; maior primeiro dentro de cada um
  apps.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.privateWorkingSet - a.privateWorkingSet);
  return { apps, history: { lastFocusedAt, cpu, cpuSamples, busy } };
}
