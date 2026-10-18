// Auto Care: decisão pura (R10–R12). Sem processos reais.
import assert from 'node:assert/strict';
import { decide, emptyAutoCare, finishRun, type AutoCareMemory } from '../autocare.ts';
import { DEFAULT_SETTINGS, type AppGroup, type Settings } from '../types.ts';

const app = (key: string, state: AppGroup['state']): AppGroup => ({
  key, name: key, pids: [1], privateWorkingSet: 100, cpuPercent: 0, state, reason: 'idle', lastFocusedAt: null,
});
const apps = [app('calc', 'idle'), app('chrome', 'in_use'), app('explorer', 'protected'), app('notepad', 'idle')];
const on: Settings = { ...DEFAULT_SETTINGS, autoCareEnabled: true, autoCareThreshold: 92, autoCareCooldownMinutes: 10 };
const read = (memLoad: number, list = apps) => ({ memLoad, apps: list });

let passed = 0;
const ok = (name: string) => { passed++; console.log(`ok  ${name}`); };

{
  let m = emptyAutoCare();
  for (let i = 0; i < 5; i++) { const d = decide(m, read(99), { ...on, autoCareEnabled: false }, i); assert.equal(d.keys, null); m = d.mem; }
  assert.equal(m.above, 0);
  ok('desligado nunca dispara');
}
{
  const d = decide(emptyAutoCare(), read(95), on, 0);
  assert.equal(d.keys, null);
  assert.equal(d.mem.above, 1);
  ok('uma leitura alta não dispara');
}
{
  const d1 = decide(emptyAutoCare(), read(92), on, 0);   // ≥ vale
  const d2 = decide(d1.mem, read(93), on, 2000);
  assert.deepEqual(d2.keys, ['calc', 'notepad']);
  assert.equal(d2.mem.above, 0);
  ok('duas seguidas disparam, só com as keys idle');
}
{
  let m = decide(emptyAutoCare(), read(95), on, 0).mem;
  m = decide(m, read(80), on, 1).mem;
  assert.equal(m.above, 0);
  const d = decide(m, read(95), on, 2);
  assert.equal(d.keys, null);
  assert.equal(d.mem.above, 1);
  ok('leitura baixa no meio zera o contador');
}
{
  const t0 = 1_000_000;
  let m: AutoCareMemory = decide(decide(emptyAutoCare(), read(95), on, t0).mem, read(95), on, t0 + 1).mem;
  m = finishRun({ ...m, running: true }, true, 10, t0 + 15_000);
  assert.equal(m.running, false);
  assert.equal(m.lastRunAt, t0 + 15_000);
  assert.equal(m.nextEligibleAt, t0 + 15_000 + 600_000);
  for (let i = 1; i <= 3; i++) { const d = decide(m, read(97), on, t0 + 15_000 + i * 2000); assert.equal(d.keys, null); m = d.mem; }
  const late = decide(m, read(97), on, t0 + 15_000 + 600_000);
  assert.deepEqual(late.keys, ['calc', 'notepad']);
  ok('freio respeitado e liberado depois do cooldown');
}
{
  let m = emptyAutoCare();
  const nothing = [app('chrome', 'in_use'), app('explorer', 'protected')];
  for (let i = 0; i < 4; i++) { const d = decide(m, read(99, nothing), on, i); assert.equal(d.keys, null); m = d.mem; }
  assert.equal(m.lastRunAt, null);
  assert.equal(m.nextEligibleAt, null);
  assert.equal(decide(m, read(99), on, 10).keys?.length, 2);   // apareceu parado: dispara na hora, sem freio
  assert.deepEqual(finishRun(m, false, 10, 99), m);             // release que não rodou também não conta
  ok('sem apps parados não dispara nem conta execução');
}
{
  const m: AutoCareMemory = { ...emptyAutoCare(), above: 5, running: true };
  assert.equal(decide(m, read(99), on, 0).keys, null);
  ok('não dispara com running=true');
}

console.log(`autocare: ${passed} casos ok`);
