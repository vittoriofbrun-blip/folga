// Mede a pegada do próprio Folga (R18): working set privado e CPU do grupo "__self" (Node + sonda).
//   node scripts/footprint.mjs [--minutes 10]   (o servidor precisa estar no ar)
import { availableParallelism } from 'node:os';

const port = Number(process.env.FOLGA_PORT ?? 4780);
const i = process.argv.indexOf('--minutes');
const minutes = i > 0 ? Number(process.argv[i + 1]) : 10;
const MB = 1024 ** 2;
const cores = availableParallelism();

const samples = [];
const end = Date.now() + minutes * 60_000;
while (Date.now() < end) {
  try {
    const s = await fetch(`http://127.0.0.1:${port}/api/state`).then(r => r.json());
    const self = s.apps.find(a => a.key === '__self');
    if (self) samples.push({ mb: self.privateWorkingSet / MB, cpu: self.cpuPercent, pids: self.pids.length });
  } catch { /* servidor reiniciando */ }
  await new Promise(r => setTimeout(r, 5_000));
}

if (!samples.length) { console.error('nenhuma leitura: o servidor está no ar?'); process.exitCode = 1; }
else {
  const avg = k => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  const max = k => Math.max(...samples.map(s => s[k]));
  const okMem = max('mb') <= 120, okCpu = avg('cpu') / cores < 1;
  console.log(`${samples.length} leituras em ${minutes} min · ${samples.at(-1).pids} processos do Folga`);
  console.log(`memória privada: média ${avg('mb').toFixed(1)} MB · pico ${max('mb').toFixed(1)} MB  ${okMem ? 'ok' : 'ACIMA de 120 MB'}`);
  console.log(`CPU: média ${avg('cpu').toFixed(2)} % de um núcleo = ${(avg('cpu') / cores).toFixed(2)} % do total (${cores} núcleos)  ${okCpu ? 'ok' : 'ACIMA de 1 %'}`);
  process.exitCode = okMem && okCpu ? 0 : 1;
}
