// Avisos (D15, R26): limiares, dedupe, remoção, sonda, Auto Care, antivírus, travamentos, apps de inicialização.
// Sem processos reais: o exec, o relógio e o statfs são injetados.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  approvedEnabled, avWarning, cleanName, macCrashes, macDiskInfo, parseCrashText, parseIpsHeader, createWarnings, decodeAvState, parseAv, parseCrashes, parseRegQuery, settingsWarning,
  type WarningsDeps,
} from '../warnings.ts';
import { DEFAULT_SETTINGS, type MemoryState, type Warning } from '../types.ts';

let passed = 0;
const ok = (name: string) => { passed++; console.log(`ok  ${name}`); };

const GB = 1024 ** 3;
function rig(over: Partial<WarningsDeps> = {}) {
  const env = {
    t: Date.UTC(2026, 9, 18, 15, 0, 0), memLoad: 50, alive: true, lastRun: null as number | null,
    disk: { total: 500 * GB, free: 200 * GB }, emitted: [] as Warning[][],
    settingsProblem: null as string | null,
  };
  const deps: WarningsDeps = {
    getState: () => ({ memLoad: env.memLoad } as MemoryState),
    getSettings: () => ({ ...DEFAULT_SETTINGS, autoCareThreshold: 92 }),
    probeAlive: () => env.alive,
    lastAutoCareRun: () => env.lastRun,
    settingsProblem: () => env.settingsProblem,
    emit: (_e, data) => { env.emitted.push(data as Warning[]); },
    now: () => env.t,
    platform: 'win32',   // estes casos são do disco do Windows; o do Mac é macDiskInfo
    statfs: async () => ({ bsize: 4096, blocks: env.disk.total / 4096, bavail: env.disk.free / 4096 }),
    exec: async () => { throw new Error('exec não esperado'); },
    ...over,
  };
  return { env, w: createWarnings(deps) };
}
const ids = (w: { list(): Warning[] }) => w.list().map(x => x.id);

// valores reais desta máquina (Get-CimInstance root/SecurityCenter2, 2026-10-18)
const DEFENDER = 393472;   // 0x060100: Windows Defender, inativo porque o McAfee assumiu
const MCAFEE = 266240;     // 0x041000: McAfee ativo e em dia

