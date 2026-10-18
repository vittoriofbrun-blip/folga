// QA ao vivo dos casos de borda do R07 com janelas reais, sem tocar em app do usuário:
// cada caso é um PowerShell nosso com uma janela WinForms, e a liberação só mira os PIDs deles.
//   node --no-warnings scripts/qa-live.ts
// Casos: duas janelas (fechou), diálogo "Salvar?" (ficou_aberto), vai para a bandeja (bandeja),
// bandeja + mayForceQuit (encerrado). Usa a sonda real e o mesmo release.ts do app.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProbe } from '../src/probe.ts';
import { createReleaser } from '../src/release.ts';
import { DEFAULT_SETTINGS, type AppGroup, type MemoryState, type ProbeReply, type ProbeSnapshot } from '../src/types.ts';

const root = join(import.meta.dirname, '..');
const PS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// Janela pequena e minimizada; o modo decide o que acontece no WM_CLOSE.
const FORM = `
Add-Type -AssemblyName System.Windows.Forms
$mode = $env:FOLGA_QA_MODE
function New-Win($t) { $f = New-Object System.Windows.Forms.Form; $f.Text = $t; $f.Width = 320; $f.Height = 120; $f.WindowState = 'Minimized'; $f }
$f = New-Win ("Folga QA " + $mode)
if ($mode -eq 'save') { $f.Add_FormClosing({ param($s, $e) $e.Cancel = $true; [System.Windows.Forms.MessageBox]::Show('Salvar alteracoes?', 'Folga QA') | Out-Null }) }
if ($mode -eq 'tray' -or $mode -eq 'kill') { $f.Add_FormClosing({ param($s, $e) $e.Cancel = $true; $s.Hide() }) }
if ($mode -eq 'multi') { $g = New-Win 'Folga QA multi 2'; $g.Show() }
[System.Windows.Forms.Application]::Run($f)
`;

const MODES = ['multi', 'save', 'tray', 'kill'] as const;
const EXPECT = { multi: 'fechou', save: 'ficou_aberto', tray: 'bandeja', kill: 'encerrado' } as const;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const kids = new Map<string, ChildProcess>();
for (const mode of MODES) {
  kids.set(mode, spawn(PS, ['-NoProfile', '-NonInteractive', '-STA', '-Command', FORM], {
    env: { ...process.env, FOLGA_QA_MODE: mode }, stdio: 'ignore', shell: false,
  }));
}
const pidOf = (mode: string) => kids.get(mode)!.pid!;

let last: ProbeSnapshot | null = null;
const waiters: ((s: ProbeSnapshot) => void)[] = [];
const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const cs = join(root, 'probe', 'probe.cs').replaceAll("'", "''");
const probe = startProbe(ps, ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Path '${cs}'; [Probe]::Main(@('--interval','1'))`], s => {
  last = s;
  for (const w of waiters.splice(0)) w(s);
});

// Estado só com os nossos grupos: "qa-<modo>" com o pid da janela de teste.
function toState(s: ProbeSnapshot): MemoryState {
  const apps: AppGroup[] = MODES.flatMap(mode => {
    const p = s.processes.find(x => x.pid === pidOf(mode));
    if (!p) return [];
    return [{ key: `qa-${mode}`, name: `QA ${mode}`, pids: [p.pid], privateWorkingSet: p.privateWorkingSet, cpuPercent: 0,
      state: p.hasVisibleWindow ? 'idle' : 'protected', reason: p.hasVisibleWindow ? 'idle' : 'no_window', lastFocusedAt: null } satisfies AppGroup];
  });
  return { t: s.t, memLoad: s.memLoad, totalPhys: s.totalPhys, availPhys: s.availPhys, apps, freed: [],
    settings: DEFAULT_SETTINGS, startedAt: 0, autoCare: { nextEligibleAt: null, lastRunAt: null } };
}

const replies: { pids: number[]; reply: ProbeReply }[] = [];
const dataDir = mkdtempSync(join(tmpdir(), 'folga-qa-'));
const settings = { ...DEFAULT_SETTINGS, mayForceQuit: ['qa-kill'] };
const releaser = createReleaser({
  dataDir,
  probe: { send: async cmd => { const reply = await probe.send(cmd); replies.push({ pids: cmd.pids, reply }); return reply; } },
  getState: () => (last ? toState(last) : null),
  getSettings: () => settings,
  waitForSnapshot: () => new Promise(r => waiters.push(s => r(toState(s)))),
});

let failed = false;
try {
  // espera as 4 janelas aparecerem para a sonda
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (last && MODES.every(m => last!.processes.some(p => p.pid === pidOf(m) && p.hasVisibleWindow))) break;
  }
  const ready = toState(last!);
  assert.equal(ready.apps.filter(a => a.state === 'idle').length, 4, 'as 4 janelas de teste deveriam estar visíveis');
  console.log('ok  as 4 janelas de teste apareceram para a sonda');

  const r = await releaser.release(MODES.map(m => `qa-${m}`), 'manual');
  assert.ok(!('erro' in r), JSON.stringify(r));
  for (const mode of MODES) {
    const got = r.results.find(x => x.key === `qa-${mode}`)?.outcome;
    console.log(`${got === EXPECT[mode] ? 'ok  ' : 'FAIL'} ${mode}: esperado ${EXPECT[mode]}, veio ${got}`);
    if (got !== EXPECT[mode]) failed = true;
  }
  const multi = replies.find(x => x.pids.includes(pidOf('multi')));
  console.log(`${multi?.reply.windowsClosed === 2 ? 'ok  ' : 'FAIL'} multi: WM_CLOSE em ${multi?.reply.windowsClosed} janelas (esperado 2)`);
  if (multi?.reply.windowsClosed !== 2) failed = true;
} catch (e) {
  failed = true;
  console.error('FAIL', e instanceof Error ? e.message : e);
} finally {
  for (const k of kids.values()) if (k.exitCode === null) k.kill();   // limpa as janelas que ficaram (save, tray)
  probe.stop();
  rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? 'qa-live: FALHOU' : 'qa-live: 5 casos ok');
  setTimeout(() => process.exit(), 1_500).unref();
}
