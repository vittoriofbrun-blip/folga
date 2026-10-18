# 0005 — Estado em settings.json e log.jsonl, sem SQLite

**Status:** aceito (2026-10-18)

## Contexto
O Play.me usa `node:sqlite` porque tem sets, faixas e relações. Este app guarda poucas coisas:
os ajustes (um objeto) e o registro (uma linha por liberação).

## Decisão
`%LOCALAPPDATA%\Folga\settings.json`, gravado inteiro e de forma atômica (escreve `.tmp` e faz `rename`),
e `log.jsonl` só com append.

## Consequências
- Ler o registro é ler o fim do arquivo. Teto conhecido: a partir de ~10 mil linhas, ler tudo fica lento.
  Rotacionar o arquivo quando chegar lá.
- Trocar por `node:sqlite` só se aparecer consulta por filtro.
