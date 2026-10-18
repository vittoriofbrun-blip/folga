import { useEffect, useRef, useState } from 'react';
import type { AppGroup, MemoryState, Outcome, ReleaseResponse } from '../../src/types';
import type { Source } from './mock';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const NB = ' ';
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfAuto = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const gb = (b: number) => nfAuto.format(b / GB);                       // "11,8", "16"
const size = (b: number) =>
  b >= GB ? `${nf1.format(b / GB)}${NB}GB` : `${nf0.format(Math.max(0, b) / MB)}${NB}MB`;
const pct = (n: number) => `${Math.round(n)}${NB}%`;
const plural = (n: number, one: string, many: string) => `${nf0.format(n)} ${n === 1 ? one : many}`;

function ago(ms: number) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return `menos de 1${NB}min`;
  if (m < 60) return `${m}${NB}min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}${NB}h` : `${Math.floor(h / 24)}${NB}d`;
}

function reasonText(a: AppGroup, s: MemoryState) {
  const since = () => ago(s.t - (a.lastFocusedAt ?? s.startedAt));
  switch (a.reason) {
    case 'idle': return `parado há ${since()}`;
    case 'foreground': return 'em primeiro plano';
    case 'busy': return `ocupado · ${pct(a.cpuPercent)} CPU`;
    case 'recent': return `usado há ${since()}`;
    default: return '';
  }
}

const OUTCOME: Record<Outcome, { text: string; tone: string }> = {
  fechou: { text: 'fechou', tone: 'ok' },
  ficou_aberto: { text: 'ficou aberto (talvez pedindo para salvar)', tone: 'warn' },
  bandeja: { text: 'foi para a bandeja', tone: 'quiet' },
  encerrado: { text: 'encerrado', tone: 'ok' },
  recusado: { text: 'recusado', tone: 'bad' },
};

type Result = { res: ReleaseResponse; total: number } | 'erro' | null;

function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
}

function Group({ cls, name, total, children }: { cls: string; name: string; total: string; children?: React.ReactNode }) {
  return (
    <section className={`group ${cls}`}>
      <h2 className="g-head"><span className="g-name">{name}</span><span className="g-total">{total}</span></h2>
      {children}
    </section>
  );
}

function AppRow({ app, s, on, disabled, toggle }: {
  app: AppGroup; s: MemoryState; on: boolean; disabled: boolean; toggle: (k: string) => void;
}) {
  return (
    <label className="row">
      <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(app.key)} />
      <Avatar name={app.name} />
      <span className="row-text">
        <span className="row-name">{app.name}</span>
        <span className="row-reason">{reasonText(app, s)}</span>
      </span>
      <span className="row-size">{size(app.privateWorkingSet)}</span>
    </label>
  );
}

