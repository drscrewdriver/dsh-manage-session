# Guia de instalação (CLI oficial do DSH)

Este guia usa apenas o comando oficial `dsh plugin` do DSH. Esse comando instala a dependência
num perfil e sincroniza o `dsh.profile.bundles`. Não o substitua por um `npm install` comum,
um `pnpm add` direto no perfil ou edições manuais no manifesto do perfil.

- [English installation guide](./INSTALL.md)
- [中文安装指南](./INSTALL.zh.md)
- [日本語インストールガイド](./INSTALL.ja.md)
- [한국어 설치 안내](./INSTALL.ko.md)
- [Guia de instalação em português](./INSTALL.pt.md)
- [中文 README](./README.md)
- [English README](./README.en.md)
- [日本語 README](./README.ja.md)
- [한국어 README](./README.ko.md)
- [Português README](./README.pt.md)
- [Changelog](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog em português](./CHANGELOG.pt.md)

Os marcadores deste guia são:

- `<profile>`: o perfil DSH a modificar, normalmente `web`;
- `dsh-manage-session`: o pacote npm e o ID de plugin em tempo de execução.

> **Faixa de DSH suportada: a whitelist enumerada em `engines.dsh` (`0.1.0-rc.2` … `0.2.1-rc.3`, cada rc testado).**
>
> Esta é a faixa declarada em `engines.dsh` tanto do `package.json` quanto do `dsh.plugin.json`,
> e coincide com o piso `^0.1.0-rc.6` que este plugin já declara para sua própria dependência
> `@deepseek-ai/dsh-client-ui-slots`. Confira a versão em execução com `dsh --version` antes de instalar.

## 0. Pré-requisitos e descoberta do perfil

```bash
echo "DSH_HOME=${DSH_HOME:-$HOME/.dsh}"
dsh --version
ls "${DSH_HOME:-$HOME/.dsh}/profiles"
```

Use o perfil nomeado pelo processo DSH em execução. `web` é comum, mas o argumento `--profile`
ativo é a autoridade.

## 1. Instalação oficial

```bash
dsh plugin --profile <profile> add dsh-manage-session -w
```

(a flag `-w` é obrigatória quando o perfil é a raiz de um workspace pnpm, como é o caso do `web`.)

Instale uma versão específica explicitamente:

```bash
dsh plugin --profile <profile> add dsh-manage-session@1.0.0 -w
```

A CLI oficial atualiza a dependência do perfil, o lockfile e o `dsh.profile.bundles` automaticamente.
Não acrescente uma linha YAML manual.

### Período de resfriamento da cadeia de suprimentos

O runtime do DSH usa o pnpm 11, cuja política `minimumReleaseAge` pode bloquear uma versão recém
publicada com `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. Acrescente a versão a
`minimumReleaseAgeExclude` em `~/.dsh/profiles/<profile>/pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - dsh-manage-session@1.0.0
```

## 2. Reinicie o host

**Um reinício do DSH é obrigatório após instalar ou atualizar.** Recarregar a página do navegador
não basta: a metade do host registra as rotas `/manage-session/api` e o namespace de configurações
na partida, e o host precisa recarregar a fonte de arquivamento antes de refletir um prune.

## 3. Atualização

```bash
dsh plugin --profile <profile> update dsh-manage-session -w
```

Reinicie o DSH em seguida.

## 4. Registro por caminho local / `link:` (alternativa)

Para desenvolvimento ou instalações offline, registre o plugin a partir de um checkout local:

```bash
#    ~/.dsh/profiles/<profile>/package.json dependencies:
#      "dsh-manage-session": "link:<absolute path to dsh-manage-session>"
#    ~/.dsh/profiles/<profile>/cordis.patch.yml:
#      - insert:
#          - id: dsh-manage-session
#            name: dsh-manage-session
cd ~/.dsh/profiles/<profile> && pnpm install && dsh web
```

Ou use a CLI oficial com um caminho local (sem rede):

```bash
dsh plugin --profile <profile> add /absolute/path/to/dsh-manage-session -w
```

Compilar a partir de um checkout de fonte usa estes scripts:

```bash
pnpm install
pnpm typecheck     # tsc -b --pretty false
pnpm test          # vitest run
pnpm build         # tsc -b && tsdown → lib/index.js + lib/index.d.ts + lib/client.js
```

`lib/` não é commitado, então um checkout de fonte precisa ser compilado antes de poder ser
registrado por caminho. A publicação o compila sozinha pelo gancho `prepublishOnly`.

## 5. Verifique a instalação

Confira a dependência e a versão instalada:

```bash
grep -n "dsh-manage-session" \
  "${DSH_HOME:-$HOME/.dsh}/profiles/<profile>/package.json"
node -p "require('${DSH_HOME:-$HOME/.dsh}/profiles/<profile>/node_modules/dsh-manage-session/package.json').version"
```

Confira a composição oficial:

```bash
dsh --profile <profile> --dump-default-config
```

Deve conter:

```yaml
- id: dsh-manage-session
  name: dsh-manage-session
```

## 6. Verifique o plugin

Depois do reinício, a entrada da sidebar `dsh-manage-session` está disponível e a seção de
configurações usa o namespace `manage-session`. Confirme:

1. As duas abas renderizam — **Retirement Home** e **Checkup** — enquanto as duas portas de
   recursos estiverem ligadas.
2. Desligar `historyFiles` remove a aba Retirement Home e faz toda chamada `session-history-*`
   retornar um erro explícito de desabilitado.
3. Desligar `healthCheck` remove a aba Checkup e faz toda chamada `session-health-*` retornar um
   erro explícito de desabilitado.
4. Um método não reconhecido em `/manage-session/api` retorna um erro explícito em vez de
   retornar sucesso em silêncio.

Domínios fechados retornam `{ ok: false, error: '子域已关闭（…=false）：<method> 未注册' }` — o
plugin não deixa cascas vazias para trás.

## 7. Solução de problemas

| Sintoma | Ação |
| --- | --- |
| `dsh` não encontrado | Instale ou habilite a CLI oficial do DSH. |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | Acrescente a versão a `minimumReleaseAgeExclude` no `pnpm-workspace.yaml` do perfil. |
| Abas ou rotas ausentes após instalar | Reinicie o processo do host — recarregar a página não re-registra rotas. |
| Mudanças no conjunto de arquivamento não aparecem | Reinicie o host; a fonte de arquivamento é lida na partida. |
| `session-history-*` retorna erro de desabilitado | A porta `historyFiles` está desligada. Reabilite nas configurações do plugin. |
| `session-health-*` retorna erro de desabilitado | A porta `healthCheck` está desligada. Reabilite nas configurações do plugin. |
| Bundle de client obsoleto após uma atualização | Recarregue o navegador forçadamente (Ctrl+Shift+R). |

## 8. Remoção

```bash
dsh plugin --profile <profile> remove dsh-manage-session
```

Reinicie o DSH em seguida.

## Remover não desfaz reparações

O plugin nunca reescreve logs de sessão, dados históricos, nem descarta campos em silêncio. A única
ação de ar irreversível que ele toma — isolar um registro corrompido do cache de projeção — copia um
backup antes, e o diretório de quarentena fica no disco para você restaurar a partir dele. Remover o
plugin portanto deixa no lugar qualquer quarentena que você pediu; restaure manualmente se quiser o
estado de volta.

## Licença

MIT