{
  const { env, w } = rig();
  await w.run.fast();
  assert.deepEqual(ids(w), []);
  env.memLoad = 91; await w.run.fast();
  assert.deepEqual(ids(w), []);
  env.memLoad = 92; await w.run.fast();
  assert.equal(w.list()[0]?.severity, 'atencao');
  assert.equal(w.list()[0]?.view, 'memoria');
  assert.match(w.list()[0]!.detail, /92 %/);
  env.memLoad = 96; await w.run.fast();
  assert.equal(w.list()[0]?.severity, 'atencao');
  env.memLoad = 97; await w.run.fast();
  assert.equal(w.list()[0]?.severity, 'critico');
  env.memLoad = 40; await w.run.fast();
  assert.deepEqual(ids(w), []);
  ok('memória: atenção na linha do Auto Care, crítico em 97 %, some ao baixar');
}
{
  const { env, w } = rig();
  const at = async (pct: number) => { env.disk = { total: 1000 * GB, free: pct * 10 * GB }; await w.run.fast(); return w.list().find(x => x.id === 'disco:C:'); };
  assert.equal(await at(10), undefined);          // 10 % exato não avisa
  assert.equal((await at(9.9))?.severity, 'atencao');
  assert.equal((await at(5))?.severity, 'atencao');   // 5 % exato ainda é atenção
  assert.equal((await at(4.9))?.severity, 'critico');
  assert.equal(w.list()[0]?.view, 'arquivos');
  assert.equal(await at(30), undefined);
  ok('disco: atenção < 10 %, crítico < 5 %, id disco:C:');
}
{
  const { env, w } = rig();
  const d = await w.disk();
  assert.equal(d[0]?.drive, (process.env.SystemDrive ?? 'C:').toUpperCase());
  assert.equal(d[0]?.total, env.disk.total);
  assert.equal(d[0]?.free, env.disk.free);
  const seen = new Set(d.map(x => x.drive));
  assert.equal(seen.size, d.length);   // sistema e perfil no mesmo disco = uma entrada só
  ok('disk(): DiskInfo em bytes, sem disco repetido');
}
{
  const { env, w } = rig();
  env.memLoad = 95; await w.run.fast();
  const first = w.list()[0]!;
  env.t += 30_000; await w.run.fast(); await w.run.fast();
  assert.equal(w.list().length, 1);
  assert.equal(w.list()[0]!.firstSeen, first.firstSeen);
  assert.equal(w.list()[0]!.lastSeen, env.t);
  assert.equal(env.emitted.length, 1, 'lastSeen mudou mas a lista visível não: sem novo emit');
  env.memLoad = 50; await w.run.fast();
  assert.deepEqual(ids(w), []);
  assert.equal(env.emitted.length, 2);
  assert.deepEqual(env.emitted[1], []);
  ok('dedupe atualiza lastSeen sem emitir; causa que some tira o aviso e emite');
}
{
  const { env, w } = rig();
  await w.run.fast(); await w.run.probe();
  assert.equal(env.emitted.length, 0, 'lista vazia desde o início: nada a emitir');
  env.memLoad = 92; await w.run.fast();
  env.memLoad = 98; await w.run.fast();
  assert.equal(env.emitted.length, 2);
  assert.equal(env.emitted[1]![0]!.severity, 'critico');
  ok('emit só quando a lista muda (nova causa ou nova gravidade)');
}
{
  const { env, w } = rig();
  env.alive = false; await w.run.probe();
  assert.deepEqual(ids(w), []);
  env.t += 30_000; await w.run.probe();
  assert.deepEqual(ids(w), [], 'exatamente 30 s ainda não é "mais de 30 s"');
  env.t += 1; await w.run.probe();
  assert.deepEqual(ids(w), ['sonda']);
  assert.equal(w.list()[0]?.severity, 'critico');
  env.alive = true; await w.run.probe();
  assert.deepEqual(ids(w), []);
  env.alive = false; await w.run.probe(); env.t += 10_000; await w.run.probe();
  assert.deepEqual(ids(w), [], 'queda nova reinicia a contagem');
  ok('sonda: crítico só depois de mais de 30 s fora; some quando volta');
}
{
  const { env, w } = rig();
  await w.run.fast();
  assert.deepEqual(ids(w), []);
  const ran = env.t - 5 * 60_000;
  env.lastRun = ran; await w.run.fast();
  const a = w.list()[0]!;
  assert.equal(a.id, 'autocare'); assert.equal(a.severity, 'info'); assert.equal(a.view, 'registro');
  assert.match(a.title, /^O Auto Care liberou memória às \d{2}:\d{2}$/);
  assert.equal(a.firstSeen, ran);
  const before = env.emitted.length;
  env.t += 20 * 60_000; await w.run.fast();
  assert.equal(env.emitted.length, before, 'mesmo valor: nada novo');
  env.lastRun = env.t - 1000; await w.run.fast();   // rodou de novo
  assert.equal(env.emitted.length, before + 1);
  assert.equal(w.list()[0]!.firstSeen, env.lastRun);
  env.t += 60 * 60_000; await w.run.fast();
  assert.deepEqual(ids(w), [], 'some depois de 1 h');
  ok('Auto Care: info com a hora da rodada, renova numa rodada nova, some em 1 h');
}
{
  assert.deepEqual(decodeAvState(MCAFEE), { active: true, upToDate: true });
  assert.deepEqual(decodeAvState(DEFENDER), { active: false, upToDate: true });
  assert.deepEqual(decodeAvState(0x041010), { active: true, upToDate: false });   // bit de "desatualizado"
  assert.deepEqual(decodeAvState(0x040000), { active: false, upToDate: true });   // desligado
  ok('productState decodificado (McAfee 266240 ativo, Defender 393472 inativo)');
}
{
  // R34: ajustes que não foram lidos viram aviso crítico; é a única pista que o usuário tem de que o
  // Auto Care e o "nunca fechar" dele voltaram aos padrões sozinhos.
  assert.equal(settingsWarning(null), null);
  const s = settingsWarning('Unexpected token');
  assert.equal(s?.id, 'ajustes');
  assert.equal(s?.severity, 'critico');
  assert.equal(s?.view, 'ajustes');
  assert.match(s!.detail, /padrões de fábrica/);
  assert.match(s!.detail, /Unexpected token/);
  ok('R34: aviso crítico quando o settings.json não valeu');
}
{
  const { env, w } = rig();
  await w.run.fast();
  assert.equal(w.list().some(x => x.kind === 'ajustes'), false, 'ajustes lidos: nenhum aviso');
  env.settingsProblem = 'arquivo quebrado';
  await w.run.fast();
  const a = w.list().find(x => x.kind === 'ajustes');
  assert.equal(a?.severity, 'critico');
  env.settingsProblem = null;
  await w.run.fast();
  assert.equal(w.list().some(x => x.kind === 'ajustes'), false, 'resolvido: o aviso sai da lista');
  ok('R34: o aviso aparece e some junto com o problema');
}
{
  const real = '[{"displayName":"Windows Defender","productState":393472},{"displayName":"McAfee","productState":266240}]';
  assert.equal(avWarning(parseAv(real)), null);
  assert.equal(avWarning(parseAv('{"displayName":"McAfee","productState":266240}')), null, 'objeto único (PowerShell sem array)');
  const off = avWarning(parseAv('[{"displayName":"Windows Defender","productState":393472}]'));
  assert.equal(off?.title, 'Antivírus desligado'); assert.equal(off?.severity, 'critico'); assert.equal(off?.id, 'antivirus');
  const old = avWarning(parseAv('[{"displayName":"McAfee","productState":266256}]'));   // 0x041010
  assert.equal(old?.title, 'Antivírus desatualizado');
  assert.equal(avWarning(parseAv('[]'))?.title, 'Antivírus desligado');
  assert.equal(avWarning(parseAv('')) !== null, true);
  assert.deepEqual(parseAv('[{"displayName":1}]'), []);
  ok('antivírus: sem aviso com o McAfee real; aviso se desligado, desatualizado ou ausente');
}
{
  const calls: string[] = [];
  const { env, w } = rig({
    exec: async (_f, args) => {
      const script = args[args.length - 1]!;
      calls.push(script);
      if (script.includes('AntiVirusProduct')) return '[{"displayName":"McAfee","productState":266240}]';
      return JSON.stringify([{ id: 1000, app: 'chrome.exe' }, { id: 1002, app: 'Chrome.exe' }, { id: 1000, app: 'Notepad.EXE' }]);
    },
  });
  await w.run.crashes(); await w.run.antivirus();
  assert.deepEqual(ids(w).sort(), ['travamento:chrome', 'travamento:notepad']);
  const chrome = w.list().find(x => x.id === 'travamento:chrome')!;
  assert.equal(chrome.severity, 'atencao'); assert.equal(chrome.title, 'chrome travou');
  assert.equal(chrome.detail, 'Travou 2 vezes nas últimas 24 h.');
  assert.equal(w.list().find(x => x.id === 'travamento:notepad')!.detail, 'Travou 1 vez nas últimas 24 h.');
  assert.ok(calls.every(s => s.startsWith('[Console]::OutputEncoding=[Text.Encoding]::UTF8;')));
  assert.ok(calls[0]!.includes("ProviderName='Application Error','Application Hang'") && calls[0]!.includes('-MaxEvents 50'));
  void env;
  ok('travamentos: um aviso por app, contagem, nome sem .exe, script fixo em UTF-8');
}
{
  assert.deepEqual(parseCrashes(''), []);
  assert.deepEqual(parseCrashes('[]'), []);
  assert.equal(parseCrashes('{"id":1002,"app":"  ZoomIt.exe "}')[0]?.id, 'travamento:zoomit');
  assert.deepEqual(parseCrashes('[{"id":1000,"app":""},{"id":1000}]'), []);
  // "sem eventos" e depois evento que some: o aviso sai
  let out = '[{"id":1000,"app":"a.exe"}]';
  const { w } = rig({ exec: async () => out });
  await w.run.crashes(); assert.deepEqual(ids(w), ['travamento:a']);
  out = '[]'; await w.run.crashes(); assert.deepEqual(ids(w), []);
  out = '[{"id":1000,"app":"b.exe"}]'; await w.run.crashes();
  out = 'lixo'; await w.run.crashes();   // consulta quebrada: mantém o que havia
  assert.deepEqual(ids(w), ['travamento:b']);
  ok('travamentos: saída vazia/única/lixo e remoção quando o app para de travar');
}
{
  const txt = [
    '', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '    OneDrive    REG_SZ    "C:\\Users\\Antônio\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" /background',
    '    electron.app.LM Studio    REG_SZ    C:\\Users\\Antônio\\AppData\\Local\\Programs\\LM Studio\\LM Studio.exe --run-as-service',
    '    SecurityHealth    REG_EXPAND_SZ    %windir%\\system32\\SecurityHealthSystray.exe', '',
  ].join('\r\n');
  const r = parseRegQuery(txt);
  assert.equal(r.length, 3);
  assert.equal(r[0]?.name, 'OneDrive');
  assert.ok(r[0]?.data.includes('Antônio'));
  assert.equal(r[1]?.name, 'electron.app.LM Studio');
  assert.equal(r[2]?.type, 'REG_EXPAND_SZ');
  assert.equal(parseRegQuery('    Docker Desktop    REG_BINARY    030000000000000000000000')[0]?.data, '030000000000000000000000');
  assert.equal(approvedEnabled('030000000000000000000000'), false);
  assert.equal(approvedEnabled('0300000014E7FC94D625DD01'), false);
  assert.equal(approvedEnabled('020000000000000000000000'), true);
  assert.equal(approvedEnabled('06'), true);
  assert.equal(approvedEnabled(undefined), true);
  ok('reg.exe: parse de linhas reais e StartupApproved (03 = desativado)');
}
{
  const dir = mkdtempSync(join(tmpdir(), 'folga-startup-'));
  writeFileSync(join(dir, 'herdr.lnk'), ''); writeFileSync(join(dir, 'desktop.ini'), '');
  const queried: string[] = [];
  let calls = 0;
  const reg: Record<string, string> = {
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run': '    OneDrive    REG_SZ    "C:\\x\\OneDrive.exe"\r\n    Docker Desktop    REG_SZ    C:\\d.exe\r\n',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run': '    Docker Desktop    REG_BINARY    030000000000000000000000\r\n    OneDrive    REG_BINARY    020000000000000000000000\r\n',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run': '    SecurityHealth    REG_EXPAND_SZ    %windir%\\s.exe\r\n',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder': '    herdr.lnk    REG_BINARY    030000000000000000000000\r\n',
  };
  const { env, w } = rig({
    startupFolder: dir,
    exec: async (file, args) => {
      calls++;
      assert.ok(file.toLowerCase().endsWith('cmd.exe') && args.includes('65001'));
      const key = args[args.length - 1]!; queried.push(key);
      if (reg[key] === undefined) throw new Error('chave não existe');
      return reg[key]!;
    },
  });
  const apps = await w.startupApps();
  assert.deepEqual(apps.map(a => [a.name, a.source, a.enabled]), [
    ['Docker Desktop', 'registro_usuario', false],
    ['herdr', 'pasta_inicializar', false],
    ['OneDrive', 'registro_usuario', true],
    ['SecurityHealth', 'registro_maquina', true],
  ]);
  assert.ok(queried.some(k => k.includes('WOW6432Node')));
  const n = calls;
  env.t += 4 * 60_000; await w.startupApps();
  assert.equal(calls, n, 'cache de 5 min');
  env.t += 2 * 60_000; await w.startupApps();
  assert.ok(calls > n, 'cache vencido consulta de novo');
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  ok('startupApps: registro (usuário/máquina), pasta Inicializar, StartupApproved e cache de 5 min');
}
{
  // start() faz a primeira rodada na hora; stop() limpa os timers (o processo precisa terminar sozinho)
  const seen: string[] = [];
  const { env, w } = rig({
    exec: async (_f, args) => { const s = args[args.length - 1]!; seen.push(s.includes('AntiVirus') ? 'av' : 'crash'); return '[]'; },
  });
  env.memLoad = 95;
  w.start(); w.start();
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(seen.sort(), ['av', 'crash']);
  assert.deepEqual(ids(w), ['antivirus', 'memoria']);   // crítico antes de atenção (av '[]' = sem antivírus)
  const n = env.emitted.length;
  w.stop();
  env.memLoad = 40; await w.run.fast();
  assert.equal(env.emitted.length, n, 'depois do stop nada muda nem emite');
  ok('start() roda tudo logo; stop() limpa timers e silencia');
}

