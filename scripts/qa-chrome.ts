// F-13 sem tocar no Chrome do usuário: um Chrome com perfil temporário e 3 janelas.
// Compara o "Sair" do navegador (Browser.close pelo DevTools) com o jeito do Folga (WM_CLOSE em cada janela,
// pela sonda real) e conta quantas janelas voltam quando o Chrome reabre a última sessão.
// Resultado em 2026-10-18: "Sair" devolveu as 3 janelas; o WM_CLOSE do Folga devolveu só 1 (R29).
//   node --no-warnings scripts/qa-chrome.ts
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startProbe } from '../src/probe.ts';
import type { ProbeSnapshot } from '../src/types.ts';

const root = join(import.meta.dirname, '..');
const CHROME = [
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
].find(existsSync);
if (!CHROME) { console.log('Chrome não instalado: nada a testar'); process.exit(0); }

const PORT = 9333;
const PS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const dir = mkdtempSync(join(tmpdir(), 'folga-chrome-'));
const profile = join(dir, 'perfil');
// O "continuar de onde parou" gravado no perfil é desfeito pelo Chrome (preferência protegida), então a
// reabertura usa --restore-last-session: mostra exatamente o que o Chrome gravou como última sessão.
const pages = ['A', 'B', 'C'].map(n => {
  const f = join(dir, `${n}.html`);
  writeFileSync(f, `<title>Folga QA ${n}</title>${n}`);
  return pathToFileURL(f).href;
});
const FLAGS = [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-sync', '--window-size=420,300', '--window-position=0,0'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const launch = (extra: string[]) => { spawn(CHROME, [...FLAGS, ...extra], { stdio: 'ignore', shell: false }).unref(); };
const api = async (path: string) => (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { await api('/json/version'); return; } catch { await sleep(250); } }
  throw new Error('o Chrome de teste não abriu a porta de depuração');
}
async function windowsNow(): Promise<string[]> {
  const list = await api('/json/list') as { type: string; title: string; url: string }[];
  return list.filter(t => t.type === 'page' && t.url.startsWith('file:')).map(t => t.title).sort();
}
// processo do navegador (sem --type=) deste perfil, e só dele
function browserPid(): number | null {
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${basename(dir)}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }`],
    { encoding: 'utf8' });
  const pid = Number(r.stdout.trim().split(/\s+/)[0]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitExit(pid: number) { for (let i = 0; i < 60 && alive(pid); i++) await sleep(250); return !alive(pid); }
async function browserClose() {
  const v = await api('/json/version') as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise<void>((ok, fail) => { ws.onopen = () => { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); ok(); }; ws.onerror = () => fail(new Error('DevTools')); });
}

let first: ProbeSnapshot | null = null;
const cs = join(root, 'probe', 'probe.cs').replaceAll("'", "''");
const probe = startProbe(PS, ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Path '${cs}'; [Probe]::Main(@('--interval','1'))`], s => { first ??= s; });

let pid: number | null = null;
try {
  try { await api('/json/version'); throw new Error(`porta ${PORT} já em uso`); } catch (e) { if (e instanceof Error && e.message.startsWith('porta')) throw e; }
  launch([pages[0]!]);
  await waitUp(); await sleep(1500);
  launch(['--new-window', pages[1]!]); await sleep(1500);
  launch(['--new-window', pages[2]!]); await sleep(2500);
  console.log('abertas:', (await windowsNow()).join(', '));

  // controle: "Sair" do navegador
  pid = browserPid();
  await browserClose();
  if (!pid || !(await waitExit(pid))) throw new Error('o Chrome de teste não fechou pelo Browser.close');
  launch(['--restore-last-session']); await waitUp(); await sleep(3000);
  console.log('reabertas depois do Sair:', (await windowsNow()).join(', '));

  // jeito do Folga: WM_CLOSE em cada janela visível dos PIDs, pela sonda
  for (let i = 0; i < 40 && !first; i++) await sleep(250);
  pid = browserPid();
  if (!pid) throw new Error('processo do Chrome de teste não achado');
  const reply = await probe.send({ type: 'close', id: 'qa-chrome', pids: [pid] });
  console.log(`WM_CLOSE em ${reply.windowsClosed} janelas`);
  if (!(await waitExit(pid))) throw new Error('o Chrome de teste não fechou pelo WM_CLOSE');
  launch(['--restore-last-session']); await waitUp(); await sleep(3000);
  console.log('reabertas depois do WM_CLOSE do Folga:', (await windowsNow()).join(', '));
} catch (e) {
  console.error('FALHOU:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  try { pid = browserPid(); await browserClose(); if (pid) await waitExit(pid); } catch { /* já fechado */ }
  pid = browserPid();
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  if (pid) spawnSync(taskkill, ['/PID', String(pid), '/T', '/F']);   // só o Chrome de teste: o filtro é o perfil temporário
  probe.stop();
  await sleep(1000);
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  setTimeout(() => process.exit(), 1000).unref();
}
