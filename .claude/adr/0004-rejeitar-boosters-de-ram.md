# 0004 — Sem "boosters" de RAM (EmptyWorkingSet, lista standby)

**Status:** aceito (2026-10-18)

## Contexto
Os "otimizadores de RAM" do Windows chamam `EmptyWorkingSet`/`SetProcessWorkingSetSize(-1,-1)` em todos os
processos, ou esvaziam a lista standby com `NtSetSystemInformation`. O número "livre" sobe na hora.

## Decisão
Não fazer nenhum dos dois.

## Por quê
- `EmptyWorkingSet` só empurra as páginas para a lista modificada ou para o arquivo de paginação. Quando
  o app volta a usar essas páginas, elas são lidas de novo, com page faults e disco. A lentidão aparece depois.
- A lista standby é cache. Esvaziar joga fora cache útil, e a operação exige administrador.
- O único jeito honesto de devolver memória é o processo deixar de existir, e é isso que o Mint faz.

## Consequências
O app não promete números mágicos. "Liberados X GB" mede o disponível de verdade (R08).
