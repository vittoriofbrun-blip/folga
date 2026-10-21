# 0007 — Folga.app no Mac: app de barra com janela WebKit e o servidor dentro do bundle

**Status:** aceito (2026-10-21). Plano 3; decisões 5, 10, 16 e 17 do spec do Mac. A decisão 17 (o Folga não pede
Acesso Total ao Disco) vale por cima de tudo o que este ADR diz sobre pedir a permissão.

## Contexto
No Windows a janela é o Edge em modo app (ADR 0001). No Mac o Vittorio quer um ícone na barra de menus e a
mesma interface React, sem pagar um Chromium (decisão 5). A ideia inicial era pedir o Acesso Total ao Disco só para
o `Folga.app`, nunca para o `node` solto (decisão 10); depois da revisão de segurança o Folga não pede a permissão
de jeito nenhum (decisão 17, seção abaixo).

## Decisão
- **Janela WebKit, não Edge/Chrome.** O `WKWebView` usa o motor do Safari, que já está no Mac. Um Chrome
  ou Edge em modo app abriria um navegador inteiro (vários processos, centenas de MB) num Mac que muitas vezes
  já está em swap, e o Edge nem vem instalado no Mac.
- **Um binário Swift (`mac/Folga.swift`), sem Xcode.** `scripts/mac-app.mjs build` compila com `swiftc -O` e
  monta o `.app`: `Info.plist` gerado pelo script (`local.folga.app`, `LSUIElement`, rede local liberada no ATS),
  `Contents/MacOS/Folga` e `Contents/Resources/folga.json` (`{ node, path }`, caminhos relativos a
  `Contents/Resources`: `node` = `folga/bin/node`, `path` = `folga/bin:/usr/bin:/bin:/usr/sbin:/sbin`; o app
  resolve as entradas sem `/` na frente, então mover o `.app` de `build/` para `~/Applications` não quebra nada).
- **O servidor vai copiado no bundle** (`Contents/Resources/folga/`: `src/`, `dist/`, `probe/bin/probe-mac`,
  `package.json`) **junto com o próprio `node`** (`folga/bin/node`, cópia do Node ≥ 24 de quem rodou o build). Assim o app não depende do repositório, que outra sessão pode estar mexendo, e a assinatura
  sela o código que de fato roda. O app é o processo responsável (TCC) pelo `node` e pela sonda que ele sobe.
- **Por que o `node` vai dentro:** o app é o processo responsável no TCC. Se ele subisse o `node` do `~/.nvm`
  (gravável pelo usuário, fora do selo), qualquer programa rodando como o Vittorio poderia trocar esse arquivo e
  herdar as permissões que o macOS desse ao Folga. Dentro do bundle, trocar o `node` quebra o selo do app (mas veja
  a decisão 17: o selo dos recursos não é conferido ao executar). O `PATH` do filho também não tem nenhuma pasta do
  usuário. Com a decisão 17 isto vira defesa em profundidade, não a barreira principal.
- **Hardened runtime em tudo** (app, sonda, `node`): sem ele, `DYLD_INSERT_LIBRARIES` ou um depurador entrariam
  num processo que carrega a permissão. O `node` é reassinado só com `allow-jit` e
  `allow-unsigned-executable-memory` (o V8 precisa); os direitos originais da Node.js Foundation incluem
  `get-task-allow`, `allow-dyld-environment-variables` e `disable-library-validation`, que reabririam essa porta.
  O `check` confere os três.
- **Custo:** o app passa de ~1 MB para ~116 MB em disco (o `node` tem ~115 MB). Memória não muda: é o mesmo
  `node` que já rodava. Atualizar o Node pede reinstalar o Folga (rebuild copia o novo).
- **Conferência:** `scripts/mac-app.mjs check <app> [--previous <arquivo>]` valida o `Info.plist`, `--version`,
  `--selftest`, as assinaturas do bundle e da sonda de dentro, e recusa requisito designado fraco
  (`requirementWeak`): requisito só com `identifier "local.folga.app"` manteria as permissões entre builds, mas
  qualquer binário ad-hoc com esse id as herdaria. Com `--previous`, roda a mesma conta
  que o TCC faz depois de reinstalar (`codesign --verify -R=<requisito do build anterior>`).

