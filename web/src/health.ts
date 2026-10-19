// Nota de saúde do Início (D18). Função pura: sem rede, sem relógio, testada em src/tests/health.test.ts.
import type { DiskInfo, MemoryState, View, Warning } from '../../src/types';

export type Health = {
  score: number;
  status: 'bom' | 'regular' | 'critico';
  /** prompt: o que o botão "Resolver" manda ao assistente. Sem prompt, ele só abre a tela que resolve. */
  problems: { text: string; view: View; prompt?: string }[];
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
  const hit = (points: number, text: string, view: View, prompt?: string) => {
    score -= points;
    problems.push(prompt ? { text, view, prompt } : { text, view });
  };

  if (state) {
    const load = Math.round(state.memLoad);
    const pedido = `A memória está em ${load} %. Veja quais apps estão abertos e me diga, do que mais ocupa para o que menos ocupa, o que dá para fechar para baixar o consumo. Proponha um cartão só com os que estiverem parados.`;
    if (state.memLoad >= MEM_CRITICAL) hit(40, `Memória quase cheia (${load} %)`, 'assistente', pedido);
    else if (state.memLoad >= state.settings.autoCareThreshold) hit(20, `Memória alta (${load} %)`, 'assistente', pedido);
  }

  const sys = systemDisk(disks);
  if (sys && sys.total > 0) {
    const free = (sys.free / sys.total) * 100;
    const label = `${sys.drive} com ${Math.round(free)} % livre`;
    const pedido = `O disco ${sys.drive} está com ${Math.round(free)} % livre. Veja a limpeza rápida e os arquivos que não abro mais e me proponha o que dá para liberar sem perder nada que eu use.`;
    if (free < 5) hit(30, `Disco quase cheio: ${label}`, 'assistente', pedido);
    else if (free < 10) hit(15, `Pouco espaço no disco: ${label}`, 'assistente', pedido);
  }

  let warnLeft = WARNING_CAP;
  for (const w of warnings) {
    // memória e disco já descontaram acima pela leitura direta; o aviso da mesma causa não desconta de novo
    if (!w.active || w.severity === 'info' || w.kind === 'memoria' || w.kind === 'disco') continue;
    const points = Math.min(warnLeft, w.severity === 'critico' ? 15 : 5);
    warnLeft -= points;
    score -= points;
    // aviso com tela própria abre a tela; o que não tem (travamento, por exemplo) vai para o assistente
    problems.push(w.view
      ? { text: w.title, view: w.view }
      : { text: w.title, view: 'assistente', prompt: `${w.title}. ${w.detail} Veja a memória, o disco e os avisos do Folga e me diga o que pode estar por trás e o que eu posso fazer.` });
  }

  if (pendingSuggestions > 0) {
    score -= Math.min(SUGGESTION_CAP, pendingSuggestions * 2);
    problems.push({ text: `${pendingSuggestions} ${pendingSuggestions === 1 ? 'sugestão pendente' : 'sugestões pendentes'}`, view: 'arquivos' });
  }

  if (state && !state.settings.autoCareEnabled) hit(5, 'Auto Care desligado', 'autocare');

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, status: score >= 80 ? 'bom' : score >= 50 ? 'regular' : 'critico', problems };
}
