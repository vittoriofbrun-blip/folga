# Folga (nome provisório) — economizar memória no Windows

App pessoal de Windows inspirado na frente "Free up memory" do Mint para Mac. Mostra quais apps seguram
a memória e fecha, do jeito normal, os que estão parados. Também tem Auto Care por porcentagem e um registro.

## Leia conforme a tarefa
- Visão, decisões D## e perguntas abertas P##: `.claude/project.md`
- Regras R## (a "lei"): `.claude/requirements.md`
- Stack, árvore de arquivos, **contrato de tipos** e API: `.claude/fluxo-infraestrutura.md`
- Jornada de liberar memória e casos de borda: `.claude/fluxo-memoria.md`
- Ordem dos tickets: `.claude/roadmap.md` · briefs no kanban http://localhost:4747/b/folga
- Por que cada escolha: `.claude/adr/`
- O que o Mint faz (observado × inferido): `docs/engenharia-reversa-mint.md`, telas em `docs/referencias-ui/`
- Estado da última sessão: `.claude/state.md` (só o topo)

## Comandos
`npm run build` e depois `npm run app` (sobe o servidor escondido e abre a janela) · `npm run dev` (servidor + Vite em 5180) ·
`npm test` · `npm run typecheck` · `node scripts/probe-smoke.mjs` (sonda real) · `node scripts/footprint.mjs --minutes 10` (R18).
A sonda roda pelo `Add-Type` do PowerShell (D10); `FOLGA_PROBE_EXE=1` usa o `.exe`, que o antivírus apaga.

## Regras que não se quebram
- Nunca encerrar app à força por padrão. Liberar é `WM_CLOSE` (ADR 0003, R07).
- Nada de `EmptyWorkingSet` nem de esvaziar a lista standby (ADR 0004).
- "Liberados X GB" é o disponível depois menos o de antes, nunca a soma dos apps (R08).
- Servidor só em 127.0.0.1, com token em todo POST/PUT (R15–R17).
- Pegada em segundo plano ≤ 120 MB (R18). Dependência nova só com motivo escrito.
- Visual: cores, layout e animações do Mint, por pedido do Antônio (D12). Nunca o nome, o logo nem a imagem da Terra do Mint.
- O agente só sugere; executar é sempre um clique do usuário, com o servidor revalidando tudo (R20–R25, ADR 0006).
- Método ponytail: menor diff que funciona, sem abstração sem uso; lógica com regra deixa um teste `node:assert`.

## Armadilhas de Windows
`spawn` com caminho absoluto e `shell:false`; o caminho tem acento (`C:\Users\Antônio`), então nada de
`fs.cpSync` recursivo; arquivo gravado pelo Node, não por `Set-Content` (BOM); a sonda morre junto com o
servidor; matar por árvore (`taskkill /T`) e conferir o PID dono da porta. Detalhes em `fluxo-infraestrutura.md`.

## Agentes despachados pelo kanban
Não rodam PowerShell nem `csc.exe` direto: chamam `node scripts/...`. Sem push, deploy ou segredo.
