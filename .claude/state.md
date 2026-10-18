# Estado (mais recente no topo)

## 2026-10-18 (tarde) — v2: McAfee, assistente Claude/GPT, avisos, arquivos e visual do Mint
- Decisões D11 a D20 (nome Folga, visual do Mint, P03 a P07 como padrões, agente, avisos, arquivos parados,
  limpeza rápida, Início, só sugere, projeto de código fora). Regras R20 a R28. ADR 0006 do agente.
- Engenharia reversa do McAfee:
  - relatório em `docs/engenharia-reversa-mcafee.md`;
  - 17 capturas em `docs/referencias-ui/mcafee/` (16 do LiveSafe e 1 do PC Optimizer; o `pco-02` era cópia
    idêntica do `pco-01` e saiu);
  - a quarentena confirmou que o McAfee apagava o `probe.exe`.
- Construído pelos tickets F-14, F-15, F-17 e F-18, em quatro trilhas paralelas, e depois corrigido pela
  revisão de segurança, sem nenhum achado crítico:
  - **A1:** o crash por URI malformada;
  - **M1 a M6:** clickjacking, PID reaproveitado, temporários, Lixeira conferida, cartão restrito à busca e
    com validade, token do agente e pasta de trabalho do agente;
  - **B1 a B7:** os itens baixos.
  - **B8 ficou aberto, como risco aceito:** o ambiente dos CLIs tira só 4 variáveis (`ANTHROPIC_API_KEY`,
    `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY`), e as outras passam. O risco é pequeno,
    porque o Claude roda sem ferramentas além das do Folga e o Codex roda sem shell. Uma lista do que pode
    passar exigiria testar de novo os dois provedores ao vivo.
- Verificado:
  - 11 suítes verdes, typecheck e build.
  - Claude e GPT respondendo pela tela real com dados reais. A troca de provedor abre conversa nova, e a
    conversa sobrevive ao reinício do servidor.
  - Ponta a ponta: o Claude procurou, sugeriu mandar um arquivo de teste para a Lixeira e eu aprovei o
    cartão. O resultado foi "Feita · 1 arquivo na Lixeira", e o arquivo está na Lixeira com a origem
    Downloads.
  - Busca real só de leitura: 1 arquivo depois da D20; antes eram 59, quase todos de um venv.
  - CSP sem violações.
  - Pegada do servidor mais sonda: 28 a 74 MB.
  - Capturas em `docs/telas-v2/`.
- Não verificado:
  - Chrome do Antônio com várias janelas e app de bandeja dele (F-13);
  - reinício do Windows com o atalho (F-08);
  - o diálogo do Windows para arquivo grande demais para a Lixeira (M4).
- Fica na Lixeira do Antônio: `folga-teste-lixeira.bin` (2 MB, arquivo de teste do QA), mais 2 arquivos do
  teste real da Lixeira do F-17.
- 13:41: o servidor real voltou ao ar com a v2, escondido (`launch.mjs --no-window`).
  - Ajustes salvos intactos: Auto Care ligado em 92 % e o "nunca fechar" com Claude, Antigravity IDE e Codex.
    Os campos novos entraram com os padrões.
  - A pasta Inicializar não tem o atalho do Folga. Depois de reiniciar o Windows, o Auto Care só volta com
    `npm run app` ou ligando "Abrir com o Windows" em Ajustes.
- Cartões F-10, F-12, F-14, F-15, F-17 e F-18 em Revisar, para o Antônio fechar.

## 2026-10-18 — v1 construída (F-00 a F-11)
- Feito e commitado:
  - sonda C# rodando pelo `Add-Type` do PowerShell (D10: o antivírus apaga o `.exe`);
  - classificador com áudio e filtro de janela de ferramenta ou cloaked;
  - servidor `node:http` com token;
  - liberar com conferência e `log.jsonl`;
  - Auto Care;
  - telas Memória, Auto Care, Registro e Ajustes;
  - janela do Edge em modo app;
  - atalho opcional de inicialização.
- Verificado:
  - 4 suítes, 41 casos (`npm test`), typecheck e build;
  - teste ao vivo: o Paint fechou pela tela com "fechou", voltaram 233 MB e a linha entrou no `log.jsonl`;
  - a sonda morta voltou sozinha em menos de 4 s;
  - pegada sem janela: média 74 MB, pico 76 MB, 0,13 % da CPU total (R18 ok);
  - com a janela do Edge aberta, a árvore dela soma ~290 MB e entra como `__self`.
- Verificado depois:
  - `scripts/qa-live.ts`, com janelas WinForms reais e próprias e a sonda real, mirando só os PIDs delas:
    duas janelas (`fechou`, WM_CLOSE nas 2), diálogo "Salvar?" (`ficou_aberto`), bandeja (`bandeja`),
    bandeja com `mayForceQuit` (`encerrado`). 5 casos ok, sem sobras;
  - `src/tests/autocare-server.test.ts`: o Auto Care dispara sozinho no servidor real (sonda falsa), fecha só o
    parado, grava `origin: auto` e liga o freio.
  - atalho de inicialização criado numa pasta temporária e aberto como no logon: o servidor subiu sem janela e
    leu 136 apps (falta só o reinício real do Windows).
- Falta só com apps do Antônio (cartão F-13): Chrome dele com várias janelas (hipótese: a restauração de sessão
  do Chromium pode reabrir só a última janela fechada) e um app de bandeja dele.
- Atenção:
  - `%LOCALAPPDATA%\Folga\settings.json` está com `autoCareEnabled: true` em 92 %. Antônio confirmou que ligou
    pela tela e quer manter (2026-10-18).
  - Com a memória em ~90 %, o Auto Care fecha apps parados há 30 min enquanto o app estiver rodando.
  - Claude Code, Antigravity IDE e Codex entraram no "nunca fechar" padrão e no `settings.json` salvo.
    Antes, a QA ao vivo mostrava os três como liberáveis.
- Pendências humanas:
  - P01–P07 (F-10);
  - antivírus, se quiser o `.exe` (F-01);
  - reiniciar o Windows uma vez com o atalho ligado (F-08).
- Conhecido:
  - rodar `npm run app` com a janela já aberta abre uma segunda janela;
  - `sampleSeconds` só vale depois de reiniciar.
- Próximo opcional: F-12 (partículas).
