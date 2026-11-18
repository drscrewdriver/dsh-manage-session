# dsh-manage-session（会话管理台 / Session Manager）

> **Nome anterior**: `dsh-session-steward`（会话管家）。Este repositório foi renomeado para
> `dsh-manage-session` a partir do 2.0.0, e a capacidade de busca/índice foi destacada de volta
> para [`dsh-search-index`](https://github.com/drscrewdriver/dsh-search-index).

Plugin DSH Web: **console unificado de sessões ativas e arquivadas + revisão de saúde em quatro portas**.

- **Gestão (página principal)** — lista de sessões **ativas + arquivadas** agrupada por espaço de
  trabalho: filtro de domínio (todos / ativas / arquivadas), filtro por título, favoritos, e três
  operações **não equivalentes** em lote após marcar caixas — arquivar, desarquivar, purgar arquivos
  do arquivo (exclusão real no disco, irreversível). Cada linha traz título, espaço de trabalho e data.
- **Revisão de saúde（体检）** (aba reserva) — revisão em quatro portas → receita (lista de comandos)
  → alta (disposições reversíveis + antes/depois).

> Só faz **disposições reversíveis**: não reescreve logs de sessão, não altera dados históricos,
> não descarta campos em silêncio.
>
> **Este pacote não contém busca/índice nem depende do DRS**: a recuperação de sessões (título /
> conteúdo FTS5, localização de acertos) vem do `dsh-search-index`, e a dependência DRS
> (`dsh-reference-session-collector`) mora lá. O corpus do console de gestão é montado na hora pelo
> `session-catalog`, a partir do `sessionQuery` do宿主 + o conjunto de arquivamento oficial.

## Posição da entrada (fileira de ferramentas do topo / queda para o rodapé)

| Capacidade do host | Forma da entrada |
|---|---|
| A sidebar declara os slots da fileira de ferramentas do topo (linha de painel `sidebar.panellist` + slot de página inteira `main`, a fileira「插件 / 更多」do 0.1.7+/0.2.x) | A entrada pousa como **linha de painel** logo após a linha「插件」e antes do启动器「更多」(order 6), com ícone em linha e texto alinhado à esquerda por padrão; o clique abre a **página inteira** na coluna principal, e「Fechar」na página retorna à conversa |
| O host não tem esse slot (linha antiga / layout enxuto) | Cai no `sidebar.footer.action` do **rodapé** da sidebar; o clique abre um diálogo flutuante |

A decisão é feita na carga (sonda `inject` sobre os dois assentos estarem declarados); se o host
declarar o slot mais tarde, a entrada do rodapé é retirada ali mesmo e se muda para o topo — nunca
coexistem duas. Ambos os caminhos são dirigidos pelo interruptor de configurações, e virá-lo tem
efeito imediato.

## Capturas de tela

**Forma atual** — a entrada fica na fileira de ferramentas do topo da sidebar (após「插件」, antes
de「更多」); clicar abre o console de gestão de sessões: cartões de três colunas agrupados por
espaço de trabalho, filtros de espaço de trabalho e de domínio de recuperação (todos / ativas /
arquivadas), favoritos, e o lote arquivar · desarquivar · purgar (irreversível, pede segunda
confirmação) após marcar caixas:

![Console de gestão de sessões](assets/new-manager.png)

**Formas históricas** (só como linha do tempo, não é a interface atual):

| Época do pacote unificado (1.x: com busca, diálogo de duas abas, aposentado) | Antes (≤0.5.7: entrada no pé da sidebar) |
|---|---|
| ![Diálogo antigo de duas abas](assets/old-archive.png) | ![Entrada antiga no pé da sidebar](assets/left-sidebar-old.png) |

## Instalação

```bash
dsh plugin --profile web add dsh-manage-session
# ou um tgz local
dsh plugin --profile web add "file:E:/test/rewrite-agently/mine-dsh-plugins/dsh-manage-session/dsh-manage-session-2.0.0.tgz"
```

Após instalar **o processo do host precisa ser reiniciado** (só recarregar a página não basta).

## Contrato de rotas

Prefixo `/manage-session/api`, nomes de método sempre `session-*`; um método não reconhecido
retorna um erro explícito, jamais silêncio.

| Método | O que faz |
|---|---|
| `session-catalog` | corpus do console (ativas + arquivadas na mesma tabela; montado na hora de `sessionQuery` + conjunto de arquivamento) |
| `session-history-list` | lista o conjunto de arquivamento (arquivo de armazenamento primeiro; inclui origem, degradação, volume por linha e `pendingRestart`) |
| `session-history-archive` | arquivamento em lote (API em memória primeiro,降级 para arquivo) |
| `session-history-prune` | **desarquivar**: remove ids do array de arquivamento em lote (reversível, exige reiniciar) |
| `session-history-purge` | **purgar arquivos do arquivo**: apaga de verdade diretório de transcrição + cache de projeção + os dois ids (**irreversível**) |
| `session-history-favorites-list` / `-favorite-set` | leitura/escrita do conjunto de favoritos (domínio JSON) |
| `session-health-status` | estado dos interruptores e tabela de métodos (para o painel e a sonda da linha de exclusão, inclui `directDelete`) |
| `session-health-scan` / `-session` / `-repair` / `-source-migrate` | revisão em lote, relatório por sessão, disposição reversível, migração de assinatura |

## Configurações

Namespace: `manage-session`.

| Interruptor | Campo | Efeito ao desligar |
|---|---|---|
| Ativar o plugin | `enabled` (padrão true) | nenhuma API é registrada e a entrada desaparece por completo |
| Arquivos de histórico de sessão | `historyFiles` (padrão true) | não registra `session-history-*` |
| Verificação de saúde | `healthCheck` (padrão true) | não registra `session-health-*` e não renderiza a aba「体检」 |
| Exclusão em linha | `directDelete` (padrão false) | a linha「删除」não aparece no menu de sessão da sidebar (entrada destrutiva desligada por padrão) |

## Armazenamento

| Caminho | Conteúdo |
|---|---|
| `~/.dsh/storages/manage-session-favorites.json` | conjunto de favoritos (por sessionId) |
| `~/.dsh/storages/workspace.json` | array de arquivamento e tabela de membros do espaço de trabalho (**arquivo do宿主**, este plugin faz backup automático antes de escrever) |

## Revisão em quatro portas

| porta | critério | nível |
|---|---|---|
| `log-integrity` | varredura multi-frame zstd → expande provenance → desempacota linhas empacotadas; seq contínuo, sem quadro rasgado no fim | problema de leitura `fail`; só quadro rasgado no fim `warn` |
| `projection-cache` | defasagem (`lag`) entre o `minSeq` de `~/.dsh/storages/session_projcache/sessions/<id>.json` e o último seq do log + campos não liquidados | defasado e não liquidado `fail`; qualquer um `warn` |
| `lossless-json` | JSON sem perdas linha a linha via `sessionProjections.checkpoint(session)` no estado quente | acerto `fail`, com key da projeção → pacote de归属 |
| `cold-read` | motivo do último `turn/end`, existe open step sem fecho | open step `fail`; interrupted/sem turn/end `warn` |

A **receita** só propõe três coisas reversíveis: ① isolar registros corrompidos do cache de projeção
(backup antes) ② havendo step não liquidado, aguardar o宿主 liquidar ③ emitir a lista de comandos
executáveis. **Proibido**: reescrever logs de sessão, alterar dados históricos, descartar campos em
silêncio.

## Desenvolvimento

```bash
pnpm install
pnpm typecheck     # tsc -b --pretty false
pnpm test          # vitest run（metade do宿主）
pnpm test:client   # asserções de registro / dicionários da metade de navegador (exige build antes)
pnpm build         # tsc -b && tsdown → lib/index.js + lib/client.js
```

## Licença

MIT

## TUI 终端面（dsh-tui）

dsh-tui 不加载插件的 client 半边（面板/卡片/设置页），也调不到插件自有 RPC；工具调用只显示一行摘要。人可读、人可操作的面只剩宿主斜杠命令。输出约定：单行 ≤100 字符、总行 ≤40、无 ANSI、两空格对齐；写操作默认 dry、加 `--yes` 才执行；`--json` 输出单行 JSON。

| 命令 | 作用 |
|---|---|
| `/sessions audit` | 会话总数 + 最近 10 个（`--all` 取 40） |
| `/sessions archived` | 只看已归档会话 |
| `/sessions prune` | dry run：预估可清理的归档数（不删） |

命令由插件自己在宿主侧注册（`ctx.inject(['commands'], …)`）：命令服务缺席的老宿主线上不激活、不报错。
