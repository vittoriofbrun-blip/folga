// R36: o grupo "Sistema e protegidos" aberto — quem ocupa a memória e qual é o próximo passo de cada um.
// Função pura, usada pela tela Memória e pela ferramenta `ver_memoria` do assistente, para os dois dizerem
// a mesma coisa. Só leitura: nada aqui fecha nem destrava nada (R05 continua inteira).
import type { AppGroup, AppReason } from './types.ts';

export type ProtectedRow = {
  key: string; name: string; bytes: number; procs: number;
  reason: AppReason;
  words: string;           // o motivo em palavras, pt-BR
  parents: string[];       // nomes dos apps que lançaram os processos sem janela (pode ser vazio)
  services: number;        // bytes que ESTE app segura em processos sem janela, espalhados por outras
                           // linhas. 0 quando não segura nada. Nunca entra no `bytes`: somar os dois
                           // contaria duas vezes, e o total do grupo é a soma dos `bytes`.
  canUnprotect: boolean;   // só 'never_close': o usuário tirou da lista dele em Ajustes
};

const MB = 1024 ** 2;
const SERVICES_FLOOR = 10 * MB;   // abaixo disto não muda a decisão de ninguém

const WORDS: Record<string, string> = {
  system: 'do sistema',
  no_window: 'sem janela aberta',
  never_close: 'você marcou como nunca fechar',
  self: 'é o próprio Folga',
  other_session: 'de outra sessão do Windows',
};

/** "do Claude" · "do Claude e do ChatGPT" · "do A, do B e do C" · "do A, do B e de outros" (4 ou mais) */
function ofThem(names: readonly string[]): string {
  const [a, b, c] = names;
  if (!b) return `do ${a}`;
  if (!c) return `do ${a} e do ${b}`;
  return names.length > 3 ? `do ${a}, do ${b} e de outros` : `do ${a}, do ${b} e do ${c}`;
}

/**
 * Quanto cada app segura em processos sem janela que ele lançou, somando a lista inteira. Serve para o
 * usuário não ter que somar de cabeça "Claude Code 3,7 GB" numa linha e "Node.js · serviço do Claude Code"
 * em outra. Abaixo de SERVICES_FLOOR é migalha que ninguém soma (o PowerShell com "mais 1 MB" só
 * atrapalhava a leitura); o corte mora aqui para a tela e o assistente mostrarem o mesmo.
 * ponytail: dono que não está em "Sistema e protegidos" (o Chrome em uso, por exemplo) é somado aqui mas
 * não tem onde aparecer ainda; abrir isso nas outras linhas quando alguém sentir falta.
 */
function servicesByOwner(apps: readonly AppGroup[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const a of apps) {
    for (const p of a.parents ?? []) total.set(p.key, (total.get(p.key) ?? 0) + p.bytes);
  }
  for (const [key, bytes] of total) if (bytes < SERVICES_FLOOR) total.delete(key);
  return total;
}

/**
 * Os protegidos como linhas prontas para mostrar, maiores primeiro. Nomes dos pais saem da própria lista
 * de apps; pai que não está mais lá entra pela chave, que é o nome do executável.
 */
export function protectedRows(apps: readonly AppGroup[]): ProtectedRow[] {
  const nameOf = new Map(apps.map((a) => [a.key, a.name]));
  const services = servicesByOwner(apps);
  return apps
    .filter((a) => a.state === 'protected')
    .map((a) => {
      const parents = (a.parents ?? []).map((p) => nameOf.get(p.key) ?? p.key);
      const base = WORDS[a.reason] ?? a.reason;
      return {
        key: a.key, name: a.name, bytes: a.privateWorkingSet, procs: a.pids.length, reason: a.reason,
        words: parents.length > 0 ? `${base} · serviço ${ofThem(parents)}` : base,
        parents,
        services: services.get(a.key) ?? 0,
        canUnprotect: a.reason === 'never_close',
      };
    })
    .sort((x, y) => y.bytes - x.bytes || x.name.localeCompare(y.name, 'pt-BR'));
}
