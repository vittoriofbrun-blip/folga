import { useEffect, useState } from 'react';
import type { LogEntry, MemoryState } from '../../src/types';
import { getLog } from './api';
import { OUTCOME, size } from './format';

const hm = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dm = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

/** "hoje 14:32", "ontem 09:10" ou "12/10 18:05" */
function when(t: number, now = new Date()) {
  const d = new Date(t);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const clock = hm.format(d);
  if (diff === 0) return `hoje ${clock}`;
  if (diff === 1) return `ontem ${clock}`;
  return `${dm.format(d)} ${clock}`;
}

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; entries: LogEntry[] };

export function Log({ state }: { state: MemoryState | null }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // Nova liberação = a lista "Liberados" mudou de tamanho; sem polling.
  const freedCount = state?.freed.length ?? 0;

  useEffect(() => {
    let alive = true;
    getLog(100)
      .then((list) => {
        if (!alive) return;
        if (!Array.isArray(list)) throw new Error('resposta inesperada');
        setLoad({ kind: 'ok', entries: [...list].sort((a, b) => b.t - a.t) });
      })
      .catch(() => {
        // mantém a lista que já está na tela se uma releitura falhar
        if (alive) setLoad((prev) => (prev.kind === 'ok' ? prev : { kind: 'error' }));
      });
    return () => { alive = false; };
  }, [freedCount]);

  return (
    <section className="page log" aria-labelledby="log-title">
      <h1 className="page-title" id="log-title">Registro</h1>
      <p className="muted">As liberações mais recentes primeiro.</p>

      {load.kind === 'loading' && <p className="log-note" role="status">Carregando…</p>}
      {load.kind === 'error' && <p className="log-note log-error" role="alert">Não deu para ler o registro agora.</p>}
      {load.kind === 'ok' && load.entries.length === 0 && <p className="log-note">Nenhuma liberação ainda.</p>}

      {load.kind === 'ok' && load.entries.length > 0 && (
        <ol className="log-list">
          {load.entries.map((e, i) => {
            const back = e.availAfter - e.availBefore;   // R08: nunca a soma dos apps
            return (
              <li key={`${e.t}-${i}`} className={`log-entry${i === 0 ? ' log-latest' : ''}`}>
                <div className="log-head">
                  <time className="log-when" dateTime={new Date(e.t).toISOString()}>{when(e.t)}</time>
                  <span className="log-origin">{e.origin === 'auto' ? 'Auto Care' : 'Manual'}</span>
                  <span className={`log-back${back > 0 ? '' : ' log-none'}`}>{back > 0 ? `${size(back)} voltaram` : 'nada voltou'}</span>
                </div>
                <ul className="log-apps">
                  {e.results.map((r) => (
                    <li key={r.key}>
                      <span className="log-app">{r.name}</span>
                      <span className={`out out-${OUTCOME[r.outcome].tone}`}>{OUTCOME[r.outcome].text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