export function Memory({ state, source }: { state: MemoryState | null; source: Source }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [showList, setShowList] = useState(true);
  const prevIdle = useRef<Set<string>>(new Set());

  // Mantém a escolha do usuário; só marca por padrão os parados que acabaram de aparecer (R03).
  useEffect(() => {
    if (!state) return;
    const live = new Set(state.apps.filter((a) => a.state !== 'protected').map((a) => a.key));
    const idleNow = new Set(state.apps.filter((a) => a.state === 'idle').map((a) => a.key));
    const fresh = [...idleNow].filter((k) => !prevIdle.current.has(k));
    prevIdle.current = idleNow;
    setSel((prev) => {
      const next = new Set([...prev].filter((k) => live.has(k)));
      fresh.forEach((k) => next.add(k));
      return next.size === prev.size && [...next].every((k) => prev.has(k)) ? prev : next;
    });
  }, [state]);

  const toggle = (k: string) =>
    setSel((prev) => { const n = new Set(prev); if (!n.delete(k)) n.add(k); return n; });

  async function release() {
    setBusy(true);
    setResult(null);
    try {
      const res = await source.release([...sel]);
      setResult({ res, total: state?.totalPhys ?? 0 });
      setShowList(true);
    } catch {
      setResult('erro');
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <section className="page"><h1 className="page-title">Liberar memória</h1><p className="muted" role="status">Lendo a memória…</p></section>;
  }

  const bySize = (a: AppGroup, b: AppGroup) => b.privateWorkingSet - a.privateWorkingSet;
  const idle = state.apps.filter((a) => a.state === 'idle').sort(bySize);
  const inUse = state.apps.filter((a) => a.state === 'in_use').sort(bySize);
  const prot = state.apps.filter((a) => a.state === 'protected');
  const protProcs = prot.reduce((n, a) => n + a.pids.length, 0);
  const protBytes = prot.reduce((n, a) => n + a.privateWorkingSet, 0);
  const sum = (l: AppGroup[]) => l.reduce((n, a) => n + a.privateWorkingSet, 0);
  const used = state.totalPhys - state.availPhys;
  const { settings } = state;

  let summary = '';
  if (busy) summary = 'Fechando do jeito normal e conferindo. Pode levar alguns segundos.';
  else if (result === 'erro') summary = 'Não deu para liberar agora. Tente de novo.';
  else if (result) {
    const back = result.res.availAfter - result.res.availBefore;   // R08: nunca a soma dos apps
    const now = `${gb(result.total - result.res.availAfter)} de ${gb(result.total)}${NB}GB em uso`;
    summary = back > 0 ? `✓ ${size(back)} liberados · ${now}` : `Nada voltou para a memória · ${now}`;
  }

  return (
    <section className="mem" aria-labelledby="mem-title">
      <header className="mem-head">
        <div>
          <h1 className="page-title" id="mem-title">Liberar memória</h1>
          <p className="muted">{settings.autoCareEnabled ? `Auto Care começa em ${pct(settings.autoCareThreshold)}` : 'Auto Care desligado'}</p>
        </div>
        <p className="mem-usage">{gb(used)} de {gb(state.totalPhys)}{NB}GB em uso · {pct(state.memLoad)}</p>
      </header>

      <div className="mem-body">
        <div className="meter-col">
          <div className="meter" role="meter" aria-label="Memória usada" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(state.memLoad)} aria-valuetext={`${pct(state.memLoad)} em uso`}>
            <div className="meter-label"><span>Memória usada</span><strong>{pct(state.memLoad)}</strong></div>
            <div className="meter-bar">
              <div className="meter-fill" style={{ height: `${Math.min(100, state.memLoad)}%` }} />
              {settings.autoCareEnabled && (
                <div className="meter-tick" style={{ bottom: `${settings.autoCareThreshold}%` }} aria-hidden="true" />
              )}
            </div>
          </div>
        </div>

        <div className="mem-list">
          {result && result !== 'erro' && showList && (
            <section className="result" aria-labelledby="res-title">
              <h2 id="res-title" className="result-head">
                Resultado
                <button type="button" className="link" onClick={() => setShowList(false)}>Ocultar</button>
              </h2>
              <ul>
                {result.res.results.map((r) => (
                  <li key={r.key}>
                    <Avatar name={r.name} />
                    <span className="row-name">{r.name}</span>
                    <span className={`out out-${OUTCOME[r.outcome].tone}`}>{OUTCOME[r.outcome].text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Group cls="g-idle" name="Parados" total={idle.length ? `${plural(idle.length, 'app', 'apps')} · ${size(sum(idle))}` : ''}>
            {idle.length
              ? idle.map((a) => <AppRow key={a.key} app={a} s={state} on={sel.has(a.key)} disabled={busy} toggle={toggle} />)
              : <p className="empty">Nada parado há mais de {settings.idleMinutes}{NB}min.</p>}
          </Group>

          {inUse.length > 0 && (
            <Group cls="g-use" name="Em uso" total={`${plural(inUse.length, 'app', 'apps')} · ${size(sum(inUse))}`}>
              {inUse.map((a) => <AppRow key={a.key} app={a} s={state} on={sel.has(a.key)} disabled={busy} toggle={toggle} />)}
            </Group>
          )}

          <Group cls="g-sys" name="Sistema e protegidos" total={`${plural(protProcs, 'processo', 'processos')} · ${size(protBytes)}`} />

          {state.freed.length > 0 && (
            <Group cls="g-freed" name="Liberados" total={plural(state.freed.length, 'app', 'apps')}>
              {state.freed.map((r) => (
                <div className="row row-static" key={r.key}>
                  <span />
                  <Avatar name={r.name} />
                  <span className="row-text"><span className="row-name">{r.name}</span></span>
                  <span className="row-reason">{OUTCOME[r.outcome].text}</span>
                </div>
              ))}
            </Group>
          )}
        </div>
      </div>

      <footer className="mem-foot">
        <p className="summary" role="status" aria-live="polite">{summary}</p>
        <button type="button" className="pill" disabled={sel.size === 0 && !busy} aria-busy={busy}
          aria-disabled={busy} onClick={() => { if (!busy) void release(); }}>
          {busy ? 'Liberando…' : 'Liberar'}
        </button>
      </footer>
    </section>
  );
}
