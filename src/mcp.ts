// Servidor MCP (stdio) do Folga: as ferramentas que o agente (Claude ou GPT) pode chamar.
// JSON-RPC puro em stdout, uma mensagem por linha; logs só em stderr. As ferramentas são uma ponte para a
// API local do Folga (127.0.0.1), com o token lido do disco. TODAS são só de leitura (R20): nada aqui apaga,
// fecha ou muda coisa alguma do usuário; o agente propõe e o usuário aprova na tela.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const PORT = Number(process.env.FOLGA_PORT ?? 4780);
const DATA_DIR = process.env.FOLGA_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? '.', 'Folga');
const BASE = `http://127.0.0.1:${PORT}`;
const token = () => readFileSync(join(DATA_DIR, 'ui-token'), 'utf8').trim();

type Json = Record<string, unknown>;
// readOnly: o Codex só chama sem pedir aprovação as ferramentas marcadas como leitura (readOnlyHint)
type Tool = { name: string; description: string; inputSchema: Json; readOnly: boolean; run: (args: Json) => Promise<unknown> };

async function get(path: string): Promise<unknown> {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Folga respondeu ${res.status}`);
  return res.json();
}
// POST só para a varredura de arquivos (ela lê metadados e guarda o resultado; não altera nada do usuário)
async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-folga-token': token() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(100_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { erro?: string }).erro ?? `Folga respondeu ${res.status}`);
  return data;
}

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const mb = (b: number) => Math.round(b / MB);
const pad = (n: number) => String(n).padStart(2, '0');
const dia = (t: number | null | undefined) => {
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return null;
  const d = new Date(t);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
// nome de arquivo é dado do usuário: tira controles e corta o excesso (R24)
const texto = (s: unknown, max = 260) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
const nada = { type: 'object', properties: {}, additionalProperties: false };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Ferramentas: só leitura. O formato das respostas é compacto (poucos tokens) e em português.
export const TOOLS: Tool[] = [
  {
    name: 'ver_memoria',
    description: 'Use para saber como está a memória do PC agora: porcentagem em uso e os apps agrupados em parados, em uso e protegidos, com o tamanho de cada um.',
    inputSchema: nada,
    readOnly: true,
    run: async () => {
      const s = await get('/api/state') as { memLoad: number; totalPhys: number; availPhys: number; apps: { key: string; name: string; state: string; reason: string; privateWorkingSet: number; cpuPercent: number }[] };
      return {
        emUsoPorcento: s.memLoad,
        totalGB: +(s.totalPhys / GB).toFixed(1),
        disponivelGB: +(s.availPhys / GB).toFixed(1),
        apps: s.apps.filter(a => a.state !== 'protected').map(a => ({ app: a.key, nome: a.name, estado: a.state, motivo: a.reason, MB: mb(a.privateWorkingSet), cpu: a.cpuPercent })),
        protegidosMB: mb(s.apps.filter(a => a.state === 'protected').reduce((t, a) => t + a.privateWorkingSet, 0)),
      };
    },
  },
  {
    name: 'ver_avisos',
    description: 'Use para ver os avisos ativos do Folga (memória alta, disco cheio, apps que travaram, antivírus, sonda), do mais grave ao menos grave.',
    inputSchema: nada,
    readOnly: true,
    run: async () => {
      const w = await get('/api/warnings') as { id: string; severity: string; title: string; detail: string; view?: string; firstSeen: number; active: boolean }[];
      const ordem: Record<string, number> = { critico: 0, atencao: 1, info: 2 };
      const ativos = w.filter(x => x.active).sort((a, b) => (ordem[a.severity] ?? 3) - (ordem[b.severity] ?? 3));
      return { total: ativos.length, avisos: ativos.map(x => ({ id: x.id, nivel: x.severity, titulo: texto(x.title, 120), detalhe: texto(x.detail, 240), desde: dia(x.firstSeen), tela: x.view ?? null })) };
    },
  },
  {
    name: 'ver_disco',
    description: 'Use para ver quanto espaço livre há em cada unidade de disco do PC.',
    inputSchema: nada,
    readOnly: true,
    run: async () => {
      const d = await get('/api/disk') as { drive: string; total: number; free: number }[];
      return d.map(x => ({ unidade: x.drive, totalGB: +(x.total / GB).toFixed(1), livreGB: +(x.free / GB).toFixed(1), livrePorcento: x.total ? Math.round((x.free / x.total) * 100) : null }));
    },
  },
  {
    name: 'procurar_arquivos_parados',
    description: 'Use para achar arquivos grandes que o Antônio não abre há muito tempo, nas pastas dele (Downloads, Área de Trabalho, Documentos, Imagens, Vídeos, Músicas). Pode levar alguns segundos. Devolve os 40 maiores com tamanho, último uso e como esse uso foi medido (base).',
    inputSchema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Sem uso há pelo menos quantos dias (7 a 3650). Padrão: o ajuste do app (180).' },
        minMB: { type: 'number', description: 'Ignora arquivos menores que isto, em MB (1 a 100000). Padrão: o ajuste do app (10).' },
      },
      additionalProperties: false,
    },
    readOnly: true,
    run: async args => {
      const r = await post('/api/files/scan', { olderThanDays: num(args.dias), minMB: num(args.minMB) }) as {
        files: { path: string; size: number; lastUsed: number; basis: string }[]; totalBytes: number; truncated: boolean;
        scanned: number; roots: string[]; olderThanDays: number; minBytes: number; accessTracking: boolean;
      };
      return {
        achados: r.files.length,
        totalMB: mb(r.totalBytes),
        buscaTruncada: r.truncated,
        semUsoHaDias: r.olderThanDays,
        minMB: mb(r.minBytes),
        // base: 'acesso' = último acesso registrado; 'recentes' = lista Recentes do Windows; 'modificacao' = só a data de modificação
        arquivos: r.files.slice(0, 40).map(f => ({ caminho: texto(f.path), MB: mb(f.size), ultimoUso: dia(f.lastUsed), base: f.basis })),
        mostrando: Math.min(40, r.files.length),
      };
    },
  },
  {
    name: 'ver_limpeza_rapida',
    description: 'Use para ver quanto dá para liberar com a limpeza rápida: arquivos temporários do usuário, cache dos navegadores e a Lixeira.',
    inputSchema: nada,
    readOnly: true,
    run: async () => {
      const q = await get('/api/quickclean') as { category: string; label: string; bytes: number; files: number; actionable: boolean; note?: string }[];
      return q.map(i => ({ categoria: i.category, nome: texto(i.label, 80), MB: mb(i.bytes), arquivos: i.files, podeLimpar: i.actionable, nota: i.note ? texto(i.note, 160) : undefined }));
    },
  },
  {
    name: 'ver_inicializacao',
    description: 'Use para ver quais programas abrem junto com o Windows (e se estão ativos). Ajuda a explicar o que pesa logo depois de ligar o PC.',
    inputSchema: nada,
    readOnly: true,
    run: async () => {
      const a = await get('/api/startup-apps') as { name: string; command: string; source: string; enabled: boolean }[];
      return a.map(x => ({ nome: texto(x.name, 80), ativo: x.enabled, origem: x.source, comando: texto(x.command, 160) }));
    },
  },
  {
    name: 'ver_sugestoes',
    description: 'Use para ver as sugestões que ainda aguardam a decisão do Antônio na tela (pendentes), para não repetir uma que já está lá.',
    inputSchema: nada,
    readOnly: true,
    run: async () => {
      const s = await get('/api/suggestions') as { id: string; kind: string; title: string; reason: string; bytes: number; items: unknown[]; status: string; source: string }[];
      const pend = s.filter(x => x.status === 'pendente');
      return { pendentes: pend.length, sugestoes: pend.map(x => ({ id: x.id, tipo: x.kind, titulo: texto(x.title, 120), MB: mb(x.bytes), itens: x.items.length, origem: x.source })) };
    },
  },
  {
    name: 'ver_registro',
    description: 'Use para ver as 20 últimas liberações de memória feitas (manuais e do Auto Care): quando, quanta memória voltou e quais apps foram fechados.',
    inputSchema: nada,
    readOnly: true,
    run: async () => {
      const l = await get('/api/log?limit=20') as { t: number; origin: string; availBefore: number; availAfter: number; results: { name: string; outcome: string }[] }[];
      return l.map(e => ({ data: dia(e.t), origem: e.origin, liberadoMB: mb(e.availAfter - e.availBefore), apps: e.results.map(r => `${texto(r.name, 40)}: ${r.outcome}`) }));
    },
  },
];

const byName = new Map(TOOLS.map(t => [t.name, t]));
const send = (msg: Json) => process.stdout.write(JSON.stringify(msg) + '\n');
const log = (...a: unknown[]) => process.stderr.write(a.map(String).join(' ') + '\n');

async function handle(msg: Json) {
  const id = msg.id as string | number | undefined;
  const method = msg.method as string;
  const reply = (result: unknown) => { if (id !== undefined) send({ jsonrpc: '2.0', id, result }); };
  const fail = (code: number, message: string) => { if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code, message } }); };
  const params = (msg.params ?? {}) as Json;

  switch (method) {
    case 'initialize':
      // devolve a versão que o cliente pediu: os dois CLIs falam versões diferentes do protocolo
      return reply({
        protocolVersion: (params.protocolVersion as string) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'folga', version: '0.3.0' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema, readOnly }) => ({
          name, description, inputSchema,
          annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const tool = byName.get(params.name as string);
      if (!tool) return fail(-32602, `ferramenta desconhecida: ${params.name}`);
      try {
        const out = await tool.run((params.arguments ?? {}) as Json);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out) }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `erro: ${e instanceof Error ? e.message : 'falhou'}` }], isError: true });
      }
    }
    default:
      if (id !== undefined) fail(-32601, `método não suportado: ${method}`);
  }
}

// só roda como servidor quando executado direto (os testes importam TOOLS sem abrir o stdin)
if (process.argv[1] && /mcp\.ts$/.test(process.argv[1])) {
  createInterface({ input: process.stdin })
    .on('line', line => {
      if (!line.trim()) return;
      let msg: Json;
      try { msg = JSON.parse(line); } catch { log('linha inválida'); return; }
      handle(msg).catch(e => log('erro', e));
    })
    .on('close', () => { process.exitCode = 0; });
}
