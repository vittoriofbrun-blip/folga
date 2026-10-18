# Roadmap — sprints e tickets

Os briefs completos de cada ticket ficam **só** no kanban: `~/.fainow-kanban/boards/folga/tarefas.json`,
visto em http://localhost:4747/b/folga. Aqui fica a ordem, para não duplicar o conteúdo
(lição: mapa de tickets diverge dos arquivos individuais).

| Sprint | Ticket | Tipo | Depende de | Pode rodar junto com |
|---|---|---|---|---|
| S0 Base | **F-00** Esqueleto, git e contrato `src/types.ts` | agente | — | F-10 |
| S0 Base | **F-10** Nome e paleta (P01, P02) | humano | — | F-00 |
| S1 Pilares | **F-01** Spike: sonda nativa (bloqueia o produto) | misto | F-00 | F-02, F-05 |
| S1 Pilares | **F-02** Classificador: parados, em uso, protegidos | agente | F-00 | F-01, F-05 |
| S1 Pilares | **F-05** Tela Memória com dados falsos | agente | F-00 | F-01, F-02 |
| S2 Liga tudo | **F-03** Servidor: sonda viva, HTTP, SSE, token | agente | F-01, F-02 | — |
| S2 Liga tudo | **F-04** Liberar de verdade e registro em arquivo | agente | F-03 | F-11 |
| S2 Liga tudo | **F-11** App tocando áudio conta como em uso | agente | F-03 | F-04 |
| S3 Auto Care | **F-06** Auto Care de memória (servidor e tela) | agente | F-04 | F-07 |
| S3 Auto Care | **F-07** Telas Registro e Ajustes | agente | F-04 | F-06 |
| S4 Entrega | **F-08** Janela do Edge, iniciar escondido, abrir com o Windows | misto | F-06, F-07 | — |
| S4 Entrega | **F-09** Pegada (R18) e QA de ponta a ponta | misto | F-08 | — |
| Depois | **F-12** Partículas na tela Memória (opcional) | agente | F-05 | qualquer |

**Caminho crítico:** F-00 → F-01 → F-03 → F-04 → F-06 → F-08 → F-09.
O F-01 é o risco do projeto: se a sonda não ler o working set privado e o primeiro plano com pegada baixa,
o resto muda. Por isso ele é o primeiro depois do esqueleto.

## v2 (2026-10-18): McAfee, assistente e visual do Mint
| Ticket | O quê | Arquivos donos | Pode rodar junto com |
|---|---|---|---|
| **F-14** | Visual do Mint, Início (saúde, anéis), partículas na Memória (absorve o F-12) e os campos novos de Ajustes | `web/src/app.css`, `App.tsx`, `Inicio.tsx`, `health.ts`, `Particles.tsx`, `Memory.tsx`, `Settings.tsx`, `AutoCare.tsx`, `Log.tsx` | F-15, F-17, F-18 |
| **F-15** | Avisos: monitor (memória, disco, travamentos, antivírus, Auto Care, sonda) e tela | `src/warnings.ts`, `web/src/Avisos.tsx` | F-14, F-17, F-18 |
| **F-17** | Arquivos parados, limpeza rápida, sugestões com aprovação (R20 a R24) | `src/files.ts`, `src/suggestions.ts`, `web/src/Arquivos.tsx`, `SuggestionCard.tsx` | F-14, F-15, F-18 |
| **F-18** | Assistente Claude/GPT (ADR 0006), ferramentas MCP de leitura, prompt de sistema | `src/agent.ts`, `src/agent-prompt.md`, `src/mcp.ts`, `web/src/Assistente.tsx` | F-14, F-15, F-17 |
| F-19 | Integração, QA ao vivo com os dois provedores e pegada. Feito em 2026-10-18 (ver `state.md`), sem cartão no board | o lead | depois dos quatro |

O número F-16 ficou sem uso; não há ticket faltando.

O contrato (`src/types.ts`, as rotas em `src/server.ts` e os esboços) foi escrito pelo lead antes das trilhas
começarem; as trilhas não mexem nele.

## Depois da v2 (sem ticket até você pedir)
Organizar pastas, desinstalar, ícone na bandeja, notificação do Windows para aviso crítico, ícones reais dos apps.
