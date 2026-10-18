// Nota de saúde do Início (D18): cada desconto, os tetos, os limites e o status.
import assert from 'node:assert/strict';
import { computeHealth, type HealthInput } from '../../web/src/health.ts';
import { DEFAULT_SETTINGS, type DiskInfo, type MemoryState, type Warning } from '../types.ts';

const GB = 1024 ** 3;
const mem = (memLoad: number, autoCareEnabled = true): MemoryState => ({
  t: 0, memLoad, totalPhys: 16 * GB, availPhys: 4 * GB, apps: [], freed: [], startedAt: 0,
  settings: { ...DEFAULT_SETTINGS, autoCareEnabled, autoCareThreshold: 92 },
  autoCare: { nextEligibleAt: null, lastRunAt: null },
});
const disk = (freePct: number, drive = 'C:'): DiskInfo => ({ drive, total: 1000, free: freePct * 10 });
const warn = (severity: Warning['severity'], i = 0, active = true): Warning => ({
  id: `w${i}`, kind: 'travamento', severity, title: `Aviso ${i}`, detail: '', firstSeen: 0, lastSeen: 0, active,
});
const base: HealthInput = { state: mem(50), warnings: [], disks: [disk(50)], pendingSuggestions: 0 };
const run = (over: Partial<HealthInput>) => computeHealth({ ...base, ...over });

let n = 0;
const ok = (_name: string) => { n++; };

{ const h = run({}); assert.equal(h.score, 100); assert.equal(h.status, 'bom'); assert.deepEqual(h.problems, []); ok('tudo bem = 100'); }
{ const h = computeHealth({ state: null, warnings: [], disks: [], pendingSuggestions: 0 }); assert.equal(h.score, 100); ok('sem dados = 100'); }

// memória
assert.equal(run({ state: mem(91.9) }).score, 100); ok('memória abaixo da linha');
{ const h = run({ state: mem(92) }); assert.equal(h.score, 80); assert.equal(h.problems[0]?.view, 'memoria'); ok('memória na linha do Auto Care'); }
assert.equal(run({ state: mem(96.9) }).score, 80); ok('memória até 96,9');
assert.equal(run({ state: mem(97) }).score, 60); ok('memória em 97 %');
assert.equal(run({ state: mem(100) }).problems.length, 1); ok('memória crítica gera 1 problema');

// disco
assert.equal(run({ disks: [disk(10)] }).score, 100); ok('disco com 10 % livre');
{ const h = run({ disks: [disk(9.9)] }); assert.equal(h.score, 85); assert.equal(h.problems[0]?.view, 'arquivos'); ok('disco < 10 %'); }
assert.equal(run({ disks: [disk(5)] }).score, 85); ok('disco com 5 % livre');
assert.equal(run({ disks: [disk(4.9)] }).score, 70); ok('disco < 5 %');
assert.equal(run({ disks: [disk(2, 'D:'), disk(80, 'C:')] }).score, 100); ok('usa o C:, não o D:');
assert.equal(run({ disks: [disk(2, 'D:')] }).score, 70); ok('sem C: usa o primeiro');
assert.equal(run({ disks: [{ drive: 'C:', total: 0, free: 0 }] }).score, 100); ok('disco com total 0 é ignorado');

// avisos
assert.equal(run({ warnings: [warn('critico')] }).score, 85); ok('aviso crítico -15');
assert.equal(run({ warnings: [warn('atencao')] }).score, 95); ok('aviso de atenção -5');
assert.equal(run({ warnings: [warn('info')] }).score, 100); ok('aviso info não desconta');
assert.equal(run({ warnings: [warn('critico', 1, false)] }).score, 100); ok('aviso inativo não conta');
assert.equal(run({ warnings: [1, 2, 3, 4].map(i => warn('critico', i)) }).score, 60); ok('teto de -40 nos avisos');
assert.equal(run({ warnings: [warn('critico', 1), warn('critico', 2), warn('atencao', 3), warn('atencao', 4), warn('atencao', 5)] }).score, 60); ok('teto com mistura');
{ const w = { ...warn('critico'), view: 'ajustes' as const }; assert.equal(run({ warnings: [w] }).problems[0]?.view, 'ajustes'); ok('aviso leva à tela dele'); }
assert.equal(run({ warnings: [warn('atencao')] }).problems[0]?.view, 'avisos'); ok('aviso sem tela leva a Avisos');

// sugestões
assert.equal(run({ pendingSuggestions: 1 }).score, 98); ok('1 sugestão -2');
assert.equal(run({ pendingSuggestions: 3 }).score, 94); ok('3 sugestões -6');
assert.equal(run({ pendingSuggestions: 9 }).score, 90); ok('teto de -10 nas sugestões');
assert.equal(run({ pendingSuggestions: 1 }).problems[0]?.text, '1 sugestão pendente'); ok('singular');

// Auto Care
{ const h = run({ state: mem(50, false) }); assert.equal(h.score, 95); assert.equal(h.problems[0]?.view, 'autocare'); ok('Auto Care desligado -5'); }

// limites e status
{
  const h = run({ state: mem(99, false), disks: [disk(1)], warnings: [1, 2, 3].map(i => warn('critico', i)), pendingSuggestions: 20 });
  assert.equal(h.score, 0); assert.equal(h.status, 'critico'); assert.equal(h.problems.length, 7); ok('piso em 0');
}
assert.equal(run({ state: mem(92) }).status, 'bom'); ok('80 = bom');
assert.equal(run({ state: mem(92), pendingSuggestions: 1 }).status, 'regular'); ok('78 = regular');
{ const h = run({ state: mem(97), disks: [disk(9)] }); assert.equal(h.score, 45); assert.equal(h.status, 'critico'); ok('45 = crítico'); }
{ const h = run({ state: mem(97), disks: [disk(10)], warnings: [warn('atencao'), warn('atencao', 2)] }); assert.equal(h.score, 50); assert.equal(h.status, 'regular'); ok('50 = regular'); }

// sem dupla contagem: o aviso de memória/disco não desconta de novo o que a leitura direta já descontou
{
  const memWarn: Warning = { ...warn('atencao', 7), kind: 'memoria' };
  const diskWarn: Warning = { ...warn('critico', 8), kind: 'disco' };
  const h = run({ state: mem(92), disks: [disk(4)], warnings: [memWarn, diskWarn] });
  assert.equal(h.score, 50);   // 100 − 20 (memória) − 30 (disco); os dois avisos não descontam
  assert.equal(h.problems.length, 2);
  ok('aviso de memória/disco não conta duas vezes');
}

console.log(`health: ${n} casos ok`);
