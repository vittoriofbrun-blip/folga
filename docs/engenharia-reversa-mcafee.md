# Engenharia reversa do McAfee (instalado neste PC), para ideias de funcionalidade e layout

Data: 2026-10-18. Alvo: o que está instalado aqui, ou seja, o painel **McAfee LiveSafe** (pacote WPS
1.40.161.1, interface em WebView2) e o **McAfee PC Optimizer** 1.0.7.1263 (.NET Framework 4.6.2, WPF).

O objetivo é levar ideias de funcionalidade e de layout para o Folga, sem copiar marca, código nem texto.
Cada item diz se é **O** (observado), **I** (inferido) ou **U** (desconhecido).

## Como foi feito (e o limite de cada caminho)
- **Painel LiveSafe:** cliques mandados direto para a janela do WebView, sem mover o mouse nem roubar o
  foco, e capturas com `PrintWindow`. 16 capturas em `docs/referencias-ui/mcafee/wps-01` a `wps-16`. Nenhum
  interruptor, botão de varredura ou de exclusão foi acionado.
- **PC Optimizer:** roda com privilégio elevado. O Windows bloqueia leitura e cliques vindos de um
  processo comum, e eu não elevei nada. Por isso há só a tela visível (`pco-01`, `pco-02`), e a lista de
  telas veio dos recursos de interface, lidos em modo só-reflexão, sem executar o programa (REA:
  `inspect_managed_artifact`, evidência `ev_ec49b51b…`).
- O pacote da interface do LiveSafe (`wpsui.pam`) é um formato proprietário cifrado ou comprimido. Não foi aberto.

## O que o McAfee oferece

### Painel LiveSafe
| Tela | O que tem | Tipo |
|---|---|---|
| Início (`wps-01`) | destaque promocional grande; à direita, "Status do dispositivo" com uma linha por proteção, selo verde "Ativado" e "última varredura há N dias"; embaixo, uma fileira de cartões de atalho | O |
| Menu (`wps-02`) | só três seções: Início, Pontuação de proteção, Minha proteção | O |
| Pontuação (`wps-03`) | três cartões explicando o ciclo medir → corrigir pontos fracos → melhorar; a nota em si fica no console web | O |
| Minha proteção (`wps-04`, `wps-05`) | painel lateral com as funções agrupadas por tema (golpes, privacidade, web, dispositivo); cada linha tem um selo de status ou um botão de ação | O |
| Relatório (`wps-06`, `wps-07`) | abas por módulo, filtro de período, alternância entre Resumo e Histórico, cartões com número grande, gráfico de linha por dia e um resumo da última e da próxima execução | O |
| Agendamento (`wps-08`) | cartão de status com a próxima execução, mais o formulário: frequência, dias da semana em chips, hora | O |
| Removedor de rastreador (`wps-09`, `wps-10`) | cartão de destaque com explicação e "Começar"; seção recolhida para agendar; categorias: temporários, lixeira, cookies, histórico do navegador | O |
| Destruidor de arquivos (`wps-11`) | escolha da origem (lixeira, temporários da internet, pasta) e do tipo de destruição | O |
| Quarentena (`wps-12`) | tabela com colunas ordenáveis, seta por linha e ações em lote embaixo | O |
| Menu ⋮ e Configurações (`wps-13`, `wps-15`, `wps-16`) | configurações em seções recolhidas; notificações em dois níveis: todos os alertas ou só os críticos | O |
| Alerta (`wps-14`) | janela pequena no canto: ilustração, título, uma frase e o botão "Ver detalhes" | O |

**Achado lateral (O):** a quarentena lista o `probe.exe` três vezes (10:45, 10:46 e 10:54 de 18/10) e o
`hello.exe`, este detectado como "Real Protect-LS". Isso **confirma** o ADR 0002: quem apagava a nossa
sonda compilada era o McAfee. Restaurar ou excluir da quarentena é decisão do Antônio.

### PC Optimizer
- **Origem (I):** os nomes internos dos recursos indicam que é o System Mechanic, da iolo, com a marca McAfee.
- **Módulos de tela (O, pelos nomes dos recursos):**
  - painel com níveis de saúde (crítico, regular, bom, baixo) e uma lista de problemas;
  - limpeza (tudo em um, navegador, arquivos, instaladores) e desinstalador avançado;
  - monitor em tempo real de RAM, núcleos, velocidade da CPU, discos e responsividade;
  - liberar memória presa por programas ociosos;
  - gerenciador de processos;
  - otimizador de inicialização, com classes de item: necessário, desnecessário, sistema, desconhecido, perigoso;
  - modos de energia ativados por programa;
  - manutenção automática quando o PC está ocioso, com um aviso pequeno de progresso;
  - relatórios com histórico e status do PC, e **desfazer** uma ação do histórico.
- **Tela observada (O, `pco-02`):** anel grande com "itens escaneados" e "problemas encontrados", uma
  palavra de status em vermelho e, à direita, uma lista de verificações com barra de progresso.
- **(I)** Pelo nome do recurso, o "liberar memória" do PC Optimizer funciona como desfragmentação ou
  esvaziamento de memória, o que o ADR 0004 do Folga rejeita.

## O que entra no Folga (decisões no `.claude/project.md`, D13 a D18)
1. **Avisos com nível de gravidade:** crítico, atenção ou informação. Em Ajustes: "todos" ou "só críticos".
   Cada aviso tem título, uma frase e uma ação.
2. **Painel de saúde** no Início: uma nota de 0 a 100 com palavra de status e a lista de problemas, cada um
   com a ação que o resolve.
3. **Relatório:** Resumo × Histórico, filtro de período e cartões com número grande no Registro.
4. **Arquivos parados:** uma tabela com colunas ordenáveis e ações em lote, como a quarentena. A ação é
   "mandar para a Lixeira", sempre com aprovação.
5. **Limpeza rápida** por categorias: temporários do Windows antigos, lixeira, cache dos navegadores. Sem
   cookies nem histórico, para não deslogar você dos sites.
6. **Inicialização:** listar os apps que abrem com o Windows, com classificação e impacto, e recomendar o
   que desligar. Na v2 é só leitura e recomendação, sem mexer.
7. **Desfazer:** toda ação de arquivo vai para a Lixeira, então dá para desfazer.

## Fora (e por quê)
Antivírus, firewall, VPN, golpes por SMS, destruidor seguro, desfragmentação de memória (ADR 0004) e
modos de energia: não são economia de memória nem cuidado de arquivos.

## Desconhecidos
- **U:** a regra exata da nota do LiveSafe; o cálculo fica no console web.
- **U:** o que o PC Optimizer faz em cada correção da lista de problemas; a interface elevada não pôde ser
  navegada.
