# Registro de mudanças

## 2.0.13

**Primeira renderização instantânea + títulos completados por streaming de frames.**

- `session-catalog` deixou de chamar `sessionQuery.readTitleSnapshots` (contrato "descomprimir o log
  inteiro e depois foldar o último título": 252 sessões, 858 MB, 12.4 s nesta máquina). Os títulos
  vêm agora de três níveis sem I/O: projeção ao vivo da sessão ativa → checkpoint em
  `sessionProjectionCache` → arquivo de cache por sessão. Só o que não casa em nenhum nível fica
  `pending`. Medido: 243/252 títulos já na primeira resposta (373 ms no pior caso, só com o arquivo
  de cache, sem nenhum dos três serviços); `pending` = 9.
- Novo método fenced **`session-catalog-stream`** (`text/event-stream`, continua só POST): lê os
  `pending` **por frames** no estilo DRS — primeira janela de 256 KB, descomprimindo só até aparecer
  o frame com `session/title`, `await` por frame (thread pool), cedendo a thread a cada 8 frames,
  janela ×4 até 8 MB / 32 frames / orçamento de 8 s. Medido: 5 de 9 completados, 558 KB e 35 frames
  em 26 ms; cobertura final 248/252 (as 4 restantes realmente não têm evento `session/title`).
- Novo campo `titleSource`: `live` / `cache` / `pending` / `none` (clientes antigos ignoram).
- Cancelável: fechar o painel / abort do cliente → `req|res.close` dispara `AbortController` e o host
  para de ler imediatamente (`aborted after N frames`).
- Memo de títulos no processo (TTL de 5 min; `live` não entra; `none` entra como conclusão negativa).
  Invalidado por id após purga e totalmente após arquivar/desarquivar.
- Correção de lambuja: `runtime.sessionQuery` virou getter preguiçoso (serviço montado tarde não
  fica mais `undefined` para sempre).
- Novos testes: `frame-title` / `catalog-title-source` / `catalog-stream` (vitest) e `client-sse`
  (node: parser puro + fetch falso com frames cortados entre blocos).

## 2.0.0

- i18n: add Portuguese (pt-BR) locale — runtime dictionary, package metadata and README/INSTALL/CHANGELOG mirrors.
- i18n: acrescentado o idioma português (pt-BR) — dicionário em tempo de execução, metadados do pacote e espelhos README/INSTALL/CHANGELOG.

**Reposicionamento: console puro de gestão de sessões.** O subdomínio de busca/índice foi destacado
de volta para o `dsh-search-index`; este pacote já não monta índice próprio nem depende do DRS
(`dsh-reference-session-collector`).

### Mudanças destrutivas

- Subdomínio de busca removido: as rotas `/manage-session-search/api`, o motor de índice FTS5 /
  sincronização de marca d'água / reconstrução / snapshots, a fonte de corpus DRS, os painéis e
  cartões de configurações de busca, e todos os pontos e páginas de busca.
- Dependências: removidos `dsh-reference-session-collector` (dependencies + pluginDependencies) e
  `better-sqlite3` (opcional).
- Configurações: o namespace fica só com `manage-session`; campos retirados `search` /
  `defaultMode` / `autoSync` / `syncIntervalMs` / `archiveKeep` / `indexDir` / `corpusSource` / `drsBaseUrl`.
- Novo método `session-catalog`: o corpus do console passa a ser montado na hora a partir do
  `sessionQuery` do host + o conjunto de arquivamento oficial (ativas/arquivadas na mesma tabela;
  marca de arquivada = membro do conjunto de arquivamento).
- Os switches de `session-health-status` ganham `directDelete` (a superfície de sonda da linha de
  exclusão no menu de sessão).

### Posição da entrada

- Fileira de ferramentas do topo (`sidebar.panellist` + `main`) → uma única linha de painel com
  order 6, logo após「Complementos」e antes de「Mais」; o clique abre a página inteira na coluna principal.
  Sem esse slot → queda para o rodapé da sidebar.
- A capacidade de assento é sondada com `inject` (sem depender de `specDynamic`, para evitar
  serviço não exposto / ordem de carga).

### Complementos

- Dicionários: `manage-locales.ts` mantém apenas o conjunto de chaves do console (10 idiomas, com
  `star.on` / `star.off`).
- Documentação: README reescrito em quatro idiomas; comandos do INSTALL inalterados; a frase de
  compatibilidade continua gerada por fonte única em `scripts/sync-hosts.mjs`.

## 1.0.1 / 1.0.0

Primeira publicação como pacote independente (copiado e renomeado a partir do `dsh-session-steward`
0.5.7), quando ainda era o pacote unificado (com o subdomínio de busca).
