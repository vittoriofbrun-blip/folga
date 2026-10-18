# Requisitos — as regras do app

Cada regra tem um número. Ticket, teste ou revisão cita a regra pelo número. Origem: `docs/engenharia-reversa-mint.md`.

## Memória
- **R01 Memória usada** — A porcentagem, o total e o disponível vêm de `GlobalMemoryStatusEx`
  (`dwMemoryLoad`, `ullTotalPhys`, `ullAvailPhys`), os mesmos números do Gerenciador de Tarefas.
- **R02 Tamanho do app** — Os processos são agrupados pelo nome do executável, sem diferenciar
  maiúsculas. O tamanho do grupo é a **soma do working set privado** de cada processo, não `WorkingSet64`,
  que conta páginas compartilhadas e infla a soma. Nome de exibição: `FileDescription` do executável,
  ou o nome do arquivo se não houver.
- **R03 Parado** — Um app fica parado quando nenhuma janela dele está em primeiro plano há `idleMinutes`
  (padrão 30, ajustável) **e** ele não está ocupado (R04). A contagem começa quando o app sobe:
  **na primeira execução nada vem marcado** até passar `idleMinutes`.
- **R04 Ocupado** — CPU do grupo ≥ `busyCpuPercent` (padrão 5 % de um núcleo, ajustável) na média dos
  últimos 30 s. App ocupado nunca vem marcado e nunca é fechado pelo Auto Care.
- **R05 Protegido** — Só é candidato o processo da **sessão do usuário** que tem **janela de topo visível**.
  Ficam sempre em "Sistema e protegidos":
  - tudo sem janela visível, da sessão 0, ou que o token do usuário não consegue abrir;
  - `explorer`, `dwm`, `csrss`, `winlogon`, `ShellExperienceHost`, `StartMenuExperienceHost`,
    `SearchHost`, `TextInputHost`, `ApplicationFrameHost`, `LockApp`;
  - a árvore de processos do próprio app (Node, sonda e a janela do Edge com perfil próprio);
  - a lista **"nunca fechar"** do usuário. O padrão traz terminais e editores, porque fechar um deles mata
    agentes e servidores rodando dentro: `WindowsTerminal`, `cmd`, `powershell`, `pwsh`, `Code`, `Cursor`.
- **R06 Grupos** — Na tela: Parados (marcados), Em uso (primeiro plano agora, ocupado ou usado há menos
  de `idleMinutes`), Sistema e protegidos (só o total e a contagem), Liberados (fechados nesta sessão).

## Liberar
- **R07 Fechar do jeito normal** — Liberar manda `WM_CLOSE` para **todas** as janelas de topo visíveis
  dos processos do grupo. Nunca usa `TerminateProcess`/`taskkill /F` por padrão: o app tem que poder
  perguntar "salvar?". Depois de 8 s confere cada app e devolve um destes resultados:
  - `fechou`: nenhum processo do grupo segue vivo;
  - `ficou aberto`: a janela segue visível, provavelmente pedindo para salvar. Não insiste.
  - `foi para a bandeja`: o processo segue vivo sem janela visível. Só encerra de vez se o app estiver na
    lista "pode encerrar de vez" que o usuário marcou (P03).
- **R08 Quanto voltou** — "Liberados X GB" = `ullAvailPhys` depois − antes, medido 5 s depois do último
  fechamento. Nunca a soma do tamanho dos apps.
- **R09 Só o que foi marcado** — A liberação fecha só os grupos enviados no pedido, e só se eles ainda
  forem candidatos (R05) no momento do fechamento. Um pedido com app protegido é recusado inteiro.

## Auto Care de memória
- **R10 Gatilho** — Ligado em Ajustes. Dispara quando `dwMemoryLoad ≥ autoCareThreshold` (padrão 92 %)
  em **duas leituras seguidas**.
- **R11 O que fecha** — Só os apps parados (R03), nunca os ocupados nem os protegidos. Usa o mesmo
  caminho da liberação manual (R07, R08).
- **R12 Freio** — Depois de rodar, espera `autoCareCooldownMinutes` (padrão 10) antes de poder rodar de novo.
- **R13 Vida** — Roda enquanto o servidor do app estiver vivo, com ou sem a janela aberta.

## Registro
- **R14** — Toda liberação grava uma linha em `log.jsonl`: data, origem (`manual`/`auto`), memória antes e
  depois, e por app o resultado de R07. A tela Registro mostra as mais recentes primeiro.

## Segurança local (padrão D33 do Play.me)
- **R15** — O servidor só escuta em `127.0.0.1` e só aceita `Host` 127.0.0.1/localhost.
- **R16** — Todo POST/PUT exige `Content-Type: application/json` (415 se não) e o cabeçalho `X-Folga-Token`
  com o conteúdo de `%LOCALAPPDATA%\Folga\ui-token` (32 bytes hex, criado na primeira execução). Sem ele, 403.
  Assim um site aberto no navegador não consegue fechar seus apps.
- **R17** — Mensagens de erro para a interface não trazem caminho, pilha nem detalhe interno.

## Pegada (requisito não funcional)
- **R18 Orçamento** — Em segundo plano, Node + sonda somam **até 120 MB** de working set privado e menos
  de 1 % de CPU na média. A janela do Edge só existe enquanto está aberta. O ticket F-09 mede.
- **R19 Leitura** — A sonda lê a cada 2 s. Ajustável; não descer abaixo de 1 s.
