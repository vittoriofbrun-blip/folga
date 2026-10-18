// ESBOÇO (contrato do F-17): sugestões propostas pelo agente ou pela tela, aprovadas pelo usuário (R20–R24).
import type { Files } from './files.ts';
import type { ReleaseError } from './release.ts';
import type { Emit, MemoryState, ReleaseResponse, Suggestion, SuggestionDraft } from './types.ts';

export type SuggestionsDeps = {
  dataDir: string;
  files: Files;
  getState: () => MemoryState | null;
  release: (keys: string[]) => Promise<ReleaseResponse | ReleaseError>;
  emit: Emit;
};
export type SuggestionError = { erro: string; status: number };

export function createSuggestions(_deps: SuggestionsDeps) {
  return {
    list(): Suggestion[] { return []; },
    async add(_draft: SuggestionDraft, _source: Suggestion['source']): Promise<Suggestion | SuggestionError> { return { erro: 'em construção', status: 501 }; },
    async approve(_id: string): Promise<Suggestion | SuggestionError> { return { erro: 'em construção', status: 501 }; },
    ignore(_id: string): Suggestion | SuggestionError { return { erro: 'em construção', status: 501 }; },
  };
}
export type Suggestions = ReturnType<typeof createSuggestions>;