### Assinatura: ramo B (ad-hoc)
Spike de 2026-10-21 (macOS 26.5.1, LibreSSL 3.3.6 do sistema):
- **Ramo A tentado e descartado.** Certificado "Folga Local" autoassinado (`openssl req -x509` com
  `extendedKeyUsage=codeSigning`, 10 anos) num chaveiro só dele, fora da lista de busca, importado com
  `-T /usr/bin/codesign` e `set-key-partition-list`. O `security find-identity` acha a identidade, mas marcada
  `CSSMERR_TP_NOT_TRUSTED` (0 válidas), e o `codesign --keychain <chaveiro> -s "Folga Local"` (e pelo hash
  SHA-1) responde "no identity found". Para torná-la válida seria preciso gravar confiança no certificado
  (`security add-trusted-cert`), o que abre a janela de senha do macOS, ou pôr o chaveiro na lista de busca do
  usuário; as duas coisas ficam fora do que quem constrói pode fazer. O chaveiro de teste foi apagado.
- **Ramo B em uso:** ad-hoc puro. O requisito designado é `cdhash H"…"`, preso ao conteúdo exato do app.
  `--adhoc` é aceito (a CI passa) e dá no mesmo.
- **"Sobrevive ao rebuild" só vale para rebuild idêntico** (o assunto do commit da Task 1 diz mais do que isso).
- **Consequência:** um build idêntico (mesmos arquivos) dá o mesmo `cdhash` e o `check --previous` fica verde;
  qualquer mudança no app ou no servidor copiado muda o `cdhash`, o `check --previous` fica vermelho e
  as permissões que o macOS guarda pelo requisito (notificações, item de segundo plano) podem ser pedidas de novo
  depois de reinstalar. Acesso Total ao Disco não entra nisso: o Folga não o pede (decisão 17).
- **Limite que fica:** a página continua pegando o token por `GET /api/token` (mesma origem, como hoje); quem
  já roda como o Vittorio na máquina consegue falar com o servidor local. Sem Acesso Total ao Disco (decisão 17),
  esse resíduo é o mesmo do Windows: pela API o chamador consegue o que o próprio usuário já consegue, revalidado
  pelo servidor, e nada além.
- **Limite honesto:** o ad-hoc não dá para imitar (o requisito é o hash do próprio app), mas também não prova
  autoria. Se um dia o ramo A voltar (por exemplo, o Vittorio dando confiança ao certificado ele mesmo), o limite
  dele é: um programa já rodando como você consegue assinar com essa chave, como aconteceria com um certificado
  pago guardado no mesmo Mac.

### Acesso Total ao Disco: não pedido (decisão 17, 2026-10-21)
A Task 5 pôs no menu "Liberar acesso ao disco…" com um link para o painel dos Ajustes. A revisão de segurança da
Task 11 achou dois problemas que só existem **porque** o app teria a permissão:
- **C1 — cópia adulterada herda a permissão.** O servidor é JavaScript dentro de `Contents/Resources`, e o macOS
  não confere o selo dos recursos ao executar. Uma cópia do `Folga.app` com o `server.ts` trocado continua sendo
  aceita pelo TCC como o Folga e roda o código novo com Acesso Total ao Disco.
- **I4 — qualquer processo local usaria a permissão pela API.** `GET /api/token` responde a quem rodar como o
  Vittorio; com o token, as ferramentas da API (varredura, tamanho, Lixeira) rodariam com o acesso do app.

Decisão: o Folga **não pede** Acesso Total ao Disco. Saíram o item do menu, o alerta e o link; `fdaNote()` é uma nota
só, sem caminho nos Ajustes ("Não deu para ler: o macOS protege esta pasta e o Folga não pede essa permissão."). O
pino em `files.test.ts` exige que nenhum fonte em `src`, `web/src`, `scripts`, `probe` e `mac` tenha
`Privacy_AllFiles` nem "Ajustes do Sistema › Privacidade", e continua barrando texto que junte a permissão com
`node`/Terminal.
- **O que se perde:** o tamanho da Lixeira, o tamanho do cache do Safari e a busca no iCloud Drive (a pasta saiu
  da lista do Mac em `userFolders`, para não gerar pedido de pasta à toa) aparecem como "não deu para ler"
  (desconhecido, nunca 0).
- **Pedidos de pasta que sobram (a medir ao vivo):** a busca de Arquivos varre Downloads, Desktop, Documents,
  Pictures, Movies e Music, e o macOS pede acesso a cada uma, atribuído ao Folga.app. Com assinatura ad-hoc o macOS
  pode perguntar de novo depois de reinstalar. Se isso incomodar, volta a opção de assinatura A (por isso o
  `check --previous` continua).
- **Rede de segurança:** se a permissão estiver ligada mesmo assim (o Vittorio ligou à mão, ou sobrou de um teste),
  o menu mostra "O Folga está com Acesso Total ao Disco — desligue em Ajustes (não é necessário)", só texto, sem
  link; e a linha R32 do `server.log` diz o mesmo depois de `servidor sim`. A checagem é abrir a `~/.Trash`: só
  abrir de verdade conta (pasta negada ou inexistente → sem aviso).
