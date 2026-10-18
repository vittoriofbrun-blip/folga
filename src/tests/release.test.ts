// Liberar sem processos reais: sonda e estado falsos (R07–R09, ADR 0003).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReleaser } from '../release.ts';
import { DEFAULT_SETTINGS, type AppGroup, type MemoryState, type ProbeCommand, type Settings } from '../types.ts';

const app = (key: string, pids: number[], over: Partial<AppGroup> = {}): AppGroup => ({
  key, name: key, pids, privateWorkingSet: 100, cpuPercent: 0, state: 'idle', reason: 'idle', lastFocusedAt: null, ...over,
});
const mem = (apps: AppGroup[], availPhys: number): MemoryState => ({
  t: 0, memLoad: 80, totalPhys: 1000, availPhys, apps, freed: [], settings: DEFAULT_SETTINGS, startedAt: 0,
  autoCare: { nextEligibleAt: null, lastRunAt: null },
});

function setup(before: MemoryState, after: MemoryState, measured: MemoryState, settings: Settings = DEFAULT_SETTINGS) {
  const dir = mkdtempSync(join(tmpdir(), 'folga-rel-'));
  const sent: Omit<ProbeCommand, 'id'>[] = [];
  const queue = [after, measured];
  const releaser = createReleaser({
    dataDir: dir,
    probe: { send: async cmd => { sent.push(cmd); return { type: 'reply', id: 'x', ok: true, windowsClosed: 1 }; } },
    getState: () => before,
    getSettings: () => settings,
    waitForSnapshot: async () => queue.shift() ?? measured,
    closeWaitMs: 1, measureWaitMs: 1,
  });
  return { dir, sent, releaser };
}

let passed = 0;
const ok = (name: string) => { passed++; console.log(`ok  ${name}`); };

{
  // fechou / ficou aberto / bandeja
  const before = mem([app('calc', [1]), app('notepad', [2]), app('teams', [3, 4]), app('explorer', [9], { state: 'protected', reason: 'system' })], 200);
  const after = mem([app('notepad', [2], { reason: 'idle' }), app('teams', [4], { state: 'protected', reason: 'no_window' }), app('explorer', [9])], 250);
  const measured = mem(after.apps, 330);
  const { dir, sent, releaser } = setup(before, after, measured);
  const r = await releaser.release(['calc', 'notepad', 'teams'], 'manual');
  assert.ok(!('erro' in r));
  assert.deepEqual(r.results.map(x => [x.key, x.outcome]), [['calc', 'fechou'], ['notepad', 'ficou_aberto'], ['teams', 'bandeja']]);
  ok('R07: fechou, ficou aberto e bandeja');

  assert.equal(r.availAfter - r.availBefore, 130);   // não é a soma dos apps (300)
  ok('R08: liberados = disponível depois − antes, não a soma');

  assert.ok(sent.every(c => c.type === 'close'));
  ok('ADR 0003: sem mayForceQuit nunca manda kill');

  const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(log.length, 1);
  assert.equal(log[0].origin, 'manual');
  assert.equal(log[0].availBefore, 200);
  assert.deepEqual(await releaser.readLog(10), log);
  assert.deepEqual(releaser.freed().map(f => f.key), ['calc']);
  ok('R14: uma linha no log.jsonl e calc em Liberados');
  rmSync(dir, { recursive: true, force: true });
}

{
  // bandeja + mayForceQuit → encerrado
  const before = mem([app('teams', [3, 4])], 200);
  const after = mem([app('teams', [4], { state: 'protected', reason: 'no_window' })], 200);
  const settings = { ...DEFAULT_SETTINGS, mayForceQuit: ['teams'] };
  const { dir, sent, releaser } = setup(before, after, mem([], 400), settings);
  const r = await releaser.release(['teams'], 'auto');
  assert.ok(!('erro' in r));
  assert.equal(r.results[0]!.outcome, 'encerrado');
  assert.deepEqual(sent.at(-1), { type: 'kill', pids: [4] });
  ok('P03: app de bandeja em mayForceQuit é encerrado, só os pids vivos');
  rmSync(dir, { recursive: true, force: true });
}

{
  // R09: protegido recusa tudo e não manda nada para a sonda
  const before = mem([app('calc', [1]), app('explorer', [9], { state: 'protected', reason: 'system' })], 200);
  const { dir, sent, releaser } = setup(before, before, before);
  const r = await releaser.release(['calc', 'explorer'], 'manual');
  assert.ok('erro' in r && r.status === 409);
  assert.equal(sent.length, 0);
  ok('R09: pedido com protegido recusado inteiro, nada enviado');

  const none = await releaser.release(['sumiu'], 'manual');
  assert.ok('erro' in none && none.status === 409);
  ok('app que sumiu é ignorado; pedido vazio recusado');
  rmSync(dir, { recursive: true, force: true });
}

{
  // uma liberação por vez
  const before = mem([app('calc', [1])], 200);
  const { dir, releaser } = setup(before, mem([], 300), mem([], 300));
  const first = releaser.release(['calc'], 'manual');
  const second = await releaser.release(['calc'], 'manual');
  assert.ok('erro' in second && second.status === 409);
  await first;
  ok('uma liberação por vez (409 na segunda)');
  rmSync(dir, { recursive: true, force: true });
}

console.log(`release: ${passed} casos ok`);
