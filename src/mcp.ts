// Servidor MCP (stdio) do Folga: as ferramentas que o agente (Claude ou GPT) pode chamar.
// JSON-RPC puro em stdout, uma mensagem por linha; logs só em stderr. As ferramentas são uma ponte para a
// API local do Folga (127.0.0.1), com o token lido do disco. Nada aqui apaga ou fecha coisa alguma:
// a única escrita é registrar uma sugestão, que o usuário aprova na tela (R20).
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
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Folga respondeu ${res.status}`);
  return res.json();
}
async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-folga-token': token() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { erro?: string }).erro ?? `Folga respondeu ${res.status}`);
  return data;
}

// Ferramentas: só leitura, mais "sugerir". O formato das respostas é o da API do Folga.
export const TOOLS: Tool[] = [
  {
    name: 'ver_memoria',
    description: 'Memória do PC agora: porcentagem em uso e os apps agrupados em parados, em uso e protegidos, com o tamanho de cada um.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    run: async () => {
      const s = await get('/api/state') as { memLoad: number; totalPhys: number; availPhys: number; apps: { key: string; name: string; state: string; reason: string; privateWorkingSet: number; cpuPercent: number }[] };
      const MB = 1024 ** 2;
      return {
        emUsoPorcento: s.memLoad,
        totalGB: +(s.totalPhys / 1024 ** 3).toFixed(1),
        disponivelGB: +(s.availPhys / 1024 ** 3).toFixed(1),
        apps: s.apps.filter(a => a.state !== 'protected').map(a => ({ app: a.key, nome: a.name, estado: a.state, motivo: a.reason, MB: Math.round(a.privateWorkingSet / MB), cpu: a.cpuPercent })),
        protegidosMB: Math.round(s.apps.filter(a => a.state === 'protected').reduce((t, a) => t + a.privateWorkingSet, 0) / MB),
      };
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
        serverInfo: { name: 'folga', version: '0.2.0' },
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
