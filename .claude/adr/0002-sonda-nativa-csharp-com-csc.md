# 0002 — Sonda nativa em C#, compilada pelo csc.exe do Windows

**Status:** aceito com emenda (2026-10-18). O spike F-01 mostrou que o antivírus apaga o `.exe` sem
assinatura. **Padrão desde então:** o mesmo `probe.cs`, compilado em memória pelo `Add-Type` do
`powershell.exe -NoProfile` (sonda medida em 32 a 35 MB; Node + sonda em 61 a 67 MB, dentro do R18).
O `.exe` só roda com `FOLGA_PROBE_EXE=1`, se um dia `probe\bin\` for excluído do antivírus ou o exe for
assinado. Essa decisão é do dono; o código não mexe em segurança.

Filtros de janela acrescentados depois do spike: janela *cloaked* pelo DWM e janela de ferramenta
(`WS_EX_TOOLWINDOW` sem `WS_EX_APPWINDOW`) não contam. Sem eles, `mc-web-view` (McAfee) e `cua-driver`
apareciam como apps com janela.

## Contexto
O Node não lê janelas, primeiro plano nem working set privado sem FFI. Rodar `powershell -Command` a cada
2 s custa 300 ms a 1 s por chamada. Um PowerShell vivo com `Add-Type` resolve, mas ocupa ~70 MB, o que
estoura o orçamento R18 de um app que economiza memória.

## Decisão
- Um arquivo, `probe/probe.cs`, com P/Invoke para:
  - `GlobalMemoryStatusEx`;
  - `EnumWindows`/`IsWindowVisible`/`GetWindow(GW_OWNER)`, `GetForegroundWindow`/`GetWindowThreadProcessId`;
  - `GetProcessMemoryInfo` com `PROCESS_MEMORY_COUNTERS_EX2.PrivateWorkingSetSize`, ou o contador
    `Process\Working Set - Private` se a struct falhar;
  - `GetProcessTimes`, `ProcessIdToSessionId`, `PostMessage(WM_CLOSE)`.
- Compilado por `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (vem no Windows) via
  `node scripts/build-probe.mjs`.
- Protocolo: uma linha JSON por mensagem, nos dois sentidos (contrato em `fluxo-infraestrutura.md`).

## Limite do compilador (conferido em 2026-10-18)
O `csc.exe` do Framework é o "Visual C# Compiler version 4.8.9221.0 for C# 5" (`/langversion` aceita até 5).
Portanto, sem:
- interpolação `$"…"`, `?.`, membros com `=>`, tuplas e `nameof`;
- `System.Text.Json`, que não existe no .NET Framework.

O JSON é escrito à mão, com escape de `"` `\` e caracteres de controle, ou via `JavaScriptSerializer` com
`/r:System.Web.Extensions.dll` no `build-probe.mjs`.

## Consequências
- Nenhuma dependência nova. Pegada esperada de 10 a 20 MB (medir no F-01).
- **Plano B:** se o `csc.exe` não estiver presente ou a struct não funcionar, o mesmo código C# roda em
  `powershell -NoProfile` com `Add-Type`, ao custo de ~70 MB.

## Medição (F-01, 2026-10-18)

**Bloqueio: o antivírus apaga o `probe.exe`.** O `build-probe.mjs` compila (exit 0, `probe/bin/probe.exe`, 13,8 KB),
mas ao executar o `.exe` pela primeira vez ele é bloqueado (`spawn UNKNOWN` no Node, `Permission denied` no Git Bash,
`Unknown error 0xfffffffe` no PowerShell) e o arquivo some. Reproduzido com um "hello world" de uma linha compilado
pelo mesmo `csc.exe`, então não é um comportamento da sonda; é qualquer `.exe` novo e sem assinatura. Cópia de um
binário assinado do sistema (`whoami.exe`) roda normal. Antivírus na máquina: McAfee ativo e Defender em modo passivo (o culpado é provavelmente o McAfee; não confirmado em log).
Ninguém mexeu em exclusões de segurança. **Decisão pendente do dono:** (a) excluir `probe\bin\` no McAfee,
(b) assinar o `.exe`, ou (c) adotar o Plano B (abaixo). Até lá o ticket F-01 não está verificado de ponta a ponta com o `.exe`.

**Lógica verificada pelo Plano B** (mesmo `probe.cs`, `Add-Type -Path probe/probe.cs; [Probe]::Main(...)` dentro de
`powershell -NoProfile`; a classe é `public` por isso). O `Add-Type` não foi bloqueado. Números nesta máquina
(15,7 GB, 719 processos, 557 acessíveis, memLoad 89 %):

| Item | Resultado |
| --- | --- |
| Tempo da 1ª leitura | 620 a 820 ms (JIT + `FileVersionInfo` de 557 exes; só uma vez) |
| Tempo das leituras seguintes | 34 a 113 ms (típico 35 a 55 ms) |
| Nº de processos por leitura | 719 (557 abertos com `PROCESS_QUERY_LIMITED_INFORMATION`) |
| Pegada (privateWorkingSet) | 31 a 32 MB **do host PowerShell inteiro**, sobe ~0,5 MB por leitura nas 3 primeiras. Alvo de 20 MB só vale para o `.exe`, que não pôde ser medido. |
| `PROCESS_MEMORY_COUNTERS_EX2` | funcionou; não precisou do Plano B de contador |

**Comparação com o contador do Windows** (`Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate`, o mesmo
contador `Process\Working Set - Private`, mas independente do idioma; `Get-Counter` usa nomes em português aqui):
soma por nome, grupos estáveis: claude +0,5 %, chatgpt -0,1 %, antigravity ide +0,5 %, chrome 0,0 %, node 0,0 %,
excel 0,0 %. Por pid, 44 de 51 processos acima de 20 MB ficam em ±10 % e 41 em ±2 %; os que divergem são os que estão
mudando de tamanho entre a leitura da sonda e a do contador (não são erro de método).

**WM_CLOSE:** Notepad novo aberto pelo teste; `close` devolveu `ok:true, windowsClosed:1` e o processo sumiu. `kill` num
`ping -t` descartável também funcionou. Linhas inválidas sem `id` são ignoradas; com `id` e sem `pids` devolvem `ok:false`.

**Para o Node saber:** o Notepad do Win11 aparece como `Notepad.exe` (o pid dono da janela, sessão 2), com
`description` = `"Notepad.exe"` (o `FileDescription` dele é o próprio nome do arquivo). `TextInputHost.exe`,
`ApplicationFrameHost.exe` e `mc-web-view.exe` aparecem com `hasVisibleWindow:true` (janelas "fantasma" cloaked do shell
e do antivírus); os dois primeiros já estão em `SYSTEM_PROCESSES`.

**Áudio (F-11):** a sonda lista os PIDs com sessão de áudio *Active* no dispositivo de saída padrão (Core Audio, IAudioSessionManager2). Custa de 5 a 9 ms por leitura (107 ms na primeira, por causa do JIT e do COM). Teste real: um player tocando apareceu em udioPids nas 6 leituras e saiu quando o som parou. Limites: só o dispositivo padrão; sessão aberta em silêncio conta como áudio (erra para o lado seguro).
