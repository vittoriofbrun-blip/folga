// Esboço: outro ticket substitui esta tela.
import type { MemoryState, View } from '../../src/types';

export function Avisos(_props: { state: MemoryState | null; go: (v: View) => void }) {
  return (
    <section className="page">
      <h1 className="page-title">Avisos</h1>
      <p className="muted">Em construção</p>
    </section>
  );
}
