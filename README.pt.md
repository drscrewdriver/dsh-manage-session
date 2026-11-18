# dsh-manage-session (Gerenciador de sessões)

> **Nome anterior**: `dsh-session-steward` (Mordomo de sessões). Este repositório foi renomeado para
> `dsh-manage-session` a partir do 2.0.0, e a capacidade de busca/índice foi destacada de volta
> para [`dsh-search-index`](https://github.com/drscrewdriver/dsh-search-index).

Plugin DSH Web: **console unificado de sessões ativas e arquivadas + revisão de saúde em quatro portas**.

- **Gestão (página principal)** — lista de sessões **ativas + arquivadas** agrupada por espaço de
  trabalho: filtro de domínio (todos / ativas / arquivadas), filtro por título, favoritos, e três
  operações **não equivalentes** em lote após marcar caixas — arquivar, desarquivar, purgar arquivos
  do arquivo (exclusão real no disco, irreversível). Cada linha traz título, espaço de trabalho e data.
- **Revisão de saúde** (aba reserva) — revisão em quatro portas → receita (lista de comandos)
  → alta (disposições reversíveis + antes/depois).

> Só faz **disposições reversíveis**: não reescreve logs de sessão, não altera dados históricos,
> não descarta campos em silêncio.
>
> **Este pacote não contém busca/índice nem depende do DRS**: a recuperação de sessões (título /
> conteúdo FTS5, localização de acertos) vem do `dsh-search-index`, e a dependência DRS
> (`dsh-reference-session-collector`) mora lá. O corpus do console de gestão é montado na hora pelo
> `session-catalog`, a partir do `sessionQuery` do host + o conjunto de arquivamento oficial.

## Posição da entrada (fileira de ferramentas do topo / queda para o rodapé)

| Capacidade do host | Forma da entrada |
|---|---|
| A sidebar declara os slots da fileira de ferramentas do topo (linha de painel `sidebar.panellist` + slot de página inteira `main`, a fileira「Complementos / Mais」do 0.1.7+/0.2.x) | A entrada pousa como **linha de painel** logo após a linha「Complementos」e antes do lançador「Mais」(order 6), com ícone em linha e texto alinhado à esquerda por padrão; o clique abre a **página inteira** na coluna principal, e「Fechar」na página retorna à conversa |
| O host não tem esse slot (linha antiga / layout enxuto) | Cai no `sidebar.footer.action` do **rodapé** da sidebar; o clique abre um diálogo flutuante |

A decisão é feita na carga (sonda `inject` sobre os dois assentos estarem declarados); se o host
declarar o slot mais tarde, a entrada do rodapé é retirada ali mesmo e se muda para o topo — nunca
coexistem duas. Ambos os caminhos são dirigidos pelo interruptor de configurações, e virá-lo tem
efeito imediato.

## Capturas de tela

**Forma atual** — a entrada fica na fileira de ferramentas do topo da sidebar (após「Complementos」, antes
de「Mais」); clicar abre o console de gestão de sessões: cartões de três colunas agrupados por
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
| `session-history-archive` | arquivamento em lote (API em memória primeiro, degrada para arquivo) |
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
| Verificação de saúde | `healthCheck` (padrão true) | não registra `session-health-*` e não renderiza a aba「Verificação de saúde」 |
| Exclusão em linha | `directDelete` (padrão false) | a linha「Excluir」não aparece no menu de sessão da sidebar (entrada destrutiva desligada por padrão) |

## Armazenamento

| Caminho | Conteúdo |
|---|---|
| `~/.dsh/storages/manage-session-favorites.json` | conjunto de favoritos (por sessionId) |
| `~/.dsh/storages/workspace.json` | array de arquivamento e tabela de membros do espaço de trabalho (**arquivo do host**, este plugin faz backup automático antes de escrever) |

## Revisão em quatro portas

| porta | critério | nível |
|---|---|---|
| `log-integrity` | varredura multi-frame zstd → expande provenance → desempacota linhas empacotadas; seq contínuo, sem quadro rasgado no fim | problema de leitura `fail`; só quadro rasgado no fim `warn` |
| `projection-cache` | defasagem (`lag`) entre o `minSeq` de `~/.dsh/storages/session_projcache/sessions/<id>.json` e o último seq do log + campos não liquidados | defasado e não liquidado `fail`; qualquer um `warn` |
| `lossless-json` | JSON sem perdas linha a linha via `sessionProjections.checkpoint(session)` no estado quente | acerto `fail`, com key da projeção → pacote de atribuição |
| `cold-read` | motivo do último `turn/end`, existe open step sem fecho | open step `fail`; interrupted/sem turn/end `warn` |

A **receita** só propõe três coisas reversíveis: ① isolar registros corrompidos do cache de projeção
(backup antes) ② havendo step não liquidado, aguardar o host liquidar ③ emitir a lista de comandos
executáveis. **Proibido**: reescrever logs de sessão, alterar dados históricos, descartar campos em
silêncio.

## Desenvolvimento

```bash
pnpm install
pnpm typecheck     # tsc -b --pretty false
pnpm test          # vitest run (metade do host)
pnpm test:client   # asserções de registro / dicionários da metade de navegador (exige build antes)
pnpm build         # tsc -b && tsdown → lib/index.js + lib/client.js
```

## Licença

MIT

## Face TUI (dsh-tui)

O dsh-tui não carrega a metade client do plugin (painéis/cartões/página de configuração) nem alcança RPC própria do plugin; chamada de ferramenta mostra só uma linha de resumo. A face legível e operável por humano que sobra são os comandos de barra do host. Convenção de saída: linha única ≤100 caracteres, ≤40 linhas no total, sem ANSI, alinhamento de dois espaços; escrita é dry-run por padrão, `--yes` executa; `--json` devolve JSON em linha única.

| Comando | Função |
|---|---|
| `/sessions audit` | total de sessões + as 10 mais recentes (`--all` traz 40) |
| `/sessions archived` | só sessões arquivadas |
| `/sessions prune` | dry run: estima quantos arquivamentos podem ser limpos (não apaga) |

O comando é registrado pelo próprio plugin no host (`ctx.inject(['commands'], …)`): em linhas antigas sem serviço de comandos ele não ativa e não gera erro.
