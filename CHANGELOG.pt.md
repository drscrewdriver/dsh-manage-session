# Registro de mudanças

## 2.0.21

**Correção: sessões com id codificado (`im:` / `imu:`) não eram apagadas por completo — a contabilidade sumia, o diretório ficava.**

- Causa: o host só remove o prefixo `session-`, mas o diretório de uma sessão `im:` é codificado em `~XXXX` (`im~003A…~0040im.wechat`); sem localizar, nada é apagado e a verificação posterior concluía “já apagado”.
- Correção: `encodeSegment` / `decodeSegment` no host e índice de diretórios com quatro chaves (nome, sem prefixo, id decodificado, decodificado sem prefixo); `locateSessionUsage` e a busca do cache de projeção passam a casar por candidatos.
- Bônus: títulos de sessões `im:` agora são lidos (o cache também usa nome codificado).

## 2.0.20

**Comandos de limpeza passam a montar caminho absoluto automaticamente: sem `node_modules/...` fixo e sem cd para o profile.**

- O host agora devolve `scriptPath` em `session-tombstones`, derivado da posição de `lib/index.js` → `../scripts/session-purge.mjs`.
- O painel monta os comandos com esse caminho e coloca aspas duplas quando há espaços; em hosts antigos cai no caminho relativo.
- Texto mudou de “executar no profile” para “executar diretamente (abaixo o caminho atual)”.

## 2.0.19

**Tabela de comandos da aba de limpeza: cada linha indica “somente leitura / escrita·restaurável / destrutivo” e traz uma explicação.**

- Nada de um único `pre` com 5 comandos (não dava para saber o que só consulta e o que apaga); agora uma linha por comando: **selo de categoria + comando + descrição + cópia individual**.
- Categorias: `list` / `tombstones` / `ledger` = **somente leitura**; `trash` / `compact` / `restore` = **escrita·restaurável**; `purge --batch --yes` = **destrutivo** (irreversível).
- Legenda no topo; “copiar tudo” continua disponível.

## 2.0.18

**A área de limpeza virou aba: saiu do rodapé do painel para a aba de bastidores ao lado de “Verificação”.**

- O painel passa a ter três abas: **Gerenciar / Verificação / Limpeza**; `historyFiles=false` oculta a de limpeza e `healthCheck=false` oculta a de verificação.
- Conteúdo da aba: lista do que não foi apagado por completo + repetir exclusão / revogar tombstone + cópia dos 5 comandos + caminho do registro (avisando para sair do DSH antes).
- Implementação extraída em `cleanup-panel.tsx` (estilos próprios): trocar de aba não depende da desmontagem do console, e o console volta a ser só a lista de sessões.

## 2.0.17

**Nova “área de limpeza” no painel: o que não foi apagado por completo fica visível, pode ser tratado ali e os comandos de exclusão podem ser copiados.**

- No rodapé do painel, a “área de limpeza”: `session-tombstones` devolve apenas **exclusões incompletas** (`pending-cleanup` / tombstone inválida), com uuid, motivo e estado por linha.
- Ações na linha: **repetir exclusão** (reusa o purge: arquivar → detach → apagar → verificação posterior) e **revogar tombstone** (só quando não há entidade; o host revalida).
- Comandos copiáveis (`list / trash / compact / tombstones / ledger`, com o aviso de sair do DSH e rodar no diretório do profile); o caminho do registro também aparece.
- Novos métodos: `session-tombstones` (somente leitura) e `session-tombstone-forget` (escrita; recusa se a entidade ainda existir), sob o switch `historyFiles`.

## 2.0.16

**README em fonte única (10 idiomas) + busca por área de trabalho com prefixo + reforço da palavra-chave archive.**

