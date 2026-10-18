// R31: o aviso do Windows. O texto nunca entra no script (vai por ambiente), e uma falha não insiste.
// O disparo real contra o Windows não entra no `npm test`: encheria a tela de avisos a cada execução.
// Ele foi conferido à mão em 2026-10-18, com título e corpo cheios de aspas, <tag>, & e $(...): saiu com 0.
import assert from 'node:assert/strict';
import { createNotify, SCRIPT } from '../notify.ts';

const casos: string[] = [];
const caso = (nome: string, fn: () => void) => { fn(); casos.push(nome); };

caso('o script não tem aspas duplas: o -Command do powershell.exe as embaralha', () => {
  assert.ok(!SCRIPT.includes('"'), SCRIPT);
  assert.ok(SCRIPT.includes('$Q = [char]34'), 'a aspa é montada dentro do script');
});

caso('o texto não é interpolado no script: só os nomes das variáveis de ambiente aparecem', () => {
  for (const v of ['FOLGA_TOAST_TITLE', 'FOLGA_TOAST_BODY', 'FOLGA_TOAST_URL']) {
    assert.ok(SCRIPT.includes(`$env:${v}`), v);
  }
  assert.ok(SCRIPT.includes('SecurityElement]::Escape'), 'e tudo passa pelo escape de XML');
});

caso('manda título, corpo e o endereço local do Folga', () => {
  const vistos: string[][] = [];
  const n = createNotify({ port: 4321, run: (t, b, u) => vistos.push([t, b, u]) });
  n.toast('Folga', 'liberar 1 GB — toque para decidir.');
  assert.deepEqual(vistos, [['Folga', 'liberar 1 GB — toque para decidir.', 'http://127.0.0.1:4321']]);
});

caso('se o Windows recusar uma vez, não insiste a cada proposta', () => {
  let n = 0;
  const notify = createNotify({ port: 1, run: () => { n++; throw new Error('sem toast aqui'); } });
  notify.toast('a', 'b');
  notify.toast('c', 'd');
  notify.toast('e', 'f');
  assert.equal(n, 1, 'tentou uma vez e desistiu');
});

caso('avisar nunca derruba quem chamou', () => {
  const notify = createNotify({ port: 1, run: () => { throw new Error('falhou'); } });
  assert.doesNotThrow(() => notify.toast('a', 'b'));
});

console.log(casos.map(c => 'ok  ' + c).join('\n'));
console.log(`notify: ${casos.length} casos ok`);
