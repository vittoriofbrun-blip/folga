# Estado (mais recente no topo)

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
- Não verificado ao vivo, porque fecharia apps do Antônio:
  - Chrome com várias janelas. Hipótese a testar: `WM_CLOSE` fecha janela por janela, e a restauração de sessão
    do Chromium pode reabrir só a última fechada, enquanto "Sair" pelo menu guarda todas;
  - app que vai para a bandeja;
  - diálogo "Salvar?" (o Bloco de Notas do Win11 restaura abas e não pergunta);
  - Auto Care disparando de verdade (coberto por teste de unidade).
- Atenção:
  - `%LOCALAPPDATA%\Folga\settings.json` foi encontrado com `autoCareEnabled: true`, gravado por um PUT com token
    vindo da tela às 11:10:46, com a janela do Edge aberta. Ninguém confirmou quem ligou.
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