- **O `--disclaim` fica** (Task 6), como defesa em profundidade: se a permissão aparecer ligada, o assistente
  continua sem herdá-la.
- **Resíduo do `GET /api/token`:** igual ao do Windows — sem a permissão, o servidor só faz o que o próprio usuário
  já faz.

### O assistente fica fora do acesso ao disco (Task 6)
- Defesa em profundidade desde a decisão 17 (o Folga não pede a permissão). O servidor (o `node` filho do app)
  **continua** responsável pelo Folga.app. Só os CLIs do assistente (claude/codex) lançados por `agent.ts` rodam por `probe-mac --disclaim`, que
  os torna responsáveis por si mesmos. Fora do app (ou no Windows) o `Launch` não muda.
- **Spike (2026-10-21, macOS 26.5.1):** `responsibility_spawnattrs_setdisclaim` + `posix_spawnp` com
  `POSIX_SPAWN_SETEXEC` corta a responsabilidade: `--disclaim probe-mac --responsible` devolve
  `responsible == pid`, com o mesmo pid lançado pelo Node (o `kill` do turno acerta no CLI) e o código de saída
  repassado (`/usr/bin/false` → 1). O plano B (spawn + `waitpid` + repasse de sinais) não foi preciso.
- **Fail closed:** sem o símbolo privado (ou sem comando), `--disclaim` sai **125** sem executar; o chat mostra "O
  assistente não roda dentro do app Folga neste macOS…" em vez de rodar o CLI com o acesso do app. O mesmo texto
  fixo aparece se o `probe-mac` faltar no bundle (nunca o ENOENT cru). Comando inexistente sai 127. O 125 é só
  do disclaim: um 126 devolvido pelo próprio CLI continua a mensagem comum.
- **O que um chamador local consegue com `--disclaim`:** nada que já não tivesse. O modo só **retira** a herança
  de responsabilidade: o programa executado responde pelas próprias permissões do TCC, nunca pelas do Folga.app.
  Quem roda `probe-mac` de fora do app já é o responsável por ele; com `--disclaim`, o alvo passa a ser responsável
  por si — de novo sem nenhuma permissão do Folga. Não é um "rodar qualquer coisa com o acesso do app".
- **Log de início (R32), só dentro do app:** `responsável <executável do --responsible> · acesso ao disco:
  servidor sim|não · assistente não|SIM` (lê a Lixeira direto e via `--disclaim`; nenhum caminho do usuário).
  "assistente SIM" é bug. Esperado (decisão 17): `servidor não · assistente não` (visto ao vivo em 21/10).
  `servidor sim` vem com o aviso para desligar.

### Avisos do Mac (Task 8)
- Dentro do app, o servidor roda `Folga --notify` (UNUserNotificationCenter): processo curto, não sobe a instância
  nem a janela, nunca toca o supervisor. Título e corpo vão só pelo ambiente (`FOLGA_TOAST_TITLE/BODY`), nunca em
  argumento. Saídas: 0 postado · 3 sem resposta em 10 s · 4 recusado · 5 erro. Clique no aviso → a instância
  principal (delegate) abre a janela.
- Qualquer saída ≠ 0 faz o aviso daquela vez sair pelo `osascript` (script fixo que lê `system attribute`; testado
  ao vivo com título `"; do shell script …`: nada executou). Saída 4 (recusado), 126, 127 ou falha de spawn
  ENOENT/EACCES trava o app como quebrado para sempre; as outras (3 sem resposta, 5 erro, outras falhas) só
  recuam 10 minutos e o app é tentado de novo. Fora do app, o `osascript` direto; clicar no aviso do `osascript`
  abre o Editor de Scripts, não o Folga (limite do reserva). Windows continua no PowerShell.
- **Ao vivo (21/10, build ad-hoc em build/):** `--notify` saiu **3** (sem resposta em 10 s): autorização do
  macOS pendente/sem resposta; ninguém clicou. **Pendente (controlador):** o Vittorio responder o pedido de
  autorização do Folga em Ajustes > Notificações e repetir; se continuar 3 ou 4 com app ad-hoc, o `osascript`
  (já ligado como reserva) é o caminho definitivo.

- Um `--notify` só é lançado pelo servidor, que só roda com a instância principal viva; por isso ele nunca
  pode barrar um lançamento necessário e a checagem de instância única não o distingue.

## Consequências
- A CI do macOS monta o app ad-hoc e roda o `check` (sem segredo).
- O `node` gravado no `folga.json` é o do build; trocar de Node pede rebuild.
- As Tasks 5, 6 e 8 do plano 3 completam este ADR (Acesso Total ao Disco — desfeito pela decisão 17 —, assistente
  fora dele, avisos).
