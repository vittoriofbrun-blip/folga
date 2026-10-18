# 0003 — Liberar é fechar com WM_CLOSE; nunca encerrar à força por padrão

**Status:** aceito (2026-10-18)

## Contexto
O Mint fecha os apps "do jeito normal, para poderem salvar antes". No Windows não existe um "sair"
universal: `WM_CLOSE` fecha a janela, e o app decide o que fazer. Pode perguntar "salvar?" e ficar aberto,
ou ir para a bandeja e continuar vivo. Já `TerminateProcess` (`taskkill /F`) perde trabalho não salvo.

## Decisão
- Mandar `WM_CLOSE` para todas as janelas de topo visíveis do grupo.
- Conferir depois de 8 s: `fechou`, `ficou_aberto` ou `bandeja` (R07).
- Encerrar de vez (`kill`) só os apps que o usuário pôs em `mayForceQuit`, e só se o app já estava em `bandeja`.

## Consequências
- Liberar pode devolver menos memória do que o Mint devolveria no Mac. A tela diz por quê, app por app.
- Nenhum caminho do código apaga trabalho do usuário sem uma escolha explícita dele.
