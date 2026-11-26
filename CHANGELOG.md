# Changelog / 变更日志

## 2.0.22

**会话管理台单会话动作 + 官方打开能力。**

- 行内新增四个动作按钮（hover/focus 显示，触屏常显）：
  - **置顶/取消置顶**：调官方 `uiWorkspace.pinSession/unpinSession`，与侧栏同一 `workspaces` 集合；置顶行组内置前（`sortPinnedFirst`）。
  - **改名**：铅笔图标进入就地输入框，Enter 提交、Esc 取消、空名拒绝；调 `sessions.using(…rename)` 与官方重命名对话框同一条写路径。
  - **Fork**：调 `uiWorkspace.forkSession`，成功刷新列表并提示子会话 id。
  - **复制 UUID**：元信息行短 id + 悬浮全 id + 剪贴板复制（`session-` 前缀不丢）。
- 分组头新增两枚按钮（仅 open-in-app 可用时出现）：
  - **资源管理器**：调 `POST /open-in-app/open`（Windows explorer / macOS finder / Linux filemanager）。
  - **Git**：优先 `gitbash`，退 GitHub Desktop/Fork/SourceTree 等。
- 归档行：置顶/改名/Fork 不可点并悬浮提示。
- 服务缺席（旧宿主 <0.1.7）：动作按钮不渲染，面板绝不白屏。
- 新增 `src/client/session-actions.ts`、`src/client/open-in-app.ts` 及对应单测。

**修复：编码名会话（`im:` / `imu:`）删除不彻底——记账清了、目录还在。**

- 根因：宿侧只剥 `session-` 前缀，而 `im:` 会话的目录名是 `~XXXX` 编码后的（`im~003A…~0040im.wechat`）——定位不到就不删目录，后置校验也误判“已删干净”，墓碑就成了 `deleted` + 实体仍在。
- 修法：宿主侧补上与宿主同构的 `encodeSegment` / `decodeSegment`；目录索引同时注册 `原名 / 剥前缀 / 解码 id / 解码剥前缀` 四个键，`locateSessionUsage` 与投影缓存文件查找都按候选命中。
- 顺带修好：`im:` 会话的标题读取（缓存文件名也是编码名，过去必然 miss）。
- 实测：本机墓碑区 9 条里有 2 条正是这类（`E:\test\doresearch` 的两个微信 DM），升级后会在「清理」页签显示为待清理，可一键重试删除。

**设置卡新增面板常驻 Star 快车道（求星不打扰）。**

- 插件设置卡抽屉底部一行：GitHub 单色图标 + `drscrewdriver/dsh-manage-session` 链接（新标签页打开）｜ 一句求星话术 ｜ `★ 留颗 Star` 钮。
- 点钮写入 `localStorage dsh.star.manage-session.dismissed=1`：只收话术与按钮，**仓库链接常驻**；刷新/升级都不复活话术。
- 话术 10 语随宿主 `documentElement.lang` 前缀切换；无弹窗、无浮层、无 toast。
- 行组件由 `_tools/star-row` 单源生成（`sync.mjs --check` 防漂移），本包 `src/client/star-row-copy.ts` 只是生成副本。

## 2.0.20

**清理命令改为绝对路径自适应拼接：不再写死 `node_modules/...`，也不必先 cd 到 profile。**

- 宿主侧 `session-tombstones` 新增返回 `scriptPath`：由本包 `lib/index.js` 位置推导 `../scripts/session-purge.mjs`（绝对路径）。
- 面板按返回路径拼命令；路径含空格时自动加双引号（Windows/macOS 都能直接粘）。老宿主没这字段时回退到相对路径。
- 文案从「到 profile 目录执行」改为「再直接执行；以下为当前安装路径」。

## 2.0.19

**清理页签的命令表：逐条标清「只读 / 写入·可还原 / 破坏性」并配一句说明。**

- 不再一个 `pre` 块堆 5 条命令（用户反馈：看不出哪条是查看、哪条是删除）。每条命令一行：**分类徽标 + 命令 + 说明 + 单条复制**。
- 分类：`list` / `tombstones` / `ledger` = **只读**（不改任何文件）；`trash` / `compact` / `restore` = **写入·可还原**；`purge --batch --yes` = **破坏性**（不可恢复）。
- 顶部补一句图例：只读 = 不改任何文件；写入·可还原 = 搬回收站 / 压缩归档 / 还原；破坏性 = 不可恢复。保留「复制全部」。

## 2.0.18

**清理区改成页签：从管理台底部挪到「体检」旁的后台标签。**

- 面板变为三页签：**管理 / 体检 / 清理**；`historyFiles=false` 时隐藏清理页签，`healthCheck=false` 时隐藏体检页签。
- 清理页签内容：待清理清单（只列没删干净的）+ 重试删除 / 撤销墓碑 + 5 条确定性命令一键复制 + 台账路径，并提示先完全退出 DSH。
- 实现抽成独立组件 `cleanup-panel.tsx`（自带样式）：切页签不受管理台卸载影响；管理台恢复为纯会话视图。

