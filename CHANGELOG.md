# Changelog / 变更日志

## 2.0.0

**重定位：纯会话管理台。** 搜索/索引子域整体拆回 `dsh-search-index`，本包不再自建索引、
不再依赖 DRS（`dsh-reference-session-collector`）。

### 破坏性变化

- 删除搜索子域：`/manage-sessions-search/api` 路由、FTS5 索引引擎/水位同步/重建/快照、
  DRS 语料源、搜索面板与搜索设置卡、搜索入口与搜索页全部移除。
- 依赖：移除 `dsh-reference-session-collector`（dependencies + pluginDependencies）与
  `better-sqlite3`（optional）。
- 设置：命名空间只剩 `manage-sessions`；字段删 `search` / `defaultMode` / `autoSync` /
  `syncIntervalMs` / `archiveKeep` / `indexDir` / `corpusSource` / `drsBaseUrl`。
- 新方法 `session-catalog`：管理台语料改由宿主 `sessionQuery` + 官方归档集合现场拼装
  （活跃/归档同表，归档标记 = 归档集合成员）。
- `session-health-status` 的 switches 增补 `directDelete`（会话菜单删除行的探针面）。

### 入口位次

- 顶栏工具行（`sidebar.panellist` + `main`）→ 单枚面板行 order 6，落在「插件」之后、
  「更多」之前，点击在主栏整页打开；无该槽位 → 回落底栏对话框。
- 席位能力用 `inject` 探测（不依赖 `specDynamic`，避免服务面不暴露/装载序问题）。

### 配套

- 字典：`manage-locales.ts` 只保留管理台键集（9 语，含 star.on/star.off）。
- 文档：README 四语重写；INSTALL 命令不变；兼容句仍由 `scripts/sync-hosts.mjs` 单源生成。

## 1.0.1 / 1.0.0

独立包首发（由 `dsh-session-steward` 0.5.7 复制改名而来），当时仍为合并包（含搜索子域）。
