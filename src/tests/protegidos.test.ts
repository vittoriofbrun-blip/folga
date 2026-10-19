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
/** pais de um grupo sem janela: chave e quantos MB dele são daquele dono */
const de = (...pares: [string, number][]) => pares.map(([key, m]) => ({ key, bytes: m * MB }));

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
    app({ key: 'node', name: 'Node.js', reason: 'no_window', privateWorkingSet: 724 * MB, parents: de(['claude', 724]) }),
  ];
  const [, node] = protectedRows(apps);
  assert.equal(node!.words, 'sem janela aberta · serviço do Claude Code');
  assert.deepEqual(node!.parents, ['Claude Code']);
});

caso('dois e três pais, e pai que já saiu da lista cai na chave', () => {
  const apps = [
    app({ key: 'claude', name: 'Claude Code' }),
    app({ key: 'chatgpt', name: 'ChatGPT' }),
    app({ key: 'a', reason: 'no_window', parents: de(['claude', 60], ['chatgpt', 40]) }),
    app({ key: 'b', reason: 'no_window', parents: de(['claude', 50], ['chatgpt', 30], ['cursor', 20]) }),
    app({ key: 'd', reason: 'no_window', parents: de(['claude', 40], ['chatgpt', 30], ['cursor', 20], ['codex', 10]) }),
    app({ key: 'c', reason: 'no_window', parents: de(['fantasma', 100]) }),
  ];
  const by = Object.fromEntries(protectedRows(apps).map((r) => [r.key, r.words]));
  assert.equal(by['a'], 'sem janela aberta · serviço do Claude Code e do ChatGPT');
  assert.equal(by['b'], 'sem janela aberta · serviço do Claude Code, do ChatGPT e do cursor');
  assert.equal(by['d'], 'sem janela aberta · serviço do Claude Code, do ChatGPT e de outros');
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

// ===================== R36: "+ X em serviços" na linha do dono =====================

caso('o dono recebe a soma dos processos sem janela que lançou, de todas as linhas', () => {
  // cenário real: Claude Code 3,7 GB na linha dele e quase 1 GB espalhado em node, cmd e conhost
  const rows = protectedRows([
    app({ key: 'claude', name: 'Claude Code', reason: 'never_close', privateWorkingSet: 3685 * MB }),
    app({ key: 'node', reason: 'no_window', privateWorkingSet: 724 * MB, parents: de(['claude', 700], ['cursor', 24]) }),
    app({ key: 'cmd', reason: 'no_window', privateWorkingSet: 60 * MB, parents: de(['claude', 200]) }),
    app({ key: 'conhost', reason: 'no_window', privateWorkingSet: 18 * MB, parents: de(['claude', 18]) }),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by['claude']!.services / MB, 918);
  assert.equal(by['claude']!.bytes / MB, 3685);        // o próprio tamanho não muda
  // nada de contar duas vezes: o total do grupo continua sendo a soma dos `bytes`
  assert.equal(rows.reduce((n, r) => n + r.bytes, 0) / MB, 3685 + 724 + 60 + 18);
  assert.equal(by['node']!.services, 0);               // quem é serviço não segura serviço
});

caso('dono que não é protegido (o Chrome em uso) não vira linha, e ninguém mais leva os bytes dele', () => {
  const rows = protectedRows([
    app({ key: 'chrome', name: 'Chrome', state: 'in_use', reason: 'recent', privateWorkingSet: 400 * MB }),
    app({ key: 'cmd', reason: 'no_window', privateWorkingSet: 60 * MB, parents: de(['chrome', 60]) }),
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['cmd']);
  assert.equal(rows[0]!.services, 0);
});

caso('pai que já saiu da lista some da conta de todo mundo', () => {
  const rows = protectedRows([
    app({ key: 'node', reason: 'no_window', privateWorkingSet: 50 * MB, parents: de(['fantasma', 50]) }),
  ]);
  assert.equal(rows[0]!.services, 0);
});

caso('migalha não vira linha de serviço, mas 10 MB já vira', () => {
  const migalha = protectedRows([
    app({ key: 'claude', reason: 'never_close' }),
    app({ key: 'cmd', reason: 'no_window', parents: de(['claude', 9]) }),
  ]);
  assert.equal(migalha.find((r) => r.key === 'claude')!.services, 0);
  const vale = protectedRows([
    app({ key: 'claude', reason: 'never_close' }),
    app({ key: 'cmd', reason: 'no_window', parents: de(['claude', 10]) }),
  ]);
  assert.equal(vale.find((r) => r.key === 'claude')!.services / MB, 10);
});

caso('um app sem janela também pode ser dono (o da bandeja)', () => {
  const rows = protectedRows([
    app({ key: 'chatgpt', name: 'ChatGPT', reason: 'no_window', privateWorkingSet: 192 * MB }),
    app({ key: 'codex', reason: 'no_window', privateWorkingSet: 200 * MB, parents: de(['chatgpt', 200]) }),
  ]);
  assert.equal(rows.find((r) => r.key === 'chatgpt')!.services / MB, 200);
});

casos.forEach((c) => console.log('ok  ' + c));
console.log(`protegidos: ${casos.length} casos ok`);