- O README passa a ser gerado de `docs/readme/i18n.mjs` (textos) + `scripts/gen-readme.mjs` (estrutura); `scripts/check-readme.mjs` valida versão, títulos equivalentes, palavra-chave archive, links e a lista `files` (ligado ao `prepublishOnly`).
- A busca aceita os prefixos `工作区:` / `workspace:` (dois-pontos normal ou largo), comparando apenas o cwd; os demais termos continuam por título/caminho.
- `description` / `keywords` / `dsh.plugin.json` foram reescritos com archive / arquivadas / lixeira / restore (sem renomear o pacote nem usar pacote alias).
- **Tombstones persistidas + sonda de reutilização fria**: o resultado da exclusão vai para `~/.dsh-manage-session-index/retired-tombstones.jsonl` (com createdAt/cwd/state). `deleted` fica oculto após reiniciar; mesmo id com identidade diferente é tratado como sessão nova e a tombstone é revogada.
- **Verificação pós-exclusão**: só o que realmente saiu fica como `deleted`; se diretório/cache permanecerem, vira `pending-cleanup` (**sem ocultar**) e o painel avisa “N não foram apagadas por completo”.
- **Área de tombstones limpável**: o script ganhou `tombstones` (só exclusões incompletas) e `forget` (apenas entradas sem entidade); `trash` bem-sucedido e `restore` revogam a tombstone correspondente.

## 2.0.15

**Script determinístico de limpeza (versão lixeira; corrige a linha fantasma “apaguei o arquivo e o uuid ficou”).**

- Novo `scripts/session-purge.mjs`: roda com o host fechado e **nunca remove dados de sessão com rm** —— `list` (inventário classificado, somente leitura: `orphan-id` / `empty-session` / `untitled-session` / `encoded-id` / `ok`) → `archive` (grava o conjunto de arquivados e reverifica) → `trash` (move diretório da sessão + cache de projeção para `~/.dsh/trash/manage-session/<batch>/` com `manifest.json`, depois tira o uuid da contabilidade) → `compact` (agrupa os lotes vencidos por período day/week/month em um único `archive/<período>.tar.zst` e esvazia os diretórios soltos de restauração direta) → `restore` (devolve do lixo ou do arquivo compactado) → `ledger` (registro append-only: uuid / cwd / bytes / sha256).
- Ordem fixa “arquivar → reverificar → mover arquivos → limpar contabilidade”; qualquer falha para num estado reexecutável. `purge` serve só para uuids fantasma sem entidade; destruir um lote em definitivo exige `purge --batch <nome> --yes`.
- Recusa trash/compact/restore com um processo DSH vivo (`--allow-running` contorna de forma explícita) e só move filhos diretos de `<dshHome>/sessions/<workspace>/<session>/`.
- Codificação bidirecional id ↔ nome de diretório (`~XXXX`): sessões virtuais `im:` também são listadas, arquivadas e restauradas.

## 2.0.14

**Três ajustes de interação no console (feedback do usuário).**

- **A barra de ações em lote não fica mais coberta pelos controles flutuantes**: deixou de ser uma faixa colada ao fundo com os botões empurrados para a direita; virou um cartão flutuante à esquerda (`batchInfo` com `flex:0 1 auto`), botões logo após «N selecionados», 10 px acima e com borda/sombra — separado do dock de visualização no canto inferior direito.
- **Duplo clique para abrir, clique simples apenas seleciona (evita toque acidental)**: clicar na linha já não abre a sessão — o clique simples apenas destaca o cartão; abrir exige duplo clique (ou Enter / espaço pelo teclado). Ao abrir de verdade, primeiro sai da página-painel (`layout.selectPanel(null)`) e só no quadro seguinte entrega ao `uiWorkspace.openSession`, evitando a ordem do host ("troca de sessão primeiro, desmarca o painel no final") que fazia o primeiro clique não surtir efeito.
- **Navegação tolerante a falhas (não salta mais para fora)**: serviço de navegação ausente, sessão apagada ou exceção do serviço viram uma faixa de erro no próprio painel (`manage.open.failed`: não foi possível abrir a sessão "{id}": motivo), dispensável; painel, seleções e posição de rolagem permanecem intactos.

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
