import assert from 'node:assert/strict';
import { appKey, classify, emptyHistory } from '../classify.ts';
import type { ClassifyContext, ClassifyHistory } from '../classify.ts';
import type { ProbeProcess, ProbeSnapshot, Settings } from '../types.ts';
import { DEFAULT_SETTINGS } from '../types.ts';

const MIN = 60_000;
const MB = 1024 * 1024;
const T0 = 1_000_000_000_000;
const settings: Settings = DEFAULT_SETTINGS;

const casos: string[] = [];
function caso(nome: string, fn: () => void) { fn(); casos.push(nome); }

let nextPid = 100;
const proc = (name: string, o: Partial<ProbeProcess> = {}): ProbeProcess => ({
  pid: nextPid++, ppid: 1, name, description: '', session: 1, privateWorkingSet: 100 * MB,
  cpuTimeMs: 0, hasVisibleWindow: true, accessible: true, ...o,
});
const snapOf = (processes: ProbeProcess[], t: number, foregroundPid: number | null = null): ProbeSnapshot => ({
  type: 'snapshot', t, memLoad: 70, totalPhys: 16 * 1024 * MB, availPhys: 4 * 1024 * MB, foregroundPid, processes,
});
const ctxAt = (now: number, o: Partial<ClassifyContext> = {}): ClassifyContext =>
  ({ selfPids: [], userSession: 1, startedAt: T0, now, ...o });
const find = (r: ReturnType<typeof classify>, key: string) => {
  const g = r.apps.find((a) => a.key === key);
  assert.ok(g, `grupo ${key} ausente`);
  return g;
};

caso('appKey: minúsculo e sem .exe', () => {
  assert.equal(appKey('Chrome.EXE'), 'chrome');
  assert.equal(appKey('chrome.exe'), 'chrome');
  assert.equal(appKey('Figma'), 'figma');
});

caso('a) primeira execução: app com janela, nunca em foco, 5 min -> in_use/recent', () => {
  const r = classify(snapOf([proc('figma.exe')], T0 + 5 * MIN), emptyHistory(), settings, ctxAt(T0 + 5 * MIN));
  const g = find(r, 'figma');
  assert.equal(g.state, 'in_use'); assert.equal(g.reason, 'recent'); assert.equal(g.lastFocusedAt, null);
  assert.equal(r.apps.filter((a) => a.state === 'idle').length, 0);
});

caso('b) mesmo app 31 min depois de startedAt -> idle', () => {
  const g = find(classify(snapOf([proc('figma.exe')], T0 + 31 * MIN), emptyHistory(), settings, ctxAt(T0 + 31 * MIN)), 'figma');
  assert.equal(g.state, 'idle'); assert.equal(g.reason, 'idle');
});

caso('c) app ocupado (delta de CPU de 50 %) -> in_use/busy mesmo parado há horas', () => {
  const p = proc('render.exe', { cpuTimeMs: 1000 });
  const now1 = T0 + 5 * 60 * MIN; // 5 h depois de startedAt, sem nunca ter tido foco
  const h = classify(snapOf([p], now1), emptyHistory(), settings, ctxAt(now1)).history;
  const now2 = now1 + 2000;
  // 1000 ms de CPU em 2000 ms de relógio = 50 %; média com a amostra 0 da primeira leitura = 25 %
  const g = find(classify(snapOf([{ ...p, cpuTimeMs: 2000 }], now2), h, settings, ctxAt(now2)), 'render');
  assert.equal(g.cpuPercent, 25);
  assert.deepEqual([g.state, g.reason], ['in_use', 'busy']);
  // sem a amostra zero, a média é os 50 % cheios
  const g2 = find(classify(snapOf([{ ...p, cpuTimeMs: 2000 }], now2), { ...h, cpuSamples: {} }, settings, ctxAt(now2)), 'render');
  assert.equal(g2.cpuPercent, 50);
});

caso('d) Chrome com 20 processos (1 com janela) -> 1 grupo, soma e pids certos', () => {
  const ps = Array.from({ length: 20 }, (_, i) =>
    proc(i % 2 ? 'chrome.exe' : 'Chrome.EXE', { privateWorkingSet: (i + 1) * MB, hasVisibleWindow: i === 0, description: i === 0 ? '' : 'Google Chrome' }));
  const r = classify(snapOf(ps, T0 + 31 * MIN), emptyHistory(), settings, ctxAt(T0 + 31 * MIN));
  assert.equal(r.apps.length, 1);
  const g = find(r, 'chrome');
  assert.equal(g.pids.length, 20);
  assert.equal(g.privateWorkingSet, (20 * 21 / 2) * MB);
  assert.equal(g.name, 'Google Chrome'); // primeira description não vazia
  assert.equal(g.state, 'idle');
});

caso('nome de exibição sem description: nome original sem .exe', () => {
  assert.equal(find(classify(snapOf([proc('Figma.exe')], T0), emptyHistory(), settings, ctxAt(T0)), 'figma').name, 'Figma');
});

