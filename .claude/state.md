# Estado (mais recente no topo)

## 2026-10-18 (17:45 a 18:00) — R29 vista na tela com Chrome real, aviso confirmado, BOM corrigido
- **R29 provada ao vivo, sem tocar no Chrome do Antônio.** Abri 2 janelas de Chrome com perfil temporário e
  li por um servidor de teste à parte (porta 4792, sonda real, Auto Care e vigia desligados, `idleMinutes` 5):
  - a sonda contou `janelas=2` no grupo `chrome`, que inclui o Chrome real;
  - passados os 5 min sem foco, o estado virou `in_use/multi_window`;
  - a tela Memória mostrou, em "Em uso": **"2 janelas · fechar faz o navegador reabrir só a última"**, e o
    app **não** veio marcado. Captura em `docs/telas-v2/10-r29-chrome-2-janelas.jpg`.
  - Tudo removido depois: janelas de teste, servidor e pastas temporárias.
  - Falta do F-13 só o app de bandeja do Antônio.
- **`scripts/qa-live.ts` rodado de novo com a sonda de hoje** (ela mudou: passou a mandar `windowCount`).
  Os 5 casos do R07 continuam certos com janelas reais: `fechou`, `ficou_aberto`, **`bandeja`**, `encerrado`
  e WM_CLOSE nas 2 janelas do caso de várias. Sem sobras.
  - Ou seja, o mecanismo da bandeja está provado com janela real. O que falta no F-13 é só confirmar com um
    app de bandeja do próprio Antônio, e isso é decisão dele: fechar um app dele sem pedir pode perder
    trabalho não salvo.
- **R31 confirmada de verdade:** a Central de Ações do Windows guarda os avisos do Folga, com o texto certo,
  inclusive o teste com `"`, `<tag>`, `&` e `$(...)` saindo literal. Antes só havia o código de saída 0.
  - Sobraram na Central os avisos de teste ("Folga (teste)", "(teste 3)"), que o Antônio pode dispensar.
  - O Folga ainda não marca os avisos com `tag`, então não dá para ele mesmo tirar os seus da Central.
- **Bug achado e corrigido no meio disso:** `settings.json` com BOM quebrava o `JSON.parse` e **zerava os
  ajustes em silêncio** (Auto Care desligado, listas vazias). O PowerShell 5.1 grava BOM com `-Encoding utf8`.
  - `loadSettings` passou a tirar o BOM; o `autocare-server.test.ts` grava o arquivo com BOM de propósito e
    falha sem a correção.
  - **Não é a causa do caso do logon:** o `settings.json` real não tem BOM (bytes conferidos).
- O cartão F-08 do quadro foi anotado (o servidor do kanban precisou ser religado depois do reinício).

## 2026-10-18 (17:40) — o logon passa a abrir a janela (R33)
- O Antônio pediu a janela aberta no logon, e não só o servidor. O atalho deixou de passar `--no-window`.
- O atalho foi refeito pela API (desligar e ligar), e o caminho do logon foi testado de verdade: servidor
  derrubado, `node scripts\launch.mjs` rodado como o atalho roda, e a janela do Edge com o perfil do Folga
  abriu, com o servidor lendo o `settings.json` e o Auto Care em 92 %.
- O texto do interruptor em Ajustes foi corrigido: antes dizia "sem abrir a janela".
- 15 suítes verdes, typecheck e build.

## 2026-10-18 (17:15 a 17:35) — F-08 passou, e um início no logon que não leu os ajustes
- **F-08 está feito.** O Antônio reiniciou o Windows (boot 17:07:51) e disse "não apareceu o app". O servidor
  **subiu sozinho**: PID 5400 às 17:09:30, pelo atalho (`FOLGA_OPEN_WINDOW=0` no ambiente dele, pai já morto),
  escutando na 4780, com a sonda viva. Não aparecer janela é o combinado do `--no-window`.
  - Lição de produto: o único jeito de saber que ele subiu era abrir o navegador. Faltava feedback.