{
  const sf = { bsize: 4096, blocks: 55_700_000, bavail: 9_500_000 };
  const d = macDiskInfo(sf, { name: 'Macintosh HD', important: 52e9 });
  assert.equal(d.free, 4096 * 9_500_000);   // livre = o que o statfs diz, nunca + purgeable
  assert.equal(d.purgeable, 52e9 - 4096 * 9_500_000);
  assert.equal(d.drive, 'Macintosh HD');
  assert.equal(macDiskInfo({ bsize: 4096, blocks: 10, bavail: 5 }, { name: 'X', important: 1 }).purgeable, 0);   // nunca negativo
  assert.deepEqual(macDiskInfo({ bsize: 4096, blocks: 10, bavail: 5 }, null), { drive: 'Mac', total: 40960, free: 20480 });
  ok('macDiskInfo: livre do statfs, purgeable à parte e nunca negativo');
}

{
  const res: unknown[] = [{ name: 'Macintosh HD', important: 52e9 }, null, null];
  let calls = 0;
  const { env, w } = rig({ platform: 'darwin', macVolume: async () => { calls++; return res.shift() ?? null; } });
  const d1 = (await w.disk())[0]!;
  await w.disk();
  assert.equal(calls, 1, 'dentro de 10 min a sonda não é chamada de novo');
  assert.equal(d1.drive, 'Macintosh HD');
  env.t += 11 * 60_000;
  const d2 = (await w.disk())[0]!;
  assert.equal(calls, 2);
  assert.equal(d2.drive, 'Macintosh HD', 'falha da sonda mantém o nome');
  assert.equal(d2.purgeable, d1.purgeable, 'e o purgeable');
  // 1ª chamada falhou: a próxima leitura tenta de novo, senão o nome (e o id do aviso) só mudaria 10 min depois
  const res3: unknown[] = [null, { name: 'Macintosh HD', important: 1e9 }];
  let calls3 = 0;
  const { w: w3 } = rig({ platform: 'darwin', macVolume: async () => { calls3++; return res3.shift() ?? null; } });
  assert.equal((await w3.disk())[0]!.drive, 'Mac');
  assert.equal((await w3.disk())[0]!.drive, 'Macintosh HD', 'falha no começo: tenta de novo na leitura seguinte');
  await w3.disk();
  assert.equal(calls3, 2, 'depois de um sucesso volta a guardar 10 min');
  const { w: w2 } = rig({ platform: 'darwin', macVolume: async () => null, statfs: async () => { throw new Error('x'); } });
  assert.deepEqual(await w2.disk(), [], 'statfs falhou: sem disco, sem rejeição');
  ok('disco do Mac: cache de 10 min, falha da sonda mantém o último valor, statfs que falha não derruba');
}