caso('descrição que é só "x.exe" (apps empacotados) não vira nome: "mspaint.exe" -> "Mspaint"', () => {
  const p = { ...proc('mspaint.exe'), description: 'mspaint.exe' };
  assert.equal(find(classify(snapOf([p], T0), emptyHistory(), settings, ctxAt(T0)), 'mspaint').name, 'Mspaint');
});

caso('e) never_close (WindowsTerminal) e SYSTEM (explorer) -> protected', () => {
  const r = classify(snapOf([proc('WindowsTerminal.exe'), proc('explorer.exe')], T0 + 99 * MIN), emptyHistory(), settings, ctxAt(T0 + 99 * MIN));
  const wt = find(r, 'windowsterminal'); const ex = find(r, 'explorer');
  assert.deepEqual([wt.state, wt.reason], ['protected', 'never_close']);
  assert.deepEqual([ex.state, ex.reason], ['protected', 'system']);
});

caso('system: nenhum processo acessível -> protected/system', () => {
  const g = find(classify(snapOf([proc('avgsvc.exe', { accessible: false })], T0 + 99 * MIN), emptyHistory(), settings, ctxAt(T0 + 99 * MIN)), 'avgsvc');
  assert.deepEqual([g.state, g.reason], ['protected', 'system']);
});

caso('f) selfPids: msedge do usuário fica no grupo "msedge"; o do Folga vira "__self"', () => {
  const user = proc('msedge.exe'); const mine = proc('msedge.exe');
  const r = classify(snapOf([user, mine], T0 + 99 * MIN), emptyHistory(), settings, ctxAt(T0 + 99 * MIN, { selfPids: [mine.pid] }));
  assert.deepEqual(find(r, 'msedge').pids, [user.pid]);
  const s = find(r, '__self');
  assert.deepEqual(s.pids, [mine.pid]);
  assert.deepEqual([s.name, s.state, s.reason], ['Folga', 'protected', 'self']);
  const sem = classify(snapOf([user], T0), emptyHistory(), settings, ctxAt(T0, { selfPids: [999] }));
  assert.equal(sem.apps.some((a) => a.key === '__self'), false);
});

caso('g) sessão 0 -> other_session; sem janela na sessão do usuário -> no_window', () => {
  const r = classify(snapOf([proc('svchost.exe', { session: 0 }), proc('helper.exe', { hasVisibleWindow: false })], T0 + 99 * MIN),
    emptyHistory(), settings, ctxAt(T0 + 99 * MIN));
  const a = find(r, 'svchost'); const b = find(r, 'helper');
  assert.deepEqual([a.state, a.reason], ['protected', 'other_session']);
  assert.deepEqual([b.state, b.reason], ['protected', 'no_window']);
});

caso('h) foreground -> in_use/foreground e lastFocusedAt = now; 31 min sem foco -> idle', () => {
  const p = proc('slack.exe');
  const r1 = classify(snapOf([p], T0 + MIN, p.pid), emptyHistory(), settings, ctxAt(T0 + MIN));
  const g1 = find(r1, 'slack');
  assert.deepEqual([g1.state, g1.reason, g1.lastFocusedAt], ['in_use', 'foreground', T0 + MIN]);
  const t2 = T0 + MIN + 29 * MIN;
  assert.equal(find(classify(snapOf([p], t2), r1.history, settings, ctxAt(t2)), 'slack').reason, 'recent');
  const t3 = T0 + MIN + 31 * MIN;
  const g3 = find(classify(snapOf([p], t3), r1.history, settings, ctxAt(t3)), 'slack');
  assert.deepEqual([g3.state, g3.reason, g3.lastFocusedAt], ['idle', 'idle', T0 + MIN]);
});

caso('i) amostras de CPU com mais de 30 s são descartadas', () => {
  const p = proc('work.exe');
  let h = emptyHistory(); let cpuMs = 0; let r!: ReturnType<typeof classify>;
  // 20 s a 100 % de um núcleo, leitura a cada 2 s
  for (let t = 2000; t <= 20_000; t += 2000) {
    cpuMs += 2000;
    r = classify(snapOf([{ ...p, cpuTimeMs: cpuMs }], T0 + t), h, settings, ctxAt(T0 + t)); h = r.history;
  }
  assert.ok(find(r, 'work').cpuPercent >= 5);
  // depois 40 s sem consumir CPU: as amostras ocupadas saem da janela
  for (let t = 22_000; t <= 60_000; t += 2000) {
    r = classify(snapOf([{ ...p, cpuTimeMs: cpuMs }], T0 + t), h, settings, ctxAt(T0 + t)); h = r.history;
  }
  assert.equal(find(r, 'work').cpuPercent, 0);
  const amostras = h.cpuSamples['work'] ?? [];
  assert.ok(amostras.every((s) => T0 + 60_000 - s.t <= 30_000));
  assert.ok(amostras.length <= 16);
});

