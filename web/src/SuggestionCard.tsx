// ESBOÇO (contrato do F-17): cartão de sugestão com a lista real de itens e Aprovar/Ignorar (R23).
// Usado nas telas Início, Arquivos e Assistente. A trilha F-17 substitui o corpo; a assinatura fica.
import type { Suggestion } from '../../src/types';

export function SuggestionCard({ s, compact = false }: { s: Suggestion; compact?: boolean }) {
  return (
    <article className="sug-card" data-compact={compact || undefined}>
      <h3>{s.title}</h3>
      <p className="muted">{s.reason}</p>
    </article>
  );
}
