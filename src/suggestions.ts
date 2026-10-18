// F-17: sugestões propostas pelo agente ou pela tela e aprovadas pelo usuário (R20–R24, D19).
// O que o modelo manda é só um pedido: os itens são MONTADOS aqui a partir do disco e do estado (R23), e na
// aprovação tudo é revalidado de novo (R21). Quem executa é sempre approve(), que só roda com o clique do usuário.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Files } from './files.ts';
import type { ReleaseError } from './release.ts';
import type {
  AppReason, Emit, MemoryState, QuickCleanCategory, ReleaseResponse, Suggestion, SuggestionDraft, SuggestionItem, SuggestionKind,
} from './types.ts';

export type SuggestionsDeps = {
  dataDir: string;
  files: Files;
  getState: () => MemoryState | null;
  release: (keys: string[]) => Promise<ReleaseResponse | ReleaseError>;
  emit: Emit;
  now?: () => number;   // só para testes
};
export type SuggestionError = { erro: string; status: number };

const KEEP = 100;
const MAX_FILES = 500;
const MAX_APPS = 100;
const KINDS: readonly SuggestionKind[] = ['lixeira', 'limpeza_rapida', 'liberar_memoria'];
const DAY = 86_400_000;
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const err = (erro: string, status = 400): SuggestionError => ({ erro, status });
const plural = (n: number, one: string, many: string) => `${nf0.format(n)} ${n === 1 ? one : many}`;
function size(b: number) {
  if (b >= 1024 ** 3) return `${nf1.format(b / 1024 ** 3)} GB`;
  if (b >= 1024 ** 2) return `${nf0.format(b / 1024 ** 2)} MB`;
  if (b >= 1024) return `${nf0.format(b / 1024)} KB`;
  return `${nf0.format(b)} B`;
}
function since(ms: number) {
  const d = Math.floor(Math.max(0, ms) / DAY);
  if (d < 1) return 'menos de 1 dia';
  if (d < 60) return plural(d, 'dia', 'dias');
  if (d < 730) return plural(Math.floor(d / 30), 'mês', 'meses');
  return plural(Math.floor(d / 365), 'ano', 'anos');
}
const REASON: Record<AppReason, string> = {
  foreground: 'em primeiro plano agora', audio: 'tocando áudio', busy: 'usando o processador', recent: 'usado há pouco',
  idle: 'parado, sem uso recente', no_window: 'sem janela aberta', system: 'do sistema', never_close: 'marcado para nunca fechar',
  self: 'é o próprio Folga', other_session: 'de outra sessão do Windows',
};
// pasta do arquivo sem depender de path.dirname em caminhos com barra mista
const folderOf = (p: string) => dirname(p);

