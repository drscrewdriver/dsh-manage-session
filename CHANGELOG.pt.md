# Registro de mudanças

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
