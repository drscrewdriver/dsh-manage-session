<div align="center">

# dsh-manage-session

**Console de sessões · arquivo e lixeira — sessões ativas e arquivadas num só lugar**

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [Español](README.es.md) · **Português**

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> Plugin DeepSeek Harness (DSH) mantido pela comunidade, não é um produto oficial da DeepSeek AI.

Este documento descreve **2.0.30**. Mudanças publicadas no [histórico](CHANGELOG.md).

## Funcionalidades

Guarde as sessões de que não precisa no arquivo e recupere-as a qualquer momento; excluir passa por uma lixeira, nunca por uma remoção irreversível.

- **Vista de sessões arquivadas**: o escopo «Arquivadas» do painel lista todas as sessões arquivadas, agrupadas e contadas por área de trabalho.
- **Busca por área de trabalho**: chips de área, prefixo `workspace:` e filtro por título/caminho mantêm dezenas de projetos utilizáveis.
- **Restaurar e excluir**: restaurar = desarquivar (volta à barra lateral); excluir = arquivar → lixeira → remoção do uuid, reversível.
- **Lixeira e compactação periódica**: `trash` move para `~/.dsh/trash/manage-session/<lote>/`, `compact` funde lotes por dia/semana/mês em `.tar.zst`, `restore` devolve.
- **Favoritos e ações em lote**: estrela, vista «apenas favoritos», arquivar e excluir em lote (confirmação em duas etapas).
- **Primeira pintura instantânea + verificação de saúde de quatro portas**: títulos sem I/O e complemento por fluxo de frames (373 ms em 252 sessões); integridade dos logs, cache de projeção, JSON sem perdas, fecho em leitura fria.

## Capturas

![Console: grupos por área e seleção em lote](assets/new-manager.png)

![Vista de arquivo: sessões arquivadas juntas](assets/old-archive.png)

![Barra lateral antiga: posição da entrada](assets/left-sidebar-old.png)

## Instalação

**Host compatível**: `engines.dsh` é `>=0.1.0-rc.2 <0.3.0-0`; as linhas `0.1.x` e `0.2.x` estão verificadas.

### Deixe um agente instalar (recomendado)

```text
Instale a versão mais recente do dsh-manage-session no perfil DSH que eu uso, pelo registro npm oficial, confirme a versão e diga como recarregar.
```

### Instalação / atualização manual

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

Reinicie o DSH (os plugins do host carregam na inicialização) e atualize a interface para ver a entrada «Gerenciamento de sessões».

## Configuração

Namespace de ajustes `manage-session`:

- `enabled` (`true`) — Chave geral; desligada, o painel e todas as rotas fenced não são registrados
- `historyFiles` (`true`) — Caminhos de escrita arquivar / desarquivar / excluir (lixeira)
- `healthCheck` (`true`) — Verificação de saúde de quatro portas e receitas de reparo
- `directDelete` (`false`) — Mostrar ou não a linha «Excluir» no menu de sessão (desligado por padrão)

**Posição da entrada**: slot de ferramentas no topo da barra lateral quando existe, senão o rodapé.

## Uso

- **Arquivar uma sessão** — Selecione e clique em «Arquivar»; ela sai da barra lateral na hora. Sessões ativas são paradas antes.
- **Restaurar uma sessão** — Selecione em «Arquivadas» e clique em «Desarquivar»; volta para a sua área.
- **Excluir uma sessão** — Dois cliques em «Excluir»; vai para a lixeira e o uuid sai do registro na hora.
- **Buscar uma área** — Clique num chip ou digite `workspace:palavra` na busca.
- **Favoritos** — Clique na estrela; ative «apenas favoritos» no menu de visualização.

## Arquivo, exclusão e limpeza (script determinístico)

Para uma limpeza completa rode o script com o host fechado; ele nunca faz `rm` direto dos dados de sessão:

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list` classifica só leitura: `orphan-id` (no registro, ausente do disco) / `empty-session` / `untitled-session` / `encoded-id` / `ok`.
- `trash` move para a lixeira e limpa o registro; `compact --window week` funde lotes por período e esvazia as pastas restauráveis diretamente.
- `restore --archive <período> [--ids ...]` restaura; `ledger` é o registro append-only de cada limpeza.
- **Área de lápides**: `tombstones` mostra apenas exclusões incompletas (`pending-cleanup`); `forget` remove as entradas sem entidade.

## Armazenamento e rotas

Arquivos do host são copiados antes de qualquer escrita; sem índice próprio de sessões, a busca vem do `dsh-search-index`.

- `~/.dsh/storages/workspace.json` — Conjunto arquivado e pertencimento a áreas (arquivo do host)
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — Registro de limpeza (append-only, um uuid por linha)
- `~/.dsh/trash/manage-session/` — Lixeira: pastas de lote + `archive/*.tar.zst`

```text
session-catalog            session-catalog-stream
session-history-list       session-history-archive
session-history-prune      session-history-purge
session-history-favorites-list / session-history-favorite-set

session-health-status      session-health-scan
session-health-session     session-health-repair
session-health-source-migrate

settings-describe          settings-mutate
```

## Avisos

- A exclusão continua definitiva: a lixeira restaura tudo, mas após `compact` restaura-se do `.tar.zst`; destruir um lote exige `--yes`.
- «Sem título» não é resíduo de exclusão: sessões sem mensagens e sessões com id codificado `im:` simplesmente não têm título.
- Com um processo do host ativo o script recusa `trash/compact/restore` (`--allow-running` força).

## Perguntas frequentes

### Sem entrada após instalar?

Reinicie o DSH; confirme o perfil em uso e que o `cordis.patch.yml` não desativa `dsh-manage-session`.

### Arquivar ou excluir?

Arquivar apenas guarda e pode ser desfeito; excluir passa pela lixeira, limpa o registro e continua restaurável a partir do arquivo.

### Convivência com outros plugins de arquivo?

Sim. O conjunto arquivado é estado compartilhado do host: ambos leem os mesmos dados com entradas separadas.

## Licença

Distribuído sob a [MIT License](LICENSE).

<details>
<summary>Build from source</summary>

```powershell
git clone https://github.com/drscrewdriver/dsh-manage-session.git
Set-Location .\dsh-manage-session
pnpm install --frozen-lockfile
npm run build
dsh plugin --profile web add .
```

</details>

