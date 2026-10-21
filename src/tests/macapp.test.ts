import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
// @ts-ignore: JS puro, é o próprio script de montar o Folga.app
import { requirementWeak } from '../../scripts/mac-app.mjs';

// Requisito designado: é a conta que o TCC faz para manter o Acesso Total ao Disco depois de reinstalar.
assert.equal(requirementWeak('designated => identifier "local.folga.app"'), true);            // qualquer ad-hoc com o id herdaria o TCC
assert.equal(requirementWeak('designated => identifier "local.folga.app" or cdhash H"ab12"'), true);
assert.equal(requirementWeak('designated => cdhash H"ab12"'), false);                        // ad-hoc: seguro, mas muda a cada build
assert.equal(requirementWeak('designated => identifier "local.folga.app" and certificate leaf = H"9f00"'), false);
assert.equal(requirementWeak(''), true);

if (process.platform === 'darwin') {
  // check num caminho que não é um app: vermelho, sem estourar
  const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', '..', 'scripts', 'mac-app.mjs'), 'check', '/nao/existe/Folga.app'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  // --out sem valor (ou com outra flag no lugar) recusa antes de montar qualquer coisa
  for (const args of [['build', '--out'], ['build', '--out', '--adhoc']]) {
    const o = spawnSync(process.execPath, [join(import.meta.dirname, '..', '..', 'scripts', 'mac-app.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(o.status, 1, o.stderr);
    assert.match(o.stderr, /--out precisa de um valor/);
  }
}
console.log('macapp: ok');
