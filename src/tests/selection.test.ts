// Marcação padrão da tela Memória (R04, R06) e as marcas feitas à mão.
import assert from 'node:assert/strict';
import { selection } from '../../web/src/selection.ts';
import type { AppGroup } from '../types.ts';

const app = (key: string, state: AppGroup['state']): AppGroup => ({
  key, name: key, pids: [1], privateWorkingSet: 1, cpuPercent: 0, state,
  reason: state === 'idle' ? 'idle' : state === 'in_use' ? 'busy' : 'system', lastFocusedAt: null,
});
const none = new Set<string>();
const keys = (s: Set<string>) => [...s].sort();

// padrão: parado vem marcado; em uso e protegido não
assert.deepEqual(keys(selection([app('a', 'idle'), app('b', 'in_use'), app('c', 'protected')], none, none)), ['a']);
// R04: o parado que ficou ocupado perde a marca padrão (e volta a tê-la quando para de novo)
assert.deepEqual(keys(selection([app('a', 'in_use')], none, none)), []);
// marca feita à mão fica, mesmo com o app em uso
assert.deepEqual(keys(selection([app('b', 'in_use')], new Set(['b']), none)), ['b']);
// desmarcado à mão continua desmarcado, mesmo depois de oscilar entre ocupado e parado
assert.deepEqual(keys(selection([app('a', 'idle')], none, new Set(['a']))), []);
// protegido nunca é marcado, nem à mão
assert.deepEqual(keys(selection([app('c', 'protected')], new Set(['c']), none)), []);

console.log('selection: 5 casos ok');
