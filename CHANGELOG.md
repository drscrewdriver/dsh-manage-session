# Changelog / 变更日志

## 2.0.14

**管理台交互三修（用户反馈）。**

- **批量操作条不再被浮动控件挡住**：条从「贴底通栏 + 按钮被推到最右」改为「左下浮起卡片」——
  `batchInfo` 不再拉伸（`flex:0 1 auto`），按钮紧跟「已选 N」左侧排布，整条上提 10px 并加边框/阴影，
  与右下角的视图切换按钮（分段/卡片/折叠）彻底错开。
- **双击才跳转，单击只选中（防误触）**：行点击不再直接打开会话——单击只给卡片加选中高亮，
  双击（或键盘 Enter / 空格）才打开；鼠标滑一下就被人抛出管理台的问题就此消失。真正打开时先
  `layout.selectPanel(null)` 退页、再在下一帧交给 `uiWorkspace.openSession`，避开宿主「先切会话、
  最后才撤页」造成的首次点击无效。
- **跳转容错（不再异常跳出）**：导航服务缺席 / 会话已删 / 服务抛错都不再是静默无效或白屏——
  统一转成一条就地错误带（`manage.open.failed`：打不开会话「{id}」：原因），可手动关闭；
  面板、勾选与滚动位置全保留。对话框形态下导航成功即关面板，失败则留在面板里提示。

## 2.0.13

**首屏秒回 + 标题分帧流式补齐。**

- `session-catalog` 不再调用 `sessionQuery.readTitleSnapshots`（它的契约是「解压整份日志再
  fold 末标题」，实测 252 个会话 858 MB / 12.4 s）。标题改走三级零 I/O 解析：活跃会话实时
  投影 → `sessionProjectionCache` 的 checkpoint 快照 → 逐条缓存文件；三级都未命中才落
  `pending`。本机实测：243/252 首屏即出标题（三服务全缺席、只走缓存文件兜底时 373 ms），
  `pending` 仅 9 条。
- 新增 fenced 方法 **`session-catalog-stream`**（`text/event-stream`，仍只收 POST）：对
  `pending` 会话按 DRS 范式**分帧**读日志 —— 首窗 256 KB 起 × 只解压到出现
  `session/title` 的帧为止，逐帧 `await`（线程池）且每 8 帧让路，窗口 ×4 扩张至 8 MB /
  32 帧 / 8 s 预算。本机实测补全 5/9 条，共读 558 KB、35 帧，26 ms；最终覆盖 248/252
  （剩下 4 条确实没有 `session/title` 事件）。
- 新增 `titleSource` 字段：`live` / `cache` / `pending` / `none`。旧客户端忽略即可，旧字段
  全保留。
- 可中止：面板关闭 / 客户端 abort → `req|res.close` 触发 `AbortController`，宿主立刻停读
  （日志留下 `aborted after N frames`）。
- 进程内标题 memo（5 min TTL，`live` 不入 memo，`none` 负结论入 memo）；清理成功后按 id 失效，
  归档/取消归档后全量失效。
- 顺手修：`runtime.sessionQuery` 改惰性 getter（服务晚挂载时不再永久 `undefined`）。
- 新增单测：`frame-title` / `catalog-title-source` / `catalog-stream`（vitest）与
  `client-sse`（node，纯函数级解析 + 假 fetch 的跨块拼接）。

## 2.0.0

- i18n: add Portuguese (pt-BR) locale — runtime dictionary, package metadata and README/INSTALL/CHANGELOG mirrors.

**重定位：纯会话管理台。** 搜索/索引子域整体拆回 `dsh-search-index`，本包不再自建索引、
不再依赖 DRS（`dsh-reference-session-collector`）。

### 破坏性变化

- 删除搜索子域：`/manage-session-search/api` 路由、FTS5 索引引擎/水位同步/重建/快照、
  DRS 语料源、搜索面板与搜索设置卡、搜索入口与搜索页全部移除。
- 依赖：移除 `dsh-reference-session-collector`（dependencies + pluginDependencies）与
  `better-sqlite3`（optional）。
- 设置：命名空间只剩 `manage-session`；字段删 `search` / `defaultMode` / `autoSync` /
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