## 2.0.17

**管理台新增「清理区」：待清理可见、可处置，删除命令在界面里就能拿到。**

- 面板底部新增「清理区」：`session-tombstones` 只拉**没删干净的**（`pending-cleanup` / 墓碑失效），逐行显示 uuid / 原因 / 状态。
- 行内两个动作：**重试删除**（复用 purge：先归档 → detach → 删盘 → 后置校验）与**撤销墓碑**（仅实体已无时出现；host 侧会再校验一次）。
- 命令可复制：一键拷贝 `list / trash / compact / tombstones / ledger` 五条确定性清理命令（提示先完全退出 DSH、在 profile 目录执行），台账路径也直接展示。
- 新方法：`session-tombstones`（只读）与 `session-tombstone-forget`（写，实体仍在则拒绝），随 `historyFiles` 子域开关控制。

## 2.0.16

**README 单一源重构（10 语言）+ 工作区搜索前缀 + archive 关键词兜底。**

- README 改为单一源生成：`docs/readme/i18n.mjs`（文案）+ `scripts/gen-readme.mjs`（骨架）→ `README.md` 与 `README.en/ja/ko/fr/de/it/ru/es/pt.md`；新增 `scripts/check-readme.mjs` 门禁（版本一致、H2 同构、archive 关键词、链接可达、files 白名单），已挂进 `prepublishOnly`。
- 新增「工作区搜索」前缀：搜索框支持 `工作区:` / `workspace:`（半角/全角冒号均可），只比 cwd；其余输入仍按标题/路径子串。
- `description` / `keywords` / `dsh.plugin.json` 描述统一改写：显式含 archive / 已归档 / 回收站 / restore 等词，做 dshmarket 与 npm 搜索位兜底（不改包名、不发 alias 包）。
- **墓碑落盘 + 冷复用探针**：删除结果写进 `~/.dsh-manage-session-index/retired-tombstones.jsonl`（带 createdAt/cwd/state）——`deleted` 跨重启隐藏；同 id 但身份不同→ 判为新会话，自动撤墓碑放行。
- **删后置校验**：只有“真删干净”才记 `deleted`；目录/缓存仍在则记 `pending-cleanup`，**不隐藏**，在面板提示「N 个没删干净，已留在墓碑区」。
- **墓碑区可清理**：脚本新增 `tombstones`（只看没删干净的）与 `forget`（只允许实体已无的条目）；`trash` 成功与 `restore` 会自动撤销对应墓碑，避免把真实会话继续隐藏。

## 2.0.15

**确定性清理脚本（回收站版，修「删了文件仍留 uuid」的幽灵行）。**

- 新增 `scripts/session-purge.mjs`：宿主关闭后运行，**永不直接 rm 会话数据** —— `list`（只读分类：`orphan-id` / `empty-session` / `untitled-session` / `encoded-id` / `ok`）→ `archive`（写归档集合并复核）→ `trash`（会话目录 + 投影缓存整段搬进 `~/.dsh/trash/manage-session/<batch>/`，含 `manifest.json`，再摘掉记账里的 uuid）→ `compact`（按周期 day/week/month 把到期批次**合并重压**成 `archive/<周期>.tar.zst`，并把可直接恢复的散目录清空）→ `restore`（从回收站或归档原样搬回）→ `ledger`（append-only 台账：uuid / cwd / 字节数 / sha256）。
- 顺序固定「先归档 → 复核 → 搬文件 → 摘记账」，任一步失败都停在可重试状态；`purge` 只用于摘除无实体的幽灵编号，永久销毁批次需 `purge --batch <名> --yes`。
- **删除机制修正（该清理的清理不掉）**：面板内的「删除」现在**先归档再删**；活跃会话（开着的 tab / 正在跑回合）被宿主拒绝时自动带 `stopActivity: true` 重试；删盘前先 `flush` + `detachEntered` 把本进程的活会话剥掉（否则目录没了、`sessions.list()` 还在，面板就留一条活跃未命名孤儿）；删成功即记进程内墓碑，catalog 立刻不再列出。
- **逐条失败可见**：归档/删除返回 `failures` / `archiveFailures`，管理台不再只报成功数（之前全部失败时看起来像“点了没反应”）。
- 宿主进程在跑即拒绝 trash/compact/restore（`--allow-running` 可显式跳过）；只允许搬运 `<dshHome>/sessions/<workspace>/<session>/` 的直接子项。
- 会话 id ↔ 目录名双向编码（`~XXXX`）：`im:` 虚拟会话同样可列出、归档进回收站、原样还原。
- 实测本机 251 会话：`orphan-id=0`、`empty-session=3`、`encoded-id=6`、`ok=242` —— 「未命名」不是删除残留：3 条是真空会话（0 条消息、无 `session/title`），6 条是编码名会话。

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
