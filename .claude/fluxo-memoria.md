# Fluxo — liberar memória [PLANEJADO]

## Jornada
1. Abro a janela. A tela **Memória** mostra "11,8 de 16 GB em uso · 74 %" e a linha "Auto Care começa em 92 %".
2. À direita, em grupos (R06):
   - **Parados** (laranja, marcados): "Figma · parado há 2 h · 1,6 GB".
   - **Em uso** (azul): "Chrome · em primeiro plano · 5,4 GB", "Code · ocupado · 18 % CPU".
   - **Sistema e protegidos** (cinza): "42 processos · 3,1 GB".
   - **Liberados** (verde), depois de liberar.
3. Desmarco o que não quero. Clico **Liberar** → o botão vira "Liberando…".
4. O servidor manda `WM_CLOSE`, espera 8 s e confere (R07). Mede o disponível 5 s depois (R08).
5. Aparece "✓ 2,1 GB liberados · 9,7 de 16 GB em uso". Por app: fechou / ficou aberto (talvez pedindo para salvar) / foi para a bandeja.
6. A linha entra no **Registro** (R14).

## Caminho no código
`probe.exe` → `src/probe.ts` (leitura) → `src/classify.ts` (grupos) → SSE → `web/src/Memory.tsx`
→ `POST /api/release` → `src/release.ts` → `ProbeCommand close` → espera, confere → `log.jsonl`.

## Casos de borda que o código precisa cobrir
- Primeira execução: ninguém tem histórico, então nada vem marcado (R03).
- Chrome com 3 janelas: `WM_CLOSE` vai para todas, não só para a principal.
- App pedindo "Salvar?": fica aberto. O resultado é `ficou_aberto` e não se tenta de novo.
- Teams/Discord/Spotify fecham para a bandeja: o resultado é `bandeja`, salvo se o app estiver em `mayForceQuit`.
- App protegido no pedido (a interface ficou velha): pedido recusado inteiro (R09).
- A sonda morreu: o servidor reinicia ela, e a interface mostra "lendo…" em vez de números velhos.
- Edge do dia a dia aberto: a janela do app usa um perfil próprio, e a árvore dela entra como `self`.
