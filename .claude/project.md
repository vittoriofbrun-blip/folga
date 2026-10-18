# Projeto — Folga (nome provisório, ver P01)

App de Windows que mostra quais apps estão segurando a memória e fecha, do jeito normal, os que
estão parados. A referência é a frente "Free up memory" do Mint para Mac (`docs/engenharia-reversa-mint.md`).

## Para quem
Antônio, num notebook Windows 11 com 16 GB que satura com várias sessões do Claude Code, servidores
`next dev`/Vite e Chrome. O app é de uso pessoal; distribuição pública não está nos planos.

## O que o app faz (v1)
1. **Memória**: barra de memória usada; apps agrupados em Parados, Em uso, Sistema e protegidos, Liberados;
   os parados já vêm marcados; botão **Liberar**.
2. **Auto Care de memória**: liberado ou não; quando a memória passa da linha que você define (padrão 92 %),
   fecha os apps parados sozinho. Roda enquanto o servidor do app estiver vivo, mesmo com a janela fechada.
3. **Registro**: cada liberação, manual ou automática, com o que fechou, o que ficou aberto e quanto voltou.

Fora da v1: disco, otimizar, organizar, desinstalar, MCP para agentes, partículas animadas (ticket opcional).

## Decisões
- **D01** — Escopo só de memória, Auto Care de memória e Registro. (2026-10-18)
- **D02** — Mesma forma do Play.me, com menos peças: um processo Node 24 com `node:http` em 127.0.0.1 serve
  a SPA React/Vite, JSON e SSE. Sem Agent SDK, sem MCP, sem banco. ADR 0001.
- **D03** — A leitura do Windows fica numa **sonda nativa em C#**, um arquivo `probe/probe.cs` compilado
  pelo `csc.exe` que já vem no Windows (.NET Framework 4.x). Ela fala com o Node por linhas JSON em
  stdin/stdout. PowerShell com `Add-Type` é o plano B. ADR 0002.
  **Emenda (D10, 2026-10-18):** o antivírus apaga o `.exe` sem assinatura, então o padrão é o `probe.cs`
  carregado pelo `Add-Type` do PowerShell (~33 MB). O `.exe` só roda com `FOLGA_PROBE_EXE=1`.
- **D04** — Liberar é mandar `WM_CLOSE` para as janelas do app. **Nunca** encerrar à força por padrão.
  ADR 0003.
- **D05** — Não fazer "limpeza de RAM" com `EmptyWorkingSet` nem esvaziar a lista standby. ADR 0004.
- **D06** — Estado em arquivos: `settings.json` e `log.jsonl` em `%LOCALAPPDATA%\Folga\`. Sem SQLite. ADR 0005.
- **D07** — A janela é o Edge em modo app (`msedge --app=… --user-data-dir=…`), com perfil próprio para
  não se misturar com o Edge do dia a dia. Sem Electron nem Tauri. ADR 0001.
- **D08** — CSS com tokens próprios em vez de Tailwind: são 3 telas. Adicionar Tailwind se passar de ~5 telas.
- **D09** — Ícones de app viram avatares com a inicial (o próprio guia do Mint faz isso). Ícone real depois.

## Perguntas abertas (decisão do Antônio)
- **P01** — Nome do app. "Folga" é provisório. Não pode ser "Mint".
- **P02** — Paleta: fundo escuro como o Mint, mas a cor de destaque não pode ser o verde-limão `#bdfe3a`.
  Proposta provisória em `docs/referencias-ui/README.md`.
- **P03** — Apps que vão para a bandeja (Teams, Discord, Spotify): permitir "encerrar de vez" por app,
  com aviso? Padrão proposto: não; você marca app por app.
- **P04** — Abrir junto com o Windows? Padrão proposto: desligado, com um botão em Ajustes.
- **P05** — Linha do Auto Care: 92 % como o Mint, ou outra?
- **P06** — Tempo para considerar um app parado: 30 min proposto. O Mint não diz o dele, mas marca o Slack
  "idle 40 min" como parado, então o corte dele é no máximo 40 min.
- **P07** — Disco e organizar pastas entram numa v2?
