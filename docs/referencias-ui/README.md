# Referências de interface (Mint para Mac, capturadas em 2026-10-18)

Capturas das imagens públicas de https://mintstorage.app/, só para referência de layout. **Não copiar
a marca** (nome, logo, imagem da Terra, verde-limão).

| Arquivo | Tela | O que levar para o nosso app |
|---|---|---|
| `01-memoria.jpg` | Free up memory | **A tela principal da v1.** Barra lateral, título com a linha "Auto Care starts at 92%", barra de memória usada à esquerda, grupos Idle/In use/System & protected/Freed à direita, botão em pílula embaixo à direita. |
| `03-auto-care.jpg` | Auto Care | Cartão com uma linha por rotina e um interruptor. Na v1 só a linha "Memória · Em 92 %". |
| `07-status-raycast.jpg` | Painel compacto | Anel de "livre" com "Em uso / Livre": serve de cabeçalho da tela Memória. |
| `02-disco.jpg` | Free up disk space | Fora do escopo; o padrão de grupos com barra colorida à direita é o mesmo. |
| `04-buckets-limpeza.jpg` | Optimizable / Safe to clean / Yours | Fora do escopo; mostra o tom das listas com caixa de seleção. |
| `05-organizar.jpg` | Organize | Fora do escopo. |
| `06-agentes.jpg` | Cartões de apps | Fora do escopo; referência de selos pequenos ("SAFE TO CLEAN"). |
| `00-home.jpg` | Página inicial | Só o clima geral. |

## Tokens observados no site do Mint (referência, não usar a cor de destaque)
`--bg #080b08` · `--cell #0e130f` · `--line #2c322d` · `--fg #edebe5` · `--muted #979d97` ·
`--accent #bdfe3a` · `--danger #ffb4a9` · DM Sans (título 64 px/700/−1,92 px) · Geist Mono · pílula 999 px.

## Paleta provisória do nosso app (decisão em F-10, P02)
```css
:root {
  --bg: #0a0c10; --cell: #11151b; --line: #262c35;
  --fg: #eceae4; --muted: #979ca6;
  --accent: #5eead4;   /* destaque e "Liberados" */
  --idle: #f5a524;     /* Parados */
  --in-use: #6aa8ff;   /* Em uso */
  --system: #6b7280;   /* Sistema e protegidos */
  --danger: #ff9b8f;
  --sans: "Geist", "Segoe UI Variable", system-ui, sans-serif;
  --mono: "Geist Mono", ui-monospace, Consolas, monospace;
  --radius-pill: 999px;
}
```
