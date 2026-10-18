# Engenharia reversa do Mint (mintstorage.app) — foco em memória

Data: 2026-10-18. Alvo: site público https://mintstorage.app/ (DZG Studio LLC).

**Limite da análise.** O Mint é só para macOS 14 ou mais novo, então não existe binário de Windows para
decompilar e o binário de Mac não foi baixado. Tudo aqui vem da observação do site: página inicial,
guias `guides/memory`, `guides/auto-care`, as 8 imagens de interface em `docs/referencias-ui/` e as
variáveis CSS lidas no navegador. Cada linha diz se é **O** (observado), **I** (inferido) ou **U**
(desconhecido).

## 1. O produto em uma frase
O (home): "Smart Storage. For you and your agents." É um app de Mac com seis frentes: limpeza de disco,
otimização de arquivos sem apagar, organizador de pastas, **liberar memória**, Auto Care agendado e
ferramentas para agentes (CLI + MCP). Gratuito com limite de 1 GB por semana para limpar e organizar;
**liberar memória à mão é grátis e ilimitado** (O, home, item 04).

Nosso escopo: **só a frente de memória**, o Auto Care de memória e o Registro. O resto fica fora (ver §6).

## 2. Como o Mint libera memória (guia `guides/memory`)

| # | Comportamento | Tipo |
|---|---|---|
| M1 | A tela mostra "27.4 GB of 32 GB used" e uma barra única de memória usada. | O |
| M2 | Os apps aparecem em grupos: **Idle**, **In use**, **System & protected** e **Freed**. | O (imagem 01, guia) |
| M3 | Cada app mostra nome, estado e tamanho: "Xcode · busy · 34% CPU · 6.2 GB", "Safari · in front", "Figma · idle 2 h". | O |
| M4 | Apps parados há algum tempo **já vêm marcados**. O app em que você está trabalhando, ou um app ocupado, **nunca vem marcado**. | O (passo 2 do guia) |
| M5 | Botão **Release**: os apps marcados são fechados "do jeito normal, para poderem salvar antes". A memória volta na hora. | O (passo 3) |
| M6 | Resultado: "✓ 3.3 GB freed · 24.1 GB of 32 GB used". | O |
| M7 | O sistema (macOS) e o próprio Mint **nunca são oferecidos**. | O ("Good to know") |
| M8 | Um app fechado abre de novo normalmente quando você precisar. | O |
| M9 | Auto Care pode liberar apps parados quando a memória sobe; **você define a linha** em que ele começa. Na imagem: "Auto Care starts at 92%". | O (imagens 01 e 03) |
| M10 | "Idle" no Mint é tempo sem uso do app (Spotify "idle 3 h"), não CPU zero. | I |
| M11 | Se "Freed" mede a queda da memória usada ou soma os apps fechados. O exemplo do guia não decide: a memória cai 3,3 GB (27,4 → 24,1) e os três apps marcados somam 3,34 GB (Figma 1,6 + Slack 1,1 + Spotify 0,64). Nossa regra R08 mede o disponível porque, **no Windows**, páginas compartilhadas inflam a soma por app. | U |
| M12 | O blog do Mint tem um post sobre por que a soma dos apps passa da memória usada ("why app totals exceed memory used"). | O (título do link) |
| M13 | O tempo exato que marca um app como Idle. Limite observado: o Slack "idle 40 min" está no grupo Idle marcado, então o corte do Mint é **no máximo 40 min**. Isso apoia os 30 min propostos na P06. | U, com limite O |
| M14 | Se um app que toca música em segundo plano conta como "in use". | U |
| M15 | O que o Mint faz quando o app pergunta "salvar alterações?" e não fecha. | U |

## 3. Auto Care (guia `guides/auto-care`)
- O: liga por categoria, roda sozinho, "every run is in the log". Para disco espera o Mac ficar 10 min parado e na tomada.
- O: para memória, o gatilho é **uma porcentagem** (imagem 03: "Memory · At 92% memory").
- O: só roda **enquanto o Mint está aberto** (home, item 05).
- O: "It never takes a conversation, or anything you haven't chosen."
- I: o log mostra uma barra por execução ("Each bar is one run. The newest is lit.").

## 4. Padrões de interface observados (imagens em `docs/referencias-ui/`)
- O: barra lateral fixa com ícone e rótulo: Home, Disk, Organize, Memory, Uninstall, Log, e More no rodapé.
- O: título grande à esquerda ("Free up memory") com uma linha de status embaixo ("Auto Care starts at 92%").
- O: o centro da tela de memória é uma **visualização de partículas** saindo da barra "Used memory 90%" para os grupos à direita. É decoração, não dado.
- O: lista em grupos com cabeçalho colorido (Idle em laranja, In use em azul, System & protected em cinza, Freed em verde), caixa de seleção, ícone do app, "idle 2 h" em texto pequeno e tamanho alinhado à direita.
- O: um único botão em pílula no canto inferior direito ("Release" → "Freeing…").
- O: painel compacto (imagem 07, Raycast): anel de "9.8 GB free", "In use / Free" e "Auto Care · At 90% used".
- O: tokens do site: fundo `#080b08`, célula `#0e130f`, linha `#2c322d`, texto `#edebe5`, apagado `#979d97`,
  destaque `#bdfe3a`, perigo `#ffb4a9`; fonte DM Sans (título 64 px, peso 700, espaçamento −1,92 px);
  mono Geist Mono; botões em pílula (raio 999 px).

**Uso permitido.** Copiamos os padrões de layout e de comportamento, não a marca: sem o nome "Mint",
sem o logo, sem a imagem da Terra (NASA) e sem o verde-limão como cor de destaque. Ver P01 e P02 em `.claude/project.md`.

## 5. Do Mac para o Windows: o que muda

| Mint (Mac) | Problema no Windows | Nossa resposta |
|---|---|---|
| Sabe há quanto tempo cada app está parado | Windows não tem uma API "app idle" | A sonda grava, a cada 2 s, qual processo tem a janela em primeiro plano. O tempo de inatividade conta a partir daí (R03). |
| Soma por app | Chrome, Edge, Teams rodam dezenas de processos | Agrupar por executável e somar o **working set privado** (R02). |
| "Quit" fecha o app de verdade | No Windows não há um "sair" universal. `WM_CLOSE` fecha a janela, e muitos apps (Teams, Discord, Spotify) só **vão para a bandeja** e seguem ocupando memória | Fechar com `WM_CLOSE`, conferir depois de alguns segundos e dizer "fechou", "ficou aberto (talvez esteja pedindo para salvar)" ou "foi para a bandeja". Encerrar à força só por app que você liberou antes (R07, P03). |
| macOS e Mint protegidos | Processos de sistema, sessão 0, Explorer, terminais com agentes rodando | Só é candidato o processo da sua sessão com janela visível. Lista fixa de protegidos mais a lista "nunca fechar" (R05). |
| "Boosters" de RAM | Programas de Windows "limpam RAM" com `EmptyWorkingSet` ou esvaziando a lista standby | Rejeitado: só empurra páginas para o arquivo de paginação e a lentidão volta depois (ADR 0004). |

## 6. Fora do escopo (adicionar quando você pedir)
Disco, Otimizar arquivos, Organizar pastas, Desinstalar, MCP/CLI para agentes, painel do Raycast.
