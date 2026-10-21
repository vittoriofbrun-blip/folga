# 0007 — Folga.app no Mac: app de barra com janela WebKit e o servidor dentro do bundle

**Status:** aceito (2026-10-21). Plano 3; decisões 5, 10 e 16 do spec do Mac.

## Contexto
No Windows a janela é o Edge em modo app (ADR 0001). No Mac o Vittorio quer um ícone na barra de menus e a
mesma interface React, sem pagar um Chromium (decisão 5), e quer o Acesso Total ao Disco só para o `Folga.app`,
nunca para o `node` solto (decisão 10).

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
  sela o código que de fato roda. O Acesso Total ao Disco dado ao app vale para o `node` e a sonda que ele
  sobe (o app é o processo responsável) e para nenhum `node` de fora.
- **Por que o `node` vai dentro:** o app é o processo responsável no TCC. Se ele subisse o `node` do `~/.nvm`
  (gravável pelo usuário, fora do selo), qualquer programa rodando como o Vittorio poderia trocar esse arquivo e
  ganhar o Acesso Total ao Disco do Folga — exatamente o que a decisão 10 proíbe. Dentro do bundle, trocar o
  `node` quebra o selo do app. O `PATH` do filho também não tem nenhuma pasta do usuário.
- **Hardened runtime em tudo** (app, sonda, `node`): sem ele, `DYLD_INSERT_LIBRARIES` ou um depurador entrariam
  num processo que carrega a permissão. O `node` é reassinado só com `allow-jit` e
  `allow-unsigned-executable-memory` (o V8 precisa); os direitos originais da Node.js Foundation incluem
  `get-task-allow`, `allow-dyld-environment-variables` e `disable-library-validation`, que reabririam essa porta.
  O `check` confere os três.
- **Custo:** o app passa de ~1 MB para ~116 MB em disco (o `node` tem ~115 MB). Memória não muda: é o mesmo
  `node` que já rodava. Atualizar o Node pede reinstalar o Folga (rebuild copia o novo).
- **Conferência:** `scripts/mac-app.mjs check <app> [--previous <arquivo>]` valida o `Info.plist`, `--version`,
  `--selftest`, as assinaturas do bundle e da sonda de dentro, e recusa requisito designado fraco
  (`requirementWeak`): requisito só com `identifier "local.folga.app"` manteria a permissão entre builds, mas
  qualquer binário ad-hoc com esse id herdaria o Acesso Total ao Disco. Com `--previous`, roda a mesma conta
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
  **depois de cada reinstalação o Vittorio liga o Folga de novo no Acesso Total ao Disco** (Ajustes do Sistema →
  Privacidade e Segurança → Acesso Total ao Disco).
- **Limite que fica:** a página continua pegando o token por `GET /api/token` (mesma origem, como hoje); quem
  já roda como o Vittorio na máquina consegue falar com o servidor local. O Acesso Total ao Disco não aumenta isso:
  as ferramentas expostas pela API são as mesmas, revalidadas pelo servidor.
- **Limite honesto:** o ad-hoc não dá para imitar (o requisito é o hash do próprio app), mas também não prova
  autoria. Se um dia o ramo A voltar (por exemplo, o Vittorio dando confiança ao certificado ele mesmo), o limite
  dele é: um programa já rodando como você consegue assinar com essa chave, como aconteceria com um certificado
  pago guardado no mesmo Mac.

### Acesso Total ao Disco: pedido pelo menu (Task 5)
- O menu do ícone mostra "Liberar acesso ao disco…" só enquanto o app não lê a `~/.Trash` (EPERM/EACCES);
  é reavaliado toda vez que o menu abre. O clique explica em linguagem simples e "Abrir Ajustes" abre o painel.
  Quem constrói nunca liga a chave: é passo do Vittorio.
- **Spike do link (2026-10-21, macOS 26.5.1):** `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles`
  e `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles` abriram os Ajustes (`open` rc=0) nos
  dois casos. Não deu para ver qual painel ficou na tela (sem permissão de gravar a tela nem de acessibilidade
  para quem constrói); fica o primeiro, o formato novo. **Pendente:** o controlador confere com o Vittorio se cai
  direto na lista e se o Folga já aparece nela sozinho ou precisa do +.
- A nota das telas (`fdaNote`) só ensina o caminho dos Ajustes quando o servidor roda dentro do app (`FOLGA_APP=1`);
  fora dele, manda abrir pelo app Folga. O pino em `files.test.ts` varre `src`, `web/src`, `scripts`, `probe` e `mac`.

### O assistente fica fora do acesso ao disco (Task 6)
- O servidor (o `node` filho do app) **continua** responsável pelo Folga.app: é ele que mede a Lixeira e o
  Safari. Só os CLIs do assistente (claude/codex) lançados por `agent.ts` rodam por `probe-mac --disclaim`, que
  os torna responsáveis por si mesmos. Fora do app (ou no Windows) o `Launch` não muda.
- **Spike (2026-10-21, macOS 26.5.1):** `responsibility_spawnattrs_setdisclaim` + `posix_spawnp` com
  `POSIX_SPAWN_SETEXEC` corta a responsabilidade: `--disclaim probe-mac --responsible` devolve
  `responsible == pid`, com o mesmo pid lançado pelo Node (o `kill` do turno acerta no CLI) e o código de saída
  repassado (`/usr/bin/false` → 1). O plano B (spawn + `waitpid` + repasse de sinais) não foi preciso.
- **Fail closed:** sem o símbolo privado, `--disclaim` sai 126 sem executar; o chat mostra "O assistente não roda
  dentro do app Folga neste macOS…" em vez de rodar o CLI com o acesso do app. Comando inexistente sai 127.
- **O que um chamador local consegue com `--disclaim`:** nada que já não tivesse. O modo só **retira** a herança
  de responsabilidade: o programa executado responde pelas próprias permissões do TCC, nunca pelas do Folga.app.
  Quem roda `probe-mac` de fora do app já é o responsável por ele; com `--disclaim`, o alvo passa a ser responsável
  por si — de novo sem nenhuma permissão do Folga. Não é um "rodar qualquer coisa com o acesso do app".
- **Log de início (R32), só dentro do app:** `responsável <executável do --responsible> · acesso ao disco:
  servidor sim|não · assistente não|SIM` (lê a Lixeira direto e via `--disclaim`; nenhum caminho do usuário).
  "assistente SIM" é bug. Antes de o Vittorio liberar: `servidor não · assistente não` (visto ao vivo em 21/10).
  **Pendente (controlador):** depois de liberar, o esperado é `servidor sim · assistente não`.

## Consequências
- A CI do macOS monta o app ad-hoc e roda o `check` (sem segredo).
- O `node` gravado no `folga.json` é o do build; trocar de Node pede rebuild.
- As Tasks 5, 6 e 8 do plano 3 completam este ADR (Acesso Total ao Disco, assistente fora dele, avisos).
