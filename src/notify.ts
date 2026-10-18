// R31: aviso do Windows quando o vigia propõe algo e a janela está fechada.
// O texto NUNCA entra no script: vai por variável de ambiente, e o script o escapa para XML. Assim um nome
// de app ou de arquivo não vira comando (mesma ideia da R24).
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const PS = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
// AppId do próprio PowerShell: é o único jeito de tocar um toast sem instalar/registrar um app.
const APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
// Sem aspas duplas no script: o -Command do powershell.exe as embaralha. Q é a aspa, montada na hora.
export const SCRIPT = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
  '$Q = [char]34',
  'function E($s) { [Security.SecurityElement]::Escape([string]$s) }',
  // uma linha só: o join por ';' abaixo quebraria uma chamada partida em várias
  "$x = '<toast activationType=' + $Q + 'protocol' + $Q + ' launch=' + $Q + (E $env:FOLGA_TOAST_URL) + $Q"
    + " + '><visual><binding template=' + $Q + 'ToastGeneric' + $Q + '><text>' + (E $env:FOLGA_TOAST_TITLE)"
    + " + '</text><text>' + (E $env:FOLGA_TOAST_BODY) + '</text></binding></visual></toast>'",
  '$d = New-Object Windows.Data.Xml.Dom.XmlDocument',
  '$d.LoadXml($x)',
  `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($d))`,
].join('; ');

export type NotifyDeps = {
  port: number;
  /** só para testes: o que de fato dispara o processo */
  run?: (title: string, body: string, url: string) => void;
};

export function createNotify(deps: NotifyDeps) {
  let broken = false;   // se o Windows recusar uma vez, não insiste a cada proposta
  const url = `http://127.0.0.1:${deps.port}`;

  const run = deps.run ?? ((title: string, body: string, u: string) => {
    const child = spawn(PS(), ['-NoProfile', '-NonInteractive', '-STA', '-Command', SCRIPT], {
      shell: false, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, FOLGA_TOAST_TITLE: title, FOLGA_TOAST_BODY: body, FOLGA_TOAST_URL: u },
    });
    const kill = setTimeout(() => child.kill(), 15_000);
    kill.unref();
    child.on('error', () => { clearTimeout(kill); broken = true; });
    child.on('exit', code => { clearTimeout(kill); if (code !== 0) broken = true; });
    child.unref();
  });

  return {
    /** Fire-and-forget: avisar nunca pode atrapalhar o que o Folga estava fazendo. */
    toast(title: string, body: string): void {
      if (broken) return;
      try { run(title, body, url); } catch { broken = true; }
    },
  };
}
export type Notify = ReturnType<typeof createNotify>;
