// Nota de saúde do Início (D18). Função pura: sem rede, sem relógio, testada em src/tests/health.test.ts.
import type { DiskInfo, MemoryState, View, Warning } from '../../src/types';

export type Health = {
  score: number;
  status: 'bom' | 'regular' | 'critico';
  problems: { text: string; view: View }[];
};

export type HealthInput = { state: MemoryState | null; warnings: Warning[]; disks: DiskInfo[]; pendingSuggestions: number };

const MEM_CRITICAL = 97;       // % de memória em uso
const WARNING_CAP = 40;        // teto total de desconto por avisos
const SUGGESTION_CAP = 10;     // teto de desconto por sugestões pendentes

/** Disco do sistema: o C:, ou o primeiro da lista se não houver C:. */
export const systemDisk = (disks: DiskInfo[]): DiskInfo | undefined =>
  disks.find(d => d.drive.toUpperCase().startsWith('C')) ?? disks[0];

export function computeHealth({ state, warnings, disks, pendingSuggestions }: HealthInput): Health {
  let score = 100;
  const problems: Health['problems'] = [];
  const hit = (points: number, text: string, view: View) => { score -= points; problems.push({ text, view }); };

  if (state) {
    const load = Math.round(state.memLoad);
    if (state.memLoad >= MEM_CRITICAL) hit(40, `Memória quase cheia (${load} %)`, 'memoria');
    else if (state.memLoad >= state.settings.autoCareThreshold) hit(20, `Memória alta (${load} %)`, 'memoria');
  }

  const sys = systemDisk(disks);
  if (sys && sys.total > 0) {
    const free = (sys.free / sys.total) * 100;
    const label = `${sys.drive} com ${Math.round(free)} % livre`;
    if (free < 5) hit(30, `Disco quase cheio: ${label}`, 'arquivos');
    else if (free < 10) hit(15, `Pouco espaço no disco: ${label}`, 'arquivos');
  }

  let warnLeft = WARNING_CAP;
  for (const w of warnings) {
    // memória e disco já descontaram acima pela leitura direta; o aviso da mesma causa não desconta de novo
    if (!w.active || w.severity === 'info' || w.kind === 'memoria' || w.kind === 'disco') continue;
    const points = Math.min(warnLeft, w.severity === 'critico' ? 15 : 5);
    warnLeft -= points;
    score -= points;
    problems.push({ text: w.title, view: w.view ?? 'avisos' });
  }

  if (pendingSuggestions > 0) {
    score -= Math.min(SUGGESTION_CAP, pendingSuggestions * 2);
    problems.push({ text: `${pendingSuggestions} ${pendingSuggestions === 1 ? 'sugestão pendente' : 'sugestões pendentes'}`, view: 'arquivos' });
  }

  if (state && !state.settings.autoCareEnabled) hit(5, 'Auto Care desligado', 'autocare');

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, status: score >= 80 ? 'bom' : score >= 50 ? 'regular' : 'critico', problems };
}
