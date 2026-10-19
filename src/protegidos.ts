// R36: o grupo "Sistema e protegidos" aberto — quem ocupa a memória e qual é o próximo passo de cada um.
// Função pura, usada pela tela Memória e pela ferramenta `ver_memoria` do assistente, para os dois dizerem
// a mesma coisa. Só leitura: nada aqui fecha nem destrava nada (R05 continua inteira).
import type { AppGroup, AppReason } from './types.ts';

export type ProtectedRow = {
  key: string; name: string; bytes: number; procs: number;
  reason: AppReason;
  words: string;           // o motivo em palavras, pt-BR
  parents: string[];       // nomes dos apps que lançaram os processos sem janela (pode ser vazio)
  canUnprotect: boolean;   // só 'never_close': o usuário tirou da lista dele em Ajustes
};

const WORDS: Record<string, string> = {
  system: 'do sistema',
  no_window: 'sem janela aberta',
  never_close: 'você marcou como nunca fechar',
  self: 'é o próprio Folga',
  other_session: 'de outra sessão do Windows',
};

/** "do Claude", "do Claude e do ChatGPT", "do Claude, do ChatGPT e de outros" */
function ofThem(names: readonly string[]): string {
  const [a, b] = names;
  if (!b) return `do ${a}`;
  return names.length > 2 ? `do ${a}, do ${b} e de outros` : `do ${a} e do ${b}`;
}

/**
 * Os protegidos como linhas prontas para mostrar, maiores primeiro. Nomes dos pais saem da própria lista
 * de apps; pai que não está mais lá entra pela chave, que é o nome do executável.
 */
export function protectedRows(apps: readonly AppGroup[]): ProtectedRow[] {
  const nameOf = new Map(apps.map((a) => [a.key, a.name]));
  return apps
    .filter((a) => a.state === 'protected')
    .map((a) => {
      const parents = (a.parents ?? []).map((k) => nameOf.get(k) ?? k);
      const base = WORDS[a.reason] ?? a.reason;
      return {
        key: a.key, name: a.name, bytes: a.privateWorkingSet, procs: a.pids.length, reason: a.reason,
        words: parents.length > 0 ? `${base} · serviço ${ofThem(parents)}` : base,
        parents,
        canUnprotect: a.reason === 'never_close',
      };
    })
    .sort((x, y) => y.bytes - x.bytes || x.name.localeCompare(y.name, 'pt-BR'));
}
