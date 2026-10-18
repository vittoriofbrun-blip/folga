// Sonda falsa para testes: imita probe.exe (snapshots em stdout, comandos em stdin).
import { createInterface } from 'node:readline';

const intervalMs = Number(process.env.FAKE_INTERVAL_MS ?? 200);
const GB = 1024 ** 3;
let avail = Number(process.env.FAKE_AVAIL_GB ?? 6) * GB;   // memLoad = 100 - avail/16 GB
const procs = new Map([
  [process.ppid, { pid: process.ppid, ppid: 1, name: 'node.exe', description: 'Node.js', session: 1, privateWorkingSet: 50e6, cpuTimeMs: 0, hasVisibleWindow: false, accessible: true }],
  [process.pid, { pid: process.pid, ppid: process.ppid, name: 'node.exe', description: 'Node.js', session: 1, privateWorkingSet: 30e6, cpuTimeMs: 0, hasVisibleWindow: false, accessible: true }],
  [9001, { pid: 9001, ppid: 4, name: 'notepad.exe', description: 'Bloco de Notas', session: 1, privateWorkingSet: Number(process.env.FAKE_NOTEPAD_MB ?? 40) * 1e6, cpuTimeMs: 0, hasVisibleWindow: true, accessible: true }],
  [9002, { pid: 9002, ppid: 4, name: 'explorer.exe', description: 'Windows Explorer', session: 1, privateWorkingSet: 90e6, cpuTimeMs: 0, hasVisibleWindow: true, accessible: true }],
  [9003, { pid: 9003, ppid: 4, name: 'svchost.exe', description: '', session: 0, privateWorkingSet: 20e6, cpuTimeMs: 0, hasVisibleWindow: false, accessible: false }],
]);

const write = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const tick = () => write({
  type: 'snapshot', t: Date.now(), memLoad: Math.round(100 - (avail / (16 * GB)) * 100),
  totalPhys: 16 * GB, availPhys: avail, foregroundPid: null, audioPids: [], processes: [...procs.values()],
});
tick();
setInterval(tick, intervalMs);

createInterface({ input: process.stdin })
  .on('line', line => {
    const cmd = JSON.parse(line);
    let windowsClosed = 0;
    for (const pid of cmd.pids) {
      const p = procs.get(pid);
      if (!p) continue;
      if (cmd.type === 'close' && p.hasVisibleWindow) { windowsClosed++; procs.delete(pid); avail += p.privateWorkingSet; }
      if (cmd.type === 'kill') { procs.delete(pid); avail += p.privateWorkingSet; }
    }
    write({ type: 'reply', id: cmd.id, ok: true, windowsClosed });
  })
  .on('close', () => process.exit(0));   // como a real: sai quando o stdin fecha
