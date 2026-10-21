// Monta e confere o Folga.app (plano 3, ADR 0007). Só Mac.
//   node scripts/mac-app.mjs build [--adhoc] [--out <dir>]   -> <dir>/Folga.app (padrão build/)
//   node scripts/mac-app.mjs check <app> [--previous <arquivo>]  -> sai 0 (verde) ou 1
// O --previous recebe a saída de `codesign -d -r- <app do build anterior>` gravada num arquivo: é a conta
// que o TCC faz para manter o Acesso Total ao Disco depois de reinstalar.
// Assinatura: ad-hoc (ramo B do ADR 0007). O spike da identidade "Folga Local" autoassinada falhou: o codesign
// não acha identidade sem confiança, e dar confiança abre janela de senha. `--adhoc` fica aceito (é o que a CI passa).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ID = 'local.folga.app';

/**
 * Requisito designado fraco = algum ramo do `or` não prende a um hash (cdhash ou certificado folha por hash).
 * Só `identifier` deixaria qualquer binário ad-hoc com o mesmo id herdar o Acesso Total ao Disco.
 * ponytail: corta no ` or ` sem olhar parênteses; erra para o lado de "fraco", nunca de "forte".
 */
export function requirementWeak(dr) {
  const expr = String(dr).replace(/^[#\s]*designated\s*=>\s*/, '').trim();
  if (!expr) return true;
  return expr.split(/\sor\s/).some(r => !/cdhash H"[0-9a-f]+"|certificate leaf = H"[0-9a-f]+"/i.test(r));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { shell: false, encoding: 'utf8', ...opts });
  return { ok: !r.error && r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), stdout: (r.stdout ?? '').trim() };
}
function must(cmd, args) {
  const r = run(cmd, args);
  if (!r.ok) { console.error(`falhou: ${cmd} ${args.join(' ')}\n${r.out}`); process.exit(1); }
  return r;
}
const version = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

function build(outDir) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('falta a interface: rode npm run build'); process.exit(1); }
  const probe = join(ROOT, 'probe', 'bin', 'probe-mac');
  if (!existsSync(probe)) { console.error('falta a sonda: rode npm run build:probe'); process.exit(1); }

  const app = join(outDir, 'Folga.app');
  const res = join(app, 'Contents', 'Resources');
  const macos = join(app, 'Contents', 'MacOS');
  rmSync(app, { recursive: true, force: true });
  mkdirSync(macos, { recursive: true });
  mkdirSync(join(res, 'folga', 'probe', 'bin'), { recursive: true });

  must('/usr/bin/xcrun', ['swiftc', '-O', join(ROOT, 'mac', 'Folga.swift'), '-o', join(macos, 'Folga')]);

  // cpSync recursivo: o aviso do CLAUDE.md (caminho com acento) é do Windows; este script só roda no Mac
  const testes = join(ROOT, 'src', 'tests');
  cpSync(join(ROOT, 'src'), join(res, 'folga', 'src'), { recursive: true, filter: p => p !== testes && !p.startsWith(testes + sep) });
  cpSync(join(ROOT, 'dist'), join(res, 'folga', 'dist'), { recursive: true });
  cpSync(probe, join(res, 'folga', 'probe', 'bin', 'probe-mac'));
  cpSync(join(ROOT, 'package.json'), join(res, 'folga', 'package.json'));
  // node de quem rodou o build: o app não depende do PATH nem do que outra sessão deixou no repositório
  writeFileSync(join(res, 'folga.json'), JSON.stringify({ node: process.execPath, path: process.env.PATH ?? '' }, null, 2) + '\n');

  const v = version();
  const plist = join(app, 'Contents', 'Info.plist');
  writeFileSync(plist, JSON.stringify({
    CFBundleIdentifier: ID, CFBundleExecutable: 'Folga', CFBundleName: 'Folga', CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: v, CFBundleVersion: v, LSUIElement: true, LSMinimumSystemVersion: '13.0',
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
  }));
  must('/usr/bin/plutil', ['-convert', 'xml1', plist]);

  // a sonda de dentro antes do bundle (o selo do bundle cobre o binário já assinado), mesma identidade
  must('/usr/bin/codesign', ['--force', '-s', '-', join(res, 'folga', 'probe', 'bin', 'probe-mac')]);
  must('/usr/bin/codesign', ['--force', '-s', '-', app]);
  console.log(`ok: ${app}`);
}

/** Linha "designated => ..." da saída do `codesign -d -r-` (ou o próprio texto, se já for só o requisito). */
function designated(text) {
  const line = String(text).split('\n').find(l => l.includes('designated =>'));
  return (line ?? '').replace(/^[#\s]*designated\s*=>\s*/, '').trim();
}

function check(app, previous) {
  let falhas = 0;
  const caso = (nome, ok, detalhe = '') => {
    console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${nome}${!ok && detalhe ? `\n       ${detalhe}` : ''}`);
    if (!ok) falhas++;
  };
  const plist = join(app, 'Contents', 'Info.plist');
  const exe = join(app, 'Contents', 'MacOS', 'Folga');
  const probe = join(app, 'Contents', 'Resources', 'folga', 'probe', 'bin', 'probe-mac');
  if (!existsSync(plist) || !existsSync(exe)) { caso(`${app} é um Folga.app`, false); return 1; }

  let r = run('/usr/bin/plutil', ['-lint', plist]); caso('Info.plist válido', r.ok, r.out);
  r = run('/usr/bin/plutil', ['-extract', 'LSUIElement', 'raw', plist]); caso('LSUIElement verdadeiro', r.stdout === 'true', r.out);
  r = run(exe, ['--version']); caso(`Folga --version = folga ${version()}`, r.stdout === `folga ${version()}`, r.out);
  r = run(exe, ['--selftest']); caso('Folga --selftest', r.ok, r.out);
  r = run('/usr/bin/codesign', ['--verify', '--strict', app]); caso('assinatura do bundle', r.ok, r.out);
  r = run('/usr/bin/codesign', ['--verify', '--strict', probe]); caso('assinatura da sonda de dentro', r.ok, r.out);
  r = run('/usr/bin/codesign', ['-d', '-r-', app]);
  const dr = designated(r.stdout);
  caso(`requisito designado preso a hash (${dr || 'vazio'})`, r.ok && !requirementWeak(dr), r.out);
  if (previous) {
    const prev = designated(readFileSync(previous, 'utf8'));
    r = run('/usr/bin/codesign', ['--verify', `-R=${prev}`, app]);
    caso(`requisito do build anterior vale neste (${prev || 'vazio'})`, !!prev && r.ok, r.out);
  }
  return falhas ? 1 : 0;
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  if (process.platform !== 'darwin') { console.error('o Folga.app só existe no Mac'); process.exit(1); }
  if (cmd === 'build') build(resolve(opt('--out') ?? join(ROOT, 'build'))); // --adhoc: aceito, é o único ramo
  else if (cmd === 'check' && rest[0]) process.exitCode = check(resolve(rest[0]), opt('--previous'));
  else { console.error('uso: node scripts/mac-app.mjs build [--adhoc] [--out <dir>] | check <app> [--previous <arquivo>]'); process.exit(1); }
}