{
  const fx = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'mac', n), 'utf8');
  const hdr = fx('ips-header.txt').split('\n')[0]!;
  assert.deepEqual(parseIpsHeader(hdr), { app: 'node', bugType: '309' });
  assert.equal(parseIpsHeader('{"app_name":'), null);
  assert.equal(parseIpsHeader('{"bug_type":"309"}'), null);
  assert.equal(parseIpsHeader(''), null);
  assert.equal(parseCrashText(fx('old.crash')), 'ExemploApp');
  assert.equal(parseCrashText('sem a linha'), null);
  const now = Date.UTC(2026, 9, 21, 15, 0, 0), H = 3600_000;
  const e = (file: string, ago: number, head = hdr) => ({ file, mtimeMs: now - ago * H, head });
  const one = macCrashes([e('node-1.ips', 1)], now);
  assert.equal(one[0]?.id, 'travamento:node');
  assert.equal(one[0]?.title, 'node travou');
  assert.equal(one[0]?.detail, 'Travou 1 vez nas últimas 24 h.');
  assert.equal(macCrashes([e('a.ips', 1), e('b.ips', 2)], now)[0]?.detail, 'Travou 2 vezes nas últimas 24 h.');
  assert.equal(macCrashes([e('x.crash', 1, fx('old.crash'))], now)[0]?.id, 'travamento:exemploapp');
  assert.deepEqual(macCrashes([e('a.diag', 1), e('Retired/a.ips', 1), e('old.ips', 25), e('b.ips', 1, hdr.replace('"309"', '"999"'))], now), []);
  const dirty = cleanName('Evil\u0007\nApp' + 'x'.repeat(200));
  assert.ok(!/[\u0000-\u001f\u007f]/.test(dirty) && dirty.length <= 80 && dirty.startsWith('Evil'));
  ok('Mac: cabeçalho .ips, .crash antigo, 24 h, Retired/.diag/tipo desconhecido fora, cleanName');
}
{
  const dir = mkdtempSync(join(tmpdir(), 'folga-crash-'));
  const hdr = readFileSync(join(import.meta.dirname, 'fixtures', 'mac', 'ips-header.txt'), 'utf8');
  writeFileSync(join(dir, 'node-1.ips'), hdr + '{"corpo":1}\n');
  mkdirSync(join(dir, 'Retired')); writeFileSync(join(dir, 'Retired', 'velho.ips'), hdr);
  const { env, w } = rig({ platform: 'darwin', crashDir: dir });
  const nowS = env.t / 1000;
  utimesSync(join(dir, 'node-1.ips'), nowS - 3600, nowS - 3600);
  await w.run.crashes();
  assert.deepEqual(ids(w), ['travamento:node']);
  await rm(join(dir, 'node-1.ips'));
  await w.run.crashes();
  assert.deepEqual(ids(w), [], 'relatório some: o aviso sai');
  writeFileSync(join(dir, 'node-2.ips'), hdr); utimesSync(join(dir, 'node-2.ips'), nowS - 3600, nowS - 3600);
  await w.run.crashes();
  await rm(dir, { recursive: true });
  await w.run.crashes();   // pasta ilegível: mantém
  assert.deepEqual(ids(w), ['travamento:node']);
  ok('travamentos do Mac: lê a pasta, aviso sai quando o arquivo some, pasta ilegível mantém');
}

console.log(`warnings: ${passed} casos ok`);
