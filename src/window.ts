// Janela do app: Edge em modo app com perfil próprio (ADR 0001) e atalho opcional na pasta Inicializar (P04).
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const EDGE_CANDIDATES = [
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
];

/** Abre a janela e devolve o pid do processo principal do Edge (raiz da árvore "self"). */
export function openWindow(url: string, dataDir: string, onExit: (pid: number) => void): number | null {
  const edge = EDGE_CANDIDATES.find(existsSync);
  if (!edge) return null;
  // perfil próprio: os processos desta janela não se misturam com o Edge do dia a dia (R05)
  const child = spawn(edge, [
    `--app=${url}`, `--user-data-dir=${join(dataDir, 'edge-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1180,760',
  ], { detached: true, stdio: 'ignore', shell: false });
  child.on('error', () => {});
  child.unref();
  const pid = child.pid ?? null;
  if (pid) child.on('exit', () => onExit(pid));
  return pid;
}

const PS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
export const startupDir = () => process.env.FOLGA_STARTUP_DIR
  ?? join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const lnkPath = () => join(startupDir(), 'Folga.lnk');
const psQuote = (s: string) => `'${s.replaceAll("'", "''")}'`;

export const startupInstalled = () => existsSync(lnkPath());

/** Cria ou remove o atalho que sobe só o servidor no logon (sem abrir a janela). */
export function setStartup(on: boolean, root: string): Promise<boolean> {
  // unlinkSync, não rmSync: no Node 24.13 o rmSync não apaga arquivo em caminho com acento (C:\Users\Antônio) nem dá erro
  if (!on) { try { unlinkSync(lnkPath()); } catch { /* já não existia */ } return Promise.resolve(startupInstalled()); }
  const script = [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(lnkPath())})`,
    `$s.TargetPath = ${psQuote(process.execPath)}`,
    `$s.Arguments = '"' + ${psQuote(join(root, 'scripts', 'launch.mjs'))} + '" --no-window'`,
    `$s.WorkingDirectory = ${psQuote(root)}`,
    '$s.WindowStyle = 7',   // minimizado: o console do node pisca menos
    '$s.Description = "Folga: liberar memória"',
    '$s.Save()',
  ].join('; ');
  return new Promise(resolve => {
    const p = spawn(PS, ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', shell: false, windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('exit', () => resolve(startupInstalled()));
  });
}
