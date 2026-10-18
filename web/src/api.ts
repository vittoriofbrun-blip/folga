// Fonte real: SSE de /api/events e escrita com o token (R16). Mesma forma do mockSource.
import type { LogEntry, MemoryState, ReleaseResponse, Settings } from '../../src/types';
import type { Source } from './mock';

let tokenPromise: Promise<string> | null = null;
const token = () => (tokenPromise ??= fetch('/api/token').then(r => r.json()).then(b => b.token as string));

async function write<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-folga-token': await token() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { erro?: string }).erro ?? 'falhou');
  return data as T;
}

export const apiSource: Source = {
  subscribe(onState) {
    // EventSource reconecta sozinho se o servidor reiniciar
    const es = new EventSource('/api/events');
    es.addEventListener('state', e => onState(JSON.parse((e as MessageEvent).data) as MemoryState));
    return () => es.close();
  },
  release: keys => write<ReleaseResponse>('POST', '/api/release', { keys }),
};

export const getLog = (limit = 100): Promise<LogEntry[]> => fetch(`/api/log?limit=${limit}`).then(r => r.json());
export const getSettings = (): Promise<Settings> => fetch('/api/settings').then(r => r.json());
export const putSettings = (patch: Partial<Settings>) => write<Settings>('PUT', '/api/settings', patch);
