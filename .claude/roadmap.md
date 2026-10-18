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

## Depois da v1 (sem ticket até você pedir)
Disco e limpeza, organizar pastas, desinstalar, MCP/CLI para agentes, ícone na bandeja, ícones reais dos apps.