export function createSuggestions(deps: SuggestionsDeps) {
  const now = deps.now ?? Date.now;
  const file = join(deps.dataDir, 'suggestions.json');
  let items: Suggestion[] = [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (Array.isArray(raw)) items = (raw as Suggestion[]).filter(s => s && typeof s.id === 'string').slice(0, KEEP);
  } catch { /* primeira execução ou arquivo ilegível: começa vazio */ }

  // gravação atômica (.tmp + rename), uma por vez
  let writing: Promise<void> = Promise.resolve();
  function persist(): Promise<void> {
    const body = JSON.stringify(items);
    writing = writing.then(async () => {
      const tmp = `${file}.tmp`;
      await writeFile(tmp, body, 'utf8');
      await rename(tmp, file);
    }).catch(() => {});
    return writing;
  }
  const publish = () => deps.emit('suggestions', list());
  function list(): Suggestion[] { return items.map(s => ({ ...s })); }

  // ---------- montagem dos itens (R21, R23) ----------
  async function buildFiles(paths: string[]): Promise<SuggestionItem[] | SuggestionError> {
    if (paths.length === 0) return err('nenhum arquivo na sugestão');
    if (paths.length > MAX_FILES) return err(`são arquivos demais (o máximo é ${MAX_FILES})`);
    const checked = await deps.files.inspect(paths);
    const out: SuggestionItem[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < checked.length; i++) {
      const c = checked[i]!;
      // um item inválido recusa a sugestão inteira (R21); a mensagem não repete o caminho (R17)
      if ('erro' in c) return err(`o item ${i + 1} foi recusado: ${c.erro}`);
      const key = c.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: c.path, label: c.path.slice(c.path.lastIndexOf('\\') + 1),
        detail: `${folderOf(c.path)} · último uso há ${since(now() - c.lastUsed)}`, bytes: c.size,
      });
    }
    return out;
  }
  function buildApps(keys: string[]): SuggestionItem[] | SuggestionError {
    if (keys.length === 0) return err('nenhum app na sugestão');
    if (keys.length > MAX_APPS) return err('são apps demais');
    const state = deps.getState();
    if (!state) return err('ainda lendo a memória', 503);
    const out: SuggestionItem[] = [];
    for (const key of new Set(keys)) {
      const a = state.apps.find(x => x.key === key);
      if (!a) return err('um dos apps não está aberto');
      if (a.state === 'protected') return err(`${a.name} é protegido e não pode ser fechado`);
      out.push({ id: a.key, label: a.name, detail: REASON[a.reason] ?? a.reason, bytes: a.privateWorkingSet });
    }
    return out;
  }
  async function buildClean(): Promise<SuggestionItem[] | SuggestionError> {
    const out: SuggestionItem[] = [];
    for (const c of await deps.files.quickCleanPreview()) {
      if (!c.actionable || c.bytes <= 0 && c.files <= 0) continue;
      out.push({ id: c.category, label: c.label, detail: `${plural(c.files, 'arquivo', 'arquivos')}${c.note ? ` · ${c.note}` : ''}`, bytes: c.bytes });
    }
    return out.length ? out : err('não há nada para limpar agora', 409);
  }

  // ---------- add ----------
  async function add(draft: SuggestionDraft, source: Suggestion['source']): Promise<Suggestion | SuggestionError> {
    const d = draft as Partial<SuggestionDraft> | null;
    if (!d || typeof d !== 'object') return err('pedido inválido');
    if (!KINDS.includes(d.kind as SuggestionKind)) return err('tipo de sugestão inválido');
    const kind = d.kind as SuggestionKind;
    const title = typeof d.title === 'string' ? d.title.trim() : '';
    const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
    if (!title || title.length > 120) return err('o título precisa ter de 1 a 120 caracteres');
    if (reason.length > 500) return err('o motivo pode ter no máximo 500 caracteres');
    // sem caracteres de controle (no motivo só se admite quebra de linha e tabulação)
    if (/[\u0000-\u001f\u007f-\u009f]/.test(title) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(reason)) return err('o texto tem caracteres inválidos');
    if (kind !== 'limpeza_rapida' && (!Array.isArray(d.items) || d.items.some(x => typeof x !== 'string'))) return err('a lista de itens é inválida');
    const given = (kind === 'limpeza_rapida' ? [] : d.items) as string[];

    const built = kind === 'lixeira' ? await buildFiles(given) : kind === 'liberar_memoria' ? buildApps(given) : await buildClean();
    if (!Array.isArray(built)) return built;

    const s: Suggestion = {
      id: randomUUID(), t: now(), source, kind, title, reason, items: built,
      bytes: built.reduce((a, i) => a + i.bytes, 0), status: 'pendente',
    };
    items = [s, ...items].slice(0, KEEP);
    await persist();
    publish();
    return { ...s };
  }

  // ---------- approve ----------
  const running = new Set<string>();
  async function approve(id: string): Promise<Suggestion | SuggestionError> {
    const s = items.find(x => x.id === id);
    if (!s) return err('sugestão não encontrada', 404);
    if (s.status !== 'pendente' || running.has(id)) return err('essa sugestão já foi decidida', 409);
    running.add(id);
    try {
      let status: 'feita' | 'falhou';
      let result: string;
      try {
        ({ status, result } = s.kind === 'lixeira' ? await runFiles(s) : s.kind === 'liberar_memoria' ? await runApps(s) : await runClean(s));
      } catch {
        status = 'falhou'; result = 'Algo deu errado e nada foi feito.';   // sem detalhe interno (R17)
      }
      s.status = status; s.result = result; s.doneAt = now();
      await persist();
      publish();
      return { ...s };
    } finally { running.delete(id); }
  }
  type Outcome = { status: 'feita' | 'falhou'; result: string };

  async function runFiles(s: Suggestion): Promise<Outcome> {
    // R21: tudo de novo pelo disco; um item que mudou recusa a sugestão inteira e nada é enviado
    const checked = await deps.files.inspect(s.items.map(i => i.id));
    const bad = checked.findIndex(c => 'erro' in c);
    if (bad !== -1) {
      const why = (checked[bad] as { erro: string }).erro;
      return { status: 'falhou', result: `Nada foi enviado: o item ${bad + 1} mudou desde a sugestão (${why}).` };
    }
    const good = checked as Array<{ path: string; size: number }>;
    const r = await deps.files.recycle(good.map(g => g.path));
    const okSet = new Set(r.ok.map(p => p.toLowerCase()));
    const moved = good.filter(g => okSet.has(g.path.toLowerCase()));
    const bytes = moved.reduce((a, g) => a + g.size, 0);
    const parts: string[] = [];
    if (moved.length) parts.push(`${plural(moved.length, 'arquivo', 'arquivos')} na Lixeira · ${size(bytes)}`);
    if (r.failed.length) parts.push(`${plural(r.failed.length, 'arquivo não pôde', 'arquivos não puderam')} ir para a Lixeira`);
    return { status: moved.length ? 'feita' : 'falhou', result: parts.join('. ') };
  }

  async function runApps(s: Suggestion): Promise<Outcome> {
    const keys = s.items.map(i => i.id);
    const check = buildApps(keys);   // candidato agora? (R09, R21)
    if (!Array.isArray(check)) return { status: 'falhou', result: `Nada foi fechado: ${check.erro}.` };
    const r = await deps.release(keys);
    if ('erro' in r) return { status: 'falhou', result: `Nada foi fechado: ${r.erro}.` };
    const closed = r.results.filter(x => x.outcome === 'fechou' || x.outcome === 'encerrado' || x.outcome === 'bandeja').length;
    if (!closed) return { status: 'falhou', result: 'Nenhum app fechou (talvez estejam pedindo para salvar).' };
    const freed = r.availAfter - r.availBefore;
    return { status: 'feita', result: `${closed} de ${plural(r.results.length, 'app', 'apps')} fechou${closed === 1 ? '' : 'ram'}${freed > 0 ? ` · liberou ${size(freed)}` : ''}` };
  }

  async function runClean(s: Suggestion): Promise<Outcome> {
    // R21: cada categoria do cartão ainda tem que ser acionável agora (ex.: o navegador não pode ter sido aberto)
    const now_ = await deps.files.quickCleanPreview();
    const cats = s.items.map(i => i.id as QuickCleanCategory);
    const bad = cats.find(c => !now_.some(p => p.category === c && p.actionable));
    if (bad) return { status: 'falhou', result: 'Nada foi apagado: uma das categorias não pode mais ser limpa agora (o navegador foi aberto?).' };
    const r = await deps.files.quickClean({ categories: cats });   // só as categorias que o cartão mostrava
    const kept = r.skipped ? ` · ${plural(r.skipped, 'em uso ficou', 'em uso ficaram')}` : '';
    return { status: 'feita', result: `${plural(r.files, 'arquivo apagado', 'arquivos apagados')} · ${size(r.bytes)}${kept}` };
  }

  // ---------- ignore ----------
  function ignore(id: string): Suggestion | SuggestionError {
    const s = items.find(x => x.id === id);
    if (!s) return err('sugestão não encontrada', 404);
    if (s.status !== 'pendente' || running.has(id)) return err('essa sugestão já foi decidida', 409);
    s.status = 'ignorada'; s.doneAt = now();
    void persist();
    publish();
    return { ...s };
  }

  return { list, add, approve, ignore, flush: () => writing };
}
export type Suggestions = ReturnType<typeof createSuggestions>;
