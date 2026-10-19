// R36: as linhas do grupo "Sistema e protegidos" — ordem, motivo em palavras e o único próximo passo.
import assert from 'node:assert/strict';
import { protectedRows } from '../protegidos.ts';
import type { AppGroup } from '../types.ts';

const MB = 1024 * 1024;
const casos: string[] = [];
function caso(nome: string, fn: () => void) { fn(); casos.push(nome); }

const app = (o: Partial<AppGroup> & { key: string }): AppGroup => ({
  name: o.key, pids: [1], privateWorkingSet: 100 * MB, cpuPercent: 0,
  state: 'protected', reason: 'system', lastFocusedAt: null, ...o,
});

caso('maiores primeiro, e só os protegidos', () => {
  const rows = protectedRows([
    app({ key: 'a', privateWorkingSet: 100 * MB }),
    app({ key: 'chrome', state: 'idle', reason: 'idle', privateWorkingSet: 900 * MB }),
    app({ key: 'b', privateWorkingSet: 700 * MB }),
    app({ key: 'c', privateWorkingSet: 300 * MB }),
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['b', 'c', 'a']);
});

caso('empate de tamanho desempata pelo nome (ordem estável na tela)', () => {
  const rows = protectedRows([app({ key: 'zeta', name: 'Zeta' }), app({ key: 'alfa', name: 'Alfa' })]);
  assert.deepEqual(rows.map((r) => r.key), ['alfa', 'zeta']);
});

caso('cada motivo tem palavras, e nenhuma fala de fechar', () => {
  const rows = protectedRows([
    app({ key: 'explorer', reason: 'system' }),
    app({ key: 'node', reason: 'no_window' }),
    app({ key: 'claude', reason: 'never_close' }),
    app({ key: '__self', name: 'Folga', reason: 'self' }),
    app({ key: 'svchost', reason: 'other_session' }),
  ]);
  const words = Object.fromEntries(rows.map((r) => [r.key, r.words]));
  assert.equal(words['explorer'], 'do sistema');
  assert.equal(words['node'], 'sem janela aberta');
  assert.equal(words['claude'], 'você marcou como nunca fechar');
  assert.equal(words['__self'], 'é o próprio Folga');
  assert.equal(words['svchost'], 'de outra sessão do Windows');
});

caso('processo sem janela diz de quem é serviço, com o nome de exibição do pai', () => {
  const apps = [
    app({ key: 'claude', name: 'Claude Code', reason: 'never_close', privateWorkingSet: 3685 * MB }),
    app({ key: 'node', name: 'Node.js', reason: 'no_window', privateWorkingSet: 724 * MB, parents: ['claude'] }),
  ];
  const [, node] = protectedRows(apps);
  assert.equal(node!.words, 'sem janela aberta · serviço do Claude Code');
  assert.deepEqual(node!.parents, ['Claude Code']);
});

caso('dois e três pais, e pai que já saiu da lista cai na chave', () => {
  const apps = [
    app({ key: 'claude', name: 'Claude Code' }),
    app({ key: 'chatgpt', name: 'ChatGPT' }),
    app({ key: 'a', reason: 'no_window', parents: ['claude', 'chatgpt'] }),
    app({ key: 'b', reason: 'no_window', parents: ['claude', 'chatgpt', 'cursor'] }),
    app({ key: 'c', reason: 'no_window', parents: ['fantasma'] }),
  ];
  const by = Object.fromEntries(protectedRows(apps).map((r) => [r.key, r.words]));
  assert.equal(by['a'], 'sem janela aberta · serviço do Claude Code e do ChatGPT');
  assert.equal(by['b'], 'sem janela aberta · serviço do Claude Code, do ChatGPT e de outros');
  assert.equal(by['c'], 'sem janela aberta · serviço do fantasma');
});

caso('só "nunca fechar" tem próximo passo em Ajustes (R05 inteira)', () => {
  const rows = protectedRows([
    app({ key: 'claude', reason: 'never_close' }),
    app({ key: 'node', reason: 'no_window' }),
    app({ key: 'explorer', reason: 'system' }),
    app({ key: '__self', reason: 'self' }),
    app({ key: 'svchost', reason: 'other_session' }),
  ]);
  assert.deepEqual(rows.filter((r) => r.canUnprotect).map((r) => r.key), ['claude']);
});

caso('a contagem de processos vem dos pids do grupo', () => {
  const [row] = protectedRows([app({ key: 'node', reason: 'no_window', pids: [1, 2, 3] })]);
  assert.equal(row!.procs, 3);
});

caso('lista sem protegido nenhum devolve vazio', () => {
  assert.deepEqual(protectedRows([app({ key: 'chrome', state: 'idle', reason: 'idle' })]), []);
});

casos.forEach((c) => console.log('ok  ' + c));
console.log(`protegidos: ${casos.length} casos ok`);
