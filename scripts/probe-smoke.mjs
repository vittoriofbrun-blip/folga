// Teste de fumaca da sonda (Windows e Mac): 3 snapshots conferidos pelo contrato, filho de carga
// (CPU ~100 % e ~200 MB, pega unidade errada), resumo, comando close vazio, saida ao fechar o stdin.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { snapshotErrors, replyErrors } from './contract.mjs';

const isMac = process.platform === 'darwin';
const textedit = isMac && process.argv.includes('--textedit');   // abre o TextEdit e exige foco + janela dele
const exe = join(dirname(fileURLToPath(import.meta.url)), '..', 'probe', 'bin', isMac ? 'probe-mac' : 'probe.exe');
const GB = 1024 ** 3, MB = 1024 ** 2;
let load;
const fail = (msg) => { load?.kill(); console.error('FALHOU:', msg); process.exit(1); };

// Filho de carga: um núcleo a 100 % e ~200 MB residentes. Sobe antes da sonda.
load = spawn(process.execPath, ['-e', 'const b = Buffer.alloc(200e6, 1); for (;;) b[0]++'], { stdio: 'ignore' });

// Padrao igual ao servidor: probe.cs via Add-Type do PowerShell. FOLGA_PROBE_EXE=1 testa o .exe compilado.
const useExe = process.env.FOLGA_PROBE_EXE === '1';
if (useExe && !existsSync(exe)) fail(`${exe} nao existe; rode node scripts/build-probe.mjs (se sumiu logo apos compilar, o antivirus apagou o exe: ver ADR 0002)`);
const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const cs = join(dirname(fileURLToPath(import.meta.url)), '..', 'probe', 'probe.cs').replaceAll("'", "''");
const [cmd, args] = isMac ? [exe, ['--interval', '1']] : useExe
  ? [exe, ['--interval', '1']]
  : [ps, ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Path '${cs}'; [Probe]::Main(@('--interval','1'))`]];

let child;
try { child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], shell: false }); }
catch (e) { fail(`${e.message} (spawn bloqueado: antivirus? ver ADR 0002)`); }
child.on('error', (e) => fail(`${e.message} (spawn bloqueado: antivirus? ver ADR 0002)`));
const exited = new Promise((res) => child.on('exit', (code) => res(code)));

const snaps = [];
let reply = null;
let wake = () => {};
const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return fail(`linha nao e JSON: ${line.slice(0, 120)}`); }
  if (m.type === 'snapshot') snaps.push(m);
  else if (m.type === 'reply') reply = m;
  wake();
});
const until = (cond, ms, what) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout esperando ${what}`)), ms);
  wake = () => { if (cond()) { clearTimeout(t); res(); } };
  wake();
});

try {
  await until(() => snaps.length >= 3, 10000, '3 snapshots');
  const s = snaps[2];
  for (const [i, x] of snaps.entries()) { const e = snapshotErrors(x, { mac: isMac, prev: snaps[i - 1] }); if (e.length) fail(e.join('; ')); }
  const a = snaps[1].processes.find((p) => p.pid === load.pid), b = s.processes.find((p) => p.pid === load.pid);
  if (!a || !b) fail('o filho de carga nao aparece nos snapshots');
  const cpu = (b.cpuTimeMs - a.cpuTimeMs) / (s.t - snaps[1].t) * 100;
  console.log(`filho de carga: CPU ${cpu.toFixed(0)} %  ${(b.privateWorkingSet / MB).toFixed(1)} MB`);
  if (cpu < 70 || cpu > 130) fail(`CPU do filho de carga ${cpu.toFixed(0)} % (esperado ~100): unidade errada?`);
  if (b.privateWorkingSet < 190e6) fail(`memória do filho de carga ${b.privateWorkingSet} < 190 MB: unidade errada?`);
  if (isMac) { const h = s.processes.find((p) => / Helper \(/.test(p.name)); if (h) fail(`helper fora do bundle: ${h.name}`); }
  const gb = (n) => (n / GB).toFixed(2);
  console.log(`diskActive=${snaps.map((x) => x.diskActive).join(",")}`);
  console.log(`memLoad=${s.memLoad}%  total=${gb(s.totalPhys)} GB  disponivel=${gb(s.availPhys)} GB`);
  console.log(`foregroundPid=${s.foregroundPid}  processos=${s.processes.length}  acessiveis=${s.processes.filter((p) => p.accessible).length}  com janela=${s.processes.filter((p) => p.hasVisibleWindow).length}`);
  if (isMac) {
    console.log(`memPressure=${s.memPressure}  swapUsed=${gb(s.swapUsed)} GB`);
    console.log(`audioPids=${(s.audioPids ?? []).map((pid) => `${pid}:${s.processes.find((p) => p.pid === pid)?.name}`).join(' ')}`);
    const te = s.processes.find((p) => p.name.toLowerCase() === 'com.apple.textedit' && p.hasVisibleWindow);
    if (te) console.log(`textedit: pid=${te.pid} hasVisibleWindow=${te.hasVisibleWindow} windowCount=${te.windowCount}`);
    if (!textedit && !(snaps[0].diskActive === null && typeof s.diskActive === 'number')) fail(`diskActive: esperado null na 1ª leitura e número depois, veio ${snaps.map((x) => x.diskActive)}`);
  }
  if (!(s.totalPhys > s.availPhys && s.availPhys > 0 && s.processes.length > 20)) fail('numeros implausiveis');

  if (textedit) {
    spawn('/usr/bin/open', ['-a', 'TextEdit'], { stdio: 'ignore' });
    const ok = (x) => x.processes.some((p) => p.pid === x.foregroundPid && p.name.toLowerCase() === 'com.apple.textedit' && p.hasVisibleWindow === true && p.windowCount >= 1);
    try { await until(() => ok(snaps.at(-1)), 10000, 'TextEdit'); }
    catch { fail('primeiro plano ou janela do TextEdit não apareceu'); }
    const te = snaps.at(-1).processes.find((p) => p.pid === snaps.at(-1).foregroundPid);
    console.log(`TextEdit em primeiro plano: pid=${te.pid} windowCount=${te.windowCount}`);
  }

  const groups = new Map();
  for (const p of s.processes) {
    const k = p.name.toLowerCase().replace(/\.exe$/, '');
    groups.set(k, (groups.get(k) ?? 0) + p.privateWorkingSet);
  }
  console.log('top 10 por privateWorkingSet (soma por nome):');
  [...groups].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([k, v]) => console.log(`  ${k.padEnd(28)} ${(v / MB).toFixed(1).padStart(9)} MB`));

  const me = s.processes.find((p) => p.pid === child.pid);
  if (!me) fail('a propria sonda nao aparece no snapshot');
  console.log(`sonda: pid=${me.pid} privateWorkingSet=${(me.privateWorkingSet / MB).toFixed(1)} MB`);

  child.stdin.write('{"type":"close","id":"t1","pids":[]}\n');
  await until(() => reply, 5000, 'reply do close');
  const re = replyErrors(reply, 't1');
  if (re.length || reply.ok !== true || reply.windowsClosed !== 0) fail(`reply inesperado: ${JSON.stringify(reply)} ${re.join('; ')}`);
  console.log('reply:', JSON.stringify(reply));

  child.stdin.end();
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 3000))]);
  if (code === 'timeout') { child.kill(); fail('a sonda nao saiu em 3 s depois de fechar o stdin'); }
  console.log(`sonda saiu sozinha (exitCode ${code})`);
  load.kill();
  console.log('OK');
} catch (e) {
  child.kill();
  fail(e.message);
}
