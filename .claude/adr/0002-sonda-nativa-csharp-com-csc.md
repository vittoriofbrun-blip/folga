# 0002 — Sonda nativa em C#, compilada pelo csc.exe do Windows

**Status:** aceito, a confirmar no spike F-01 (2026-10-18)

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