- **Anomalia naquele processo, sem causa fechada:**
  - `/api/settings` devolvia `autoCareEnabled: false`, com o `settings.json` do disco dizendo `true`;
  - `/api/token` devolvia um token diferente do `ui-token` do disco;
  - ele nunca reescreveu `agent-token` (escrita incondicional no início);
  - um `PUT /api/settings` nele respondeu 200 e **não** alterou nenhum `settings.json` do perfil;
  - o ambiente dele, lido do PEB, estava correto: `LOCALAPPDATA` certo e **sem** `FOLGA_DATA_DIR`.
  - Descartados: BOM e JSON inválido (o arquivo parseia e `mergeSettings` o aceita numa cópia), pasta de dados
    dentro do projeto, variável de ambiente persistente, link na pasta, e código antigo (ele tinha
    `watchEnabled`, que é de hoje).
  - Um servidor subido à mão pelo mesmo `launch.mjs` fica **correto**: token igual ao do disco, Auto Care em
    92 % vindo do arquivo, `agent-token` reescrito.
- **Por isso a R32:** o `launch.mjs` passou a gravar a saída em `%LOCALAPPDATA%\Folga\server.log`, e o servidor
  grava uma linha ao subir com pasta de dados, origem dos ajustes e Auto Care. No logon ele usava
  `stdio: 'ignore'`, ou seja, nenhuma testemunha. No próximo reinício o arquivo responde.
- **Auto Care religado** em 92 % no processo que estava no ar, e o servidor foi reiniciado com o código novo.
  15 suítes verdes e typecheck.

## 2026-10-18 (16:10 a 16:36) — o vigia avisa (R31) e cartão de máquina não fecha app em uso
- **Furo fechado antes de qualquer coisa:** o vigia nascia com `source: 'folga'`, que é o do cartão montado
  na tela, e esse aceita fechar app **não parado** porque o usuário está olhando a lista. Um cartão de
  máquina pode envelhecer, então ele passou a ter `source: 'vigia'` e a mesma conferência do assistente:
  no clique, só fecha o que ainda está parado. Teste novo em `suggestions.test.ts`.
- **R31, aviso do Windows** (`src/notify.ts`): quando o vigia propõe, toca uma notificação; o toque abre o
  Folga. Um aviso por cartão. Se o Windows recusar uma vez, não insiste.
  - O texto vai por variável de ambiente (`FOLGA_TOAST_*`) e é escapado para XML dentro do script, então
    nome de app nunca vira comando. Conferido: com título e corpo cheios de `"`, `<tag>`, `&`, `$(...)` e
    crase, o script saiu com 0.
  - Usa o AppId do próprio PowerShell, que é o jeito de tocar um toast sem registrar um app no Windows.
    Por isso o primeiro texto é "Folga". **Não conferido:** a previsão é que o Windows mostre a notificação
    sob o nome "Windows PowerShell", mas ninguém olhou a tela.
- Verificado ao vivo: num servidor de teste (porta 4791, sonda falsa), o vigia propôs e **o processo do
  toast foi pego no ar**, com o título do cartão fora da linha de comando. 15 suítes verdes, typecheck, build.
  - **O limite dessa prova:** ela mostra que o processo rodou e saiu com 0. Ninguém confirmou ter **visto** a
    notificação na tela nem ter tocado nela para abrir o Folga. Falta o Antônio dizer.
  - Armadilha pela qual passei: o módulo engole falhas de propósito, então a primeira conferência imprimiu
    "disparado" com o script quebrado. Só rodar o `SCRIPT` exportado por `spawnSync` e ler o status 1 pegou.
  - Uma olhada única 9 s depois da proposta achou 0 processos de toast: foi o laço de 100 ms que pegou.
- Servidor real reiniciado às 16:31 com tudo isto (o commit veio depois, às 16:35).

## 2026-10-18 (15:51 a 16:20) — o vigia: o Folga propõe sozinho (D21, R30)
- Pedido do Antônio: "monitorando o desempenho, traga opções, eu dou o ok e ele já resolve".
- `src/watch.ts`: de minuto em minuto olha memória e disco e monta um cartão. **Não usa modelo de linguagem**
  (D21), e nada acontece sem o clique (R20).
  - Memória: duas leituras seguidas acima de 85 % (7 pontos antes do Auto Care), apps parados somando
    500 MB ou mais, no máximo 5.
  - Disco: menos de 15 % livre e pelo menos 1 GB de limpeza. A medição roda no máximo a cada 30 min.
  - Freio: 1 h depois de propor ou decidir; 6 h se o usuário ignorou; expirar não conta como "não".
  - `watchEnabled` em Ajustes, ligado por padrão.
