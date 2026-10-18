# 0006 — Agente no chat: Claude ou GPT pelos CLIs da assinatura, com ferramentas só de leitura

**Status:** aceito (2026-10-18). Spike real nos dois provedores, script em
`scripts/spike-agent.mjs` (cópia do spike da sessão).

## Contexto
Antônio quer conversar com um agente dentro do app, escolhendo entre a assinatura do GPT e a do Claude,
sem chave de API. O agente ajuda a achar arquivos que ele não abre mais, recomenda limpezas e acompanha os avisos.

## Decisão
- Um turno = um processo do CLI, que termina ao fim da resposta. A conversa continua pelo id da sessão
  (`--resume <id>` no Claude, `exec resume <id>` no Codex).
- As ferramentas vêm de um único servidor MCP stdio do Folga (`src/mcp.ts`), escrito à mão (JSON-RPC por
  linha). Ele foi testado com os dois clientes reais.
- **Todas as ferramentas são só de leitura** (`readOnlyHint: true`). O agente **não executa nada**. Ele
  propõe sugestões num bloco `folga-sugestao` da resposta, e o servidor transforma esse bloco em cartões
  que o usuário aprova (R20 a R24). Uma tentativa de configurar aprovação automática de ferramentas no
  Codex foi barrada pelo classificador de segurança, e este desenho dispensa isso.

### Claude (`claude.exe` 2.1.302, assinatura)
`-p <texto> --output-format stream-json --verbose --tools "" --mcp-config <arquivo> --strict-mcp-config
--allowedTools mcp__folga --permission-mode dontAsk --setting-sources project,local --disable-slash-commands
--system-prompt <prompt> --settings {"disableAllHooks":true,"claudeMdExcludes":[...]}`, com env
`CLAUDE_CODE_HARBOR_KITE=0`, cwd = pasta de dados e **stdin fechado**. Com stdin aberto, ele espera 3 s.
- Observado: `init.tools` = só `mcp__folga__*`, a autenticação OAuth funciona e a conversa leva 8,4 s.
- Sem o `claudeMdExcludes`, o agente dizia ter recebido as instruções do `~/.claude/CLAUDE.md`; com ele, diz
  que não (controle negativo).
- `--bare` foi descartado: aceita só `ANTHROPIC_API_KEY`.

### GPT (`codex.exe` 0.156.1 do pacote npm, login ChatGPT)
Chamado direto, com o exe do vendor e `shell:false` (o `.cmd` exigiria shell):
`exec --json --sandbox read-only --skip-git-repo-check --ignore-user-config -C <pasta de dados>
-c mcp_servers.folga.command=… -c mcp_servers.folga.args=[…] -c mcp_servers.folga.env={…}
-c developer_instructions=<prompt>` e `--disable` em `shell_tool`, `plugins`, `apps`, `browser_use`,
`browser_use_external`, `computer_use`, `image_generation`, `in_app_browser`, `hooks`, `tool_suggest`,
`skill_search`, `goals` e `view_image`.
- Observado: com `readOnlyHint` a ferramenta roda sem aprovação, e a conversa leva de 9 a 13 s.
- Sem o `readOnlyHint` a chamada falha ("requires approval, but approval policy is never").
- **Assimetria conhecida:** o `~/.codex/AGENTS.md` sempre entra no contexto; não há opção para tirar.
  Como o shell e as skills estão desligados, ele não consegue agir sobre essas instruções. O prompt de
  sistema manda ignorá-las.

## Consequências
- Cada turno abre um processo de 100 a 300 MB, que termina ao fim do turno. Esse processo fica na árvore
  `__self` enquanto vive, e o R18 vale entre turnos.
- Um turno por vez, com teto de 120 s. Ao estourar, o servidor mata a árvore do processo.
- O custo é a cota da assinatura de cada um. O Claude informa o custo equivalente em US$ no `result`.
