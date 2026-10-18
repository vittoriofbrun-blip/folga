import { useEffect, useState } from 'react';
import type { MemoryState } from '../../src/types';
import { mockSource, type Source } from './mock';
import { apiSource } from './api';
import { Memory } from './Memory';
import { AutoCare } from './AutoCare';
import { Log } from './Log';
import { Settings } from './Settings';

// ?mock na URL mostra os dados falsos (para trabalhar na tela sem o servidor)
const source: Source = new URLSearchParams(location.search).has('mock') ? mockSource : apiSource;

type View = 'memoria' | 'autocare' | 'registro' | 'ajustes';

const svg = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const ICONS: Record<View, React.ReactNode> = {
  memoria: <svg {...svg}><rect x="4" y="7" width="16" height="10" rx="2" /><path d="M8 4v3M12 4v3M16 4v3M8 17v3M12 17v3M16 17v3" /></svg>,
  autocare: <svg {...svg}><path d="M11 3l1.8 4.7 4.7 1.8-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z" /><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>,
  registro: <svg {...svg}><path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" /></svg>,
  ajustes: <svg {...svg}><path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>,
};
const TOP: [View, string][] = [['memoria', 'Memória'], ['autocare', 'Auto Care'], ['registro', 'Registro']];

export function App() {
  const [view, setView] = useState<View>('memoria');
  const [state, setState] = useState<MemoryState | null>(null);

  useEffect(() => source.subscribe(setState), []);

  const item = ([v, label]: [View, string]) => (
    <button key={v} type="button" className="nav-item" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
      {ICONS[v]}<span>{label}</span>
    </button>
  );

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Principal">
        {TOP.map(item)}
        <div className="nav-bottom">{item(['ajustes', 'Ajustes'])}</div>
      </nav>
      <main className="main">
        {/* Memória fica montada para não perder a seleção nem o resultado ao trocar de aba. */}
        <div className="view" hidden={view !== 'memoria'}><Memory state={state} source={source} /></div>
        {view === 'autocare' && <AutoCare state={state} />}
        {view === 'registro' && <Log state={state} />}
        {view === 'ajustes' && <Settings state={state} />}
      </main>
    </div>
  );
}