- Verificado:
  - 14 suítes verdes (`watch` com 13 casos, `watch-server` com 3), typecheck e build;
  - `watch-server.test.ts`: no servidor real com sonda falsa, o vigia propôs sozinho, **nada foi executado**
    e o cartão não se repetiu; depois do POST de aprovação o app fechou e entrou no Registro;
  - na tela, num servidor de teste à parte (porta 4791, sonda falsa, Auto Care desligado): o cartão
    "do Folga · Memória em 91 %: dá para liberar 763 MB" apareceu sozinho no Início, e o clique em Aprovar
    levou a memória de 91 % para 86 %. Servidor e pasta temporária removidos.
- No computador do Antônio o vigia está quieto, e é o esperado. Medido às 16:17 no servidor real:
  - memória em 81 %, contra a linha de 85 %;
  - disco C: com 13,8 % livre (abaixo dos 15 %), mas só 47 MB de limpeza acionável, contra a linha de 1 GB;
  - os 47 MB são o cache do **Edge**, que está fechado. O cache do Chrome não entra na conta, porque o Chrome
    está aberto e o `files.ts` só conta o navegador fechado;
  - `/api/suggestions` tem só o cartão de teste do F-18, já feito. Nada pendente.
- Correções de data e número que o registro do second-brain apontou no texto abaixo: o servidor reiniciou às
  15:34 (não 15:30) e o "Abrir com o Windows" foi ligado às 15:47 (não ~15:55). A oscilação medida foram
  7 trocas de grupo em 33 s, não "a cada 2 a 6 s".

## 2026-10-18 (fim da tarde) — R04 com histerese, R29 e o F-13 isolado
- **Histerese no "ocupado"** (`bac7075`): um app que passou da linha de CPU só volta a parado abaixo de 60 %
  dela (3 % no padrão). Chrome, Excel e PC Optimizer, que rondavam os 5 %, pararam de pular de grupo.
- **F-13, a parte que dá para testar sem o Chrome do Antônio** (`scripts/qa-chrome.ts`, Chrome com perfil
  temporário, duas rodadas com o mesmo resultado):
  - "Sair" do navegador: as 3 janelas voltaram;
  - WM_CLOSE do Folga em cada janela: só 1 voltou;
  - virou a **R29**: navegador Chromium com mais de uma janela fica "em uso", com o motivo "N janelas";
  - por isso ele não vem marcado e o Auto Care não o fecha;
  - a sonda agora manda `windowCount`;
  - Edge e os outros Chromium têm o mesmo efeito por inferência; o Firefox não foi testado.
- 15:34: servidor real reiniciado com a sonda nova. Ajustes intactos, com o Auto Care em 92 %. O Chrome do
  Antônio tem 1 janela agora.
- **"Abrir com o Windows" ligado** pela tela, a pedido do Antônio (2026-10-18, 15:47).
  - O atalho `Folga.lnk` está na pasta Inicializar real e roda `node.exe scripts\launch.mjs --no-window`,
    minimizado, com a pasta Mint como diretório de trabalho.
  - O F-08 agora só depende de reiniciar o Windows.
- **Bug corrigido antes de ligar:** desligar não apagava o atalho.
  - Causa: o `rmSync` em caminho com acento (`C:\Users\Antônio`) não apaga nada e não dá erro.
  - Correção: `unlinkSync` em `src/window.ts`.
  - O `http.test.ts` agora usa uma pasta Inicializar com acento. Antes da correção ele falhava.
- Os 8 prints chegaram ao WhatsApp do Antônio pelo script autorizado por ele.
  - A chave da Evolution foi lida só dentro do processo.
  - O WhatsApp confirmou o recebimento (SERVER_ACK).
- **Falta com o Antônio:**
  - F-13 com o Chrome dele: ver o motivo "N janelas" na tela Memória e testar um app de bandeja dele;
  - F-08: reiniciar o Windows e conferir que o Folga sobe sozinho.

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
- **Bug achado ao tirar os prints (corrigido):** um app parado, marcado sozinho, continuava marcado ao ficar
  ocupado, contra a R04.
  - Agora a seleção da tela Memória é o padrão (os parados) mais as marcas feitas à mão
    (`web/src/selection.ts`, teste `selection.test.ts`, 12 suítes verdes).
  - Visto ao vivo: com a primeira versão da correção, a marca caía quando o app ficava ocupado. Com a
    versão final, o Excel desmarcado à mão continuou desmarcado.
- **Observado:** perto da linha de 5 % de CPU da R04, Chrome, Excel e PC Optimizer trocaram de grupo 7 vezes
  em 33 s de observação. Foi o que motivou a histerese; depois dela, só o teste unitário prova a correção.

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
