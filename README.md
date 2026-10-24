# dsh-manage-sessions（会话管理台 / Session Manager）

> **原名**：`dsh-session-steward`（会话管家）。本仓库自 2.0.0 起改名为 `dsh-manage-sessions`，
> 并把搜索/索引能力拆回 [`dsh-search-index`](https://github.com/drscrewdriver/dsh-search-index)。

DSH Web 插件：**活跃与归档会话的统一管理台 + 四门体检**。

- **管理（主页面）** —— 按工作区分组列出**活跃 + 归档**会话：域筛选（全部 / 活跃 / 归档）、
  标题过滤、收藏，勾选后批量执行三个**互不等价**的操作 —— 归档、取消归档、
  清理归档文件（真删磁盘，不可逆）。每行给出标题、工作区与时间。
- **体检（备用页签）** —— 四门体检 → 处方（命令清单）→ 出院（可逆处置 + before/after）。

> 只做**可逆处置**：不改写会话日志、不改历史数据、不静默丢字段。
>
> **本包不含搜索/索引，也不依赖 DRS**：会话检索（标题 / 内容 FTS5、命中定位）由
> `dsh-search-index` 提供，DRS（`dsh-reference-session-collector`）依赖也在那边。
> 管理台的语料由 `session-catalog` 现场从宿主 `sessionQuery` + 官方归档集合拼装。

## 入口位次（顶栏工具槽 / 底栏回落）

| 宿主能力 | 入口形态 |
|---|---|
| 侧栏声明了顶部工具行槽位（`sidebar.panellist` 面板行 + `main` 整页槽，0.1.7+/0.2.x 的「插件 / 更多」工具行） | 入口作为**面板行**落在「插件」行之后、「更多」启动器之前（order 6），行内 icon + 文案默认左对齐；点击在主栏**整页**打开，页内「关闭」回到会话 |
| 宿主没有该槽位（老线 / 精简布局） | 回落侧栏**底栏** `sidebar.footer.action`，点击开浮动对话框 |

判定在装载时做（`inject` 探测两席位是否已声明）；宿主稍后才声明槽位时，底栏入口会就地撤下
并切换到顶栏，不会两份并存。两路都受设置开关驱动，开关翻转即时生效。

<!-- hosts-sync:begin -->
<!-- 由 scripts/sync-hosts.mjs 生成，勿手改；单源在 scripts/hosts.mjs -->
支持 DSH 0.1.0-rc.2、0.1.0-rc.3、0.1.0-rc.6、0.1.0-rc.7、0.1.0-rc.8、0.1.1-rc.1、0.1.1-rc.2、0.1.2-rc.1、0.1.5-rc.1、0.1.5-rc.2、0.1.5-rc.3、0.1.7-rc.1、0.1.7-rc.2、0.2.0-rc.1、0.2.0-rc.2、0.2.1-rc.1、0.2.1-rc.2、0.2.1-rc.3（枚举 peer，逐 rc 实测白名单；alpha/beta 不在支持范围）。
<!-- hosts-sync:end -->

## 安装

```bash
dsh plugin --profile web add dsh-manage-sessions
# 或本地 tgz
dsh plugin --profile web add "file:E:/test/rewrite-agently/mine-dsh-plugins/dsh-manage-sessions/dsh-manage-sessions-2.0.0.tgz"
```

安装后**必须重启宿主进程**（仅刷新页面无效）。

## 路由契约

前缀 `/manage-sessions/api`，方法名一律 `session-*`；未识别的方法返回显式错误，绝不静默。

| 方法 | 作用 |
|---|---|
| `session-catalog` | 管理台语料（活跃 + 归档同表；`sessionQuery` + 归档集合现场拼装） |
| `session-history-list` | 列出归档集合（存储文件优先；含来源、降级、按行体积与 `pendingRestart`） |
| `session-history-archive` | 批量归档（内存 API 优先，文件降级） |
| `session-history-prune` | **取消归档状态**：从归档数组批量移除 id（可逆，需重启） |
| `session-history-purge` | **清理归档文件**：真删转录目录 + 投影缓存 + 两处 id（**不可逆**） |
| `session-history-favorites-list` / `-favorite-set` | 收藏集合读写（JSON 域） |
| `session-health-status` | 开关状态与方法表（面板与删除行探针用，含 `directDelete`） |
| `session-health-scan` / `-session` / `-repair` / `-source-migrate` | 批量体检、单会话报告、可逆处置、署名迁移 |

## 设置

命名空间：`manage-sessions`。

| 开关 | 字段 | 关闭效果 |
|---|---|---|
| 启用插件 | `enabled`（默认 true） | 不注册任何接口，入口整体消失 |
| 会话历史文件 | `historyFiles`（默认 true） | 不注册 `session-history-*` |
| 健康检查 | `healthCheck`（默认 true） | 不注册 `session-health-*`，不渲染「体检」页签 |
| 行内删除 | `directDelete`（默认 false） | 侧栏会话菜单不出现「删除」行（破坏性入口默认关） |

## 存储

| 路径 | 内容 |
|---|---|
| `~/.dsh/storages/manage-sessions-favorites.json` | 收藏集合（按 sessionId） |
| `~/.dsh/storages/workspace.json` | 归档数组与工作区成员表（**宿主文件**，本插件写入前自动备份） |

## 四门体检

| gate | 判据 | level |
|---|---|---|
| `log-integrity` | zstd 多帧扫描 → provenance 展开 → 打包行解包；seq 连续、无撕裂尾帧 | 有读取问题 `fail`；仅撕裂尾帧 `warn` |
| `projection-cache` | `~/.dsh/storages/session_projcache/sessions/<id>.json` 的 `minSeq` 与日志末 seq 的 lag + 未结算字段 | 滞后且未结算 `fail`；任一 `warn` |
| `lossless-json` | 热态 `sessionProjections.checkpoint(session)` 逐行判定无损 JSON | 命中 `fail`，并给出投影 key → 归属包 |
| `cold-read` | 最后 `turn/end` 的原因、是否存在未收尾 open step | open step `fail`；interrupted/无 turn/end `warn` |

**处方**只给三件可逆的事：① 隔离损坏的投影缓存记录（先备份）② 含未结算 step 时提示等待宿主结算
③ 输出可执行命令清单。**禁止**：改写会话日志、改历史数据、静默丢弃字段。

## 开发

```bash
pnpm install
pnpm typecheck     # tsc -b --pretty false
pnpm test          # vitest run（宿主半）
pnpm test:client   # 浏览器半身注册 / 字典断言（需先 build）
pnpm build         # tsc -b && tsdown → lib/index.js + lib/client.js
```

## 许可

MIT