caso('history.cpu guarda a leitura atual e remove pids que sumiram', () => {
  const a = proc('a.exe'); const b = proc('b.exe');
  const h1 = classify(snapOf([a, b], T0), emptyHistory(), settings, ctxAt(T0)).history;
  assert.deepEqual(Object.keys(h1.cpu).map(Number).sort(), [a.pid, b.pid].sort());
  const h2 = classify(snapOf([a], T0 + 2000), h1, settings, ctxAt(T0 + 2000)).history;
  assert.deepEqual(Object.keys(h2.cpu).map(Number), [a.pid]);
});

caso('j) ordem: idle, in_use, protected; tamanho decrescente em cada um', () => {
  const ps = [
    proc('smallidle.exe', { privateWorkingSet: 10 * MB }),
    proc('bigidle.exe', { privateWorkingSet: 900 * MB }),
    proc('explorer.exe', { privateWorkingSet: 5000 * MB }),
    proc('code.exe', { privateWorkingSet: 400 * MB }),
    proc('fg.exe', { privateWorkingSet: 50 * MB }),
    proc('mididle.exe', { privateWorkingSet: 700 * MB }),
  ];
  const t = T0 + 31 * MIN;
  const r = classify(snapOf(ps, t, ps[4]!.pid), emptyHistory(), settings, ctxAt(t));
  assert.deepEqual(r.apps.map((a) => a.key), ['bigidle', 'mididle', 'smallidle', 'fg', 'explorer', 'code']);
  assert.deepEqual(r.apps.map((a) => a.state), ['idle', 'idle', 'idle', 'in_use', 'protected', 'protected']);
});

caso('k) áudio ativo com janela no fundo -> in_use/audio; sem audioPids volta a idle', () => {
  const sp = proc('Spotify.exe'); const helper = proc('Spotify.exe', { hasVisibleWindow: false });
  const t = T0 + 5 * 60 * MIN; // parado há horas, sem foco
  const comAudio = { ...snapOf([sp, helper], t), audioPids: [helper.pid] }; // o pid que toca pode ser o helper
  const g = find(classify(comAudio, emptyHistory(), settings, ctxAt(t)), 'spotify');
  assert.deepEqual([g.state, g.reason], ['in_use', 'audio']);
  const sem = find(classify(snapOf([sp, helper], t), emptyHistory(), settings, ctxAt(t)), 'spotify');
  assert.deepEqual([sem.state, sem.reason], ['idle', 'idle']);
  const vazio = find(classify({ ...snapOf([sp, helper], t), audioPids: [] }, emptyHistory(), settings, ctxAt(t)), 'spotify');
  assert.equal(vazio.state, 'idle');
  // never_close continua mandando mais que o áudio
  const wt = proc('WindowsTerminal.exe');
  const r = classify({ ...snapOf([wt], t), audioPids: [wt.pid] }, emptyHistory(), settings, ctxAt(t));
  assert.deepEqual([find(r, 'windowsterminal').state, find(r, 'windowsterminal').reason], ['protected', 'never_close']);
});

caso('l) histerese da R04: ocupado só volta a parado abaixo de 60 % da linha', () => {
  const p = proc('excel.exe');
  let h = emptyHistory(); let cpuMs = 0; let t = T0 + 5 * 60 * MIN;   // parado há horas, sem foco
  const ler = (pct: number) => {   // uma leitura 2 s depois, com pct % de um núcleo nesse intervalo
    t += 2000; cpuMs += 20 * pct;
    const r = classify(snapOf([{ ...p, cpuTimeMs: cpuMs }], t), h, settings, ctxAt(t)); h = r.history;
    return find(r, 'excel');
  };
  ler(0);
  for (let i = 0; i < 15; i++) ler(10);
  assert.equal(ler(10).reason, 'busy');                    // 30 s a 10 %
  for (let i = 0; i < 15; i++) ler(4);
  const g = ler(4);                                        // média em 4 %: abaixo de 5, acima de 3
  assert.deepEqual([g.cpuPercent, g.reason], [4, 'busy']); // sem histerese já seria idle
  for (let i = 0; i < 15; i++) ler(2);
  assert.equal(ler(2).state, 'idle');                      // abaixo de 3 %: volta a parado
  for (let i = 0; i < 15; i++) ler(4);
  assert.equal(ler(4).state, 'idle');                      // de parado, 4 % não basta: precisa chegar a 5
});

caso('puro: snapshot e history recebidos não são alterados', () => {
  const p = proc('figma.exe', { cpuTimeMs: 500 });
  const snap = snapOf([p, proc('figma.exe')], T0 + 100, p.pid);
  const h: ClassifyHistory = { lastFocusedAt: { x: 1 }, cpu: { [p.pid]: { t: T0, cpuTimeMs: 100 } }, cpuSamples: { figma: [{ t: T0, percent: 3 }] } };
  const snapCopy = structuredClone(snap); const hCopy = structuredClone(h);
  const r = classify(snap, h, settings, ctxAt(T0 + 100));
  assert.deepEqual(snap, snapCopy); assert.deepEqual(h, hCopy);
  assert.notEqual(r.history, h);
});

casos.forEach((c) => console.log('ok  ' + c));
console.log(`classify: ${casos.length} casos ok`);
