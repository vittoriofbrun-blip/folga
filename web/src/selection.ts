// Marcação da tela Memória (R04, R06). Função pura, testada em src/tests/selection.test.ts.
import type { AppGroup } from '../../src/types';

/**
 * O que está marcado agora. Por padrão, os parados (R06): app ocupado, em primeiro plano ou usado agora
 * nunca vem marcado (R04). A marca feita à mão vale por cima do padrão; protegido nunca é marcado.
 * ponytail: as marcas à mão de um app que fechou ficam até recarregar a tela; podar se incomodar.
 */
export function selection(apps: readonly AppGroup[], handOn: ReadonlySet<string>, handOff: ReadonlySet<string>): Set<string> {
  return new Set(apps
    .filter((a) => a.state !== 'protected' && (handOn.has(a.key) || (a.state === 'idle' && !handOff.has(a.key))))
    .map((a) => a.key));
}
