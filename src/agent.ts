// ESBOÇO (contrato do F-18): agente no chat, Claude ou GPT pelos CLIs (ADR 0006). A trilha F-18 substitui.
import type { AgentProvider, Conversation, Emit, Suggestion, SuggestionDraft } from './types.ts';
import type { SuggestionError } from './suggestions.ts';

export type AgentDeps = {
  dataDir: string;
  port: number;
  emit: Emit;
  addSuggestion: (draft: SuggestionDraft) => Promise<Suggestion | SuggestionError>;
  selfPids: Set<number>;     // o processo do CLI entra como "__self" enquanto vive (R05)
};

export function createAgent(_deps: AgentDeps) {
  const empty: Conversation = { id: 'c0', provider: 'claude', sessionId: null, messages: [], busy: false };
  return {
    conversation(): Conversation { return empty; },
    async send(_provider: AgentProvider, _text: string): Promise<{ ok: true } | { erro: string; status: number }> { return { erro: 'em construção', status: 501 }; },
    reset(): Conversation { return empty; },
    stop(): void {},
  };
}
export type Agent = ReturnType<typeof createAgent>;
