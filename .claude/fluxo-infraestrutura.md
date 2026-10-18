# Infraestrutura — stack, peças e contrato

## Stack (a do Play.me, com menos peças)
- Node v24.13.0, npm 11.6.2, TypeScript strict. O servidor roda `.ts` direto: `node --no-warnings src/server.ts`.
- `node:http` puro com SSE. Sem express, Agent SDK, MCP ou banco.
- React 19 + Vite 8 + `@vitejs/plugin-react`, com CSS de tokens em `web/src/tokens.css` (D08).
- Sonda nativa: C# em um arquivo, compilado por
  `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, que já vem no Windows.
- Testes sem framework: `node --no-warnings src/tests/x.test.ts` com `node:assert`. `npm test` encadeia todos.
- Um único `package.json` na raiz, sem workspaces. O Vite usa `web/` como root.

## Peças (C4 nível container)
```
[Usuário] → janela Edge --app (perfil próprio) → http://127.0.0.1:4780
                                                     │
                                  ┌──────────────────┴──────────────────┐
                                  │ Node: src/server.ts                 │
                                  │  HTTP + SSE + token + estáticos     │
                                  │  classify.ts (regras R03–R06)       │
                                  │  release.ts (R07–R09) · autocare.ts │
                                  │  settings.json · log.jsonl          │
                                  └──────────────────┬──────────────────┘
                                         stdin/stdout, uma linha JSON por mensagem
                                  ┌──────────────────┴──────────────────┐
                                  │ probe.exe (C#): GlobalMemoryStatusEx,│
                                  │ processos, janelas, foreground, CPU, │
                                  │ WM_CLOSE                             │
                                  └──────────────────────────────────────┘
```

## Árvore de arquivos planejada
```
package.json  tsconfig.json  vite.config.ts  .gitignore
probe/probe.cs                 F-01  sonda nativa
scripts/build-probe.mjs        F-01  compila com csc.exe → probe/bin/probe.exe (gitignored)
scripts/probe-smoke.mjs        F-01  sobe a sonda, imprime 3 leituras e o top 10 por memória
scripts/launch.mjs             F-08  sobe o servidor escondido e abre a janela
src/types.ts                   F-00  contrato (abaixo), escrito antes de tudo
src/classify.ts                F-02  função pura: (leitura, histórico, ajustes, agora) → grupos
src/probe.ts                   F-03  spawn da sonda, parse de linhas, reinício se morrer
src/server.ts                  F-03  HTTP, SSE, token, estáticos
src/release.ts                 F-04  liberar (R07–R09) e gravar o registro (R14)
src/autocare.ts                F-06  gatilho, freio (R10–R13)
src/tests/*.test.ts            um por módulo com lógica
web/index.html  web/src/{main,App,Memory,AutoCare,Log}.tsx  web/src/tokens.css
```
Dados em `%LOCALAPPDATA%\Folga\`:
- `settings.json`, `log.jsonl`, `ui-token` e `edge-profile\`;
- desde a v2: `agent-token` (só para a busca, lido pelo MCP), `suggestions.json`, `agent.json`,
  `agent-mcp.json` e `agent-cwd\` (pasta vazia, diretório de trabalho dos CLIs).

v2: servidor MCP do agente em `src/mcp.ts`, assistente em `src/agent.ts` (ADR 0006), avisos em
`src/warnings.ts`, arquivos e limpeza em `src/files.ts`, sugestões em `src/suggestions.ts`.

v3: o vigia em `src/watch.ts` (R30, D21). Ele só chama `suggestions.add(draft, 'folga')`; executar continua
sendo `suggestions.approve`, que só roda no clique. Testes: `FOLGA_WATCH_MS` encurta o ciclo, e a sonda falsa
aceita `FAKE_AVAIL_GB` e `FAKE_NOTEPAD_MB`.

## Contrato (`src/types.ts`, F-00)
Desde o F-00 a fonte é o `src/types.ts`, que também exporta `DEFAULT_SETTINGS`, `SYSTEM_PROCESSES` e
`ReleaseResponse`. Este bloco é o resumo.
```ts
// sonda → Node (uma linha por leitura)
export type ProbeProcess = {
  pid: number; ppid: number; name: string; description: string; session: number;
  privateWorkingSet: number;   // bytes (R02)
  cpuTimeMs: number;           // acumulado; o Node calcula o delta (R04)
  hasVisibleWindow: boolean;   // janela de topo visível, sem dono
  accessible: boolean;         // OpenProcess com o token do usuário funcionou
};
export type ProbeSnapshot = {
  type: 'snapshot'; t: number; memLoad: number; totalPhys: number; availPhys: number;
  foregroundPid: number | null; processes: ProbeProcess[];
};
// Node → sonda
export type ProbeCommand =
  | { type: 'close'; id: string; pids: number[] }   // WM_CLOSE em todas as janelas visíveis
  | { type: 'kill'; id: string; pids: number[] };   // só para apps em mayForceQuit (P03)
export type ProbeReply = { type: 'reply'; id: string; ok: boolean; windowsClosed: number };

// Node → interface
export type AppState = 'idle' | 'in_use' | 'protected';
export type AppReason = 'foreground' | 'busy' | 'recent' | 'idle'
  | 'no_window' | 'system' | 'never_close' | 'self' | 'other_session';
export type AppGroup = {
  key: string; name: string; pids: number[]; privateWorkingSet: number;
  cpuPercent: number; state: AppState; reason: AppReason;
  lastFocusedAt: number | null;   // epoch ms; null = nunca visto em primeiro plano
};
export type Outcome = 'fechou' | 'ficou_aberto' | 'bandeja' | 'encerrado' | 'recusado';
export type ReleaseResult = { key: string; name: string; outcome: Outcome };
export type LogEntry = {
  t: number; origin: 'manual' | 'auto'; availBefore: number; availAfter: number;
  results: ReleaseResult[];
};
export type Settings = {
  idleMinutes: number; busyCpuPercent: number; sampleSeconds: number;
  autoCareEnabled: boolean; autoCareThreshold: number; autoCareCooldownMinutes: number;
  neverClose: string[]; mayForceQuit: string[];
};
export type MemoryState = {
  t: number; memLoad: number; totalPhys: number; availPhys: number;
  apps: AppGroup[]; freed: ReleaseResult[]; settings: Settings; startedAt: number;
  autoCare: { nextEligibleAt: number | null; lastRunAt: number | null };   // preenchido no F-06
};
```

## API (127.0.0.1:4780, `FOLGA_PORT`)
| Rota | O quê |
|---|---|
| `GET /api/token` | Devolve o token. Sem CORS, então outro site não lê a resposta; o `Host` é checado (R15). |
| `GET /api/state` | `MemoryState` |
| `GET /api/events` | SSE, evento `state` a cada leitura |
| `POST /api/release` `{keys}` | `{availBefore, availAfter, results}` (R07–R09) |
| `GET /api/settings` · `PUT /api/settings` | `Settings` |
| `GET /api/log?limit=100` | `LogEntry[]`, mais novo primeiro |

Vite de desenvolvimento em `127.0.0.1:5180 --strictPort`, com proxy de `/api` para 4780.

## Armadilhas de Windows (do second-brain)
- `spawn` da sonda e do `csc.exe` com **caminho absoluto** e `shell: false`. Nada de `.cmd` sem shell.
- O caminho do usuário tem acento (`C:\Users\Antônio`): não usar `fs.cpSync` recursivo; usar
  `fs.promises.cp` ou copiar arquivo a arquivo.
- Arquivos gravados por PowerShell 5.1: `Set-Content -Encoding utf8` grava BOM. Gravar pelo Node.
- Encerrar o servidor fecha a sonda junto (`child.kill()` no `exit`/`SIGINT`). Ao matar na mão, use
  `taskkill /PID <pid> /T` e confira o `CommandLine` antes, para não derrubar outro projeto na mesma porta.
- Usar `process.exitCode = n` em vez de `process.exit()` depois de saída grande.
- Depois de reiniciar, conferir o PID dono da porta: um 200 pode vir do servidor antigo.
