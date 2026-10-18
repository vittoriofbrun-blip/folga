# 0001 — Servidor Node local e janela do Edge em modo app

**Status:** aceito (2026-10-18)

## Contexto
A arquitetura que já usamos (Play.me) é um servidor Node em 127.0.0.1 com uma SPA React/Vite. Não há
Electron nem Tauri em nenhum projeto da wiki. Um app que economiza memória não pode carregar um
Chromium inteiro empacotado só para ter janela.

## Decisão
- Um processo Node 24 (`node:http` + SSE) serve a SPA já compilada e a API.
- Do Play.me tiramos o Agent SDK, o MCP, o analisador e o SQLite: o app não tem IA nem dados relacionais.
- A janela é `msedge.exe --app=http://127.0.0.1:4780 --user-data-dir=%LOCALAPPDATA%\Folga\edge-profile`.
  O Edge vem com o Windows 11, e o perfil próprio separa os processos dessa janela dos do Edge do dia a dia.
- O Auto Care vive no servidor: fechar a janela não para o Auto Care.

## Consequências
- Nenhuma dependência nova de runtime além de React e Vite.
- Sem ícone na bandeja na v1. Para isso seria preciso um processo com WinForms, que pode ser a própria
  sonda; fica para quando você pedir.
- Variante mais leve, se o React pesar: a interface vanilla do Jarvis (`public/index.html|app.js`).
