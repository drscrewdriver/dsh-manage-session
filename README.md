<div align="center">

# dsh-manage-session

**会话控制台 · 归档与回收站 —— 统一管理活跃与已归档会话**

**简体中文** · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> 社区维护的 DeepSeek Harness（DSH）插件，非 DeepSeek AI 官方产品。

本文描述 **2.0.22-rc.4**。已发布变更见 [更新日志](CHANGELOG.md)。

## 功能概览

把暂时不用的会话收进归档，需要时再恢复；删除先进回收站，不做不可逆的裸删。

- **已归档会话视图**：面板内「归档」域一屏列出所有已归档会话，按工作区分组与计数。
- **按工作区搜索**：工作区 chip + `工作区:` 前缀 + 标题/路径子串过滤，几十个工作区也能秒筛。
- **恢复与删除**：恢复＝取消归档（回到侧栏）；删除＝先归档 → 搬进回收站 → 摘掉 uuid 记账，可随时还原。
- **回收站与周期压缩**：`trash` 搬进 `~/.dsh/trash/manage-session/<批次>/`，`compact` 按天/周/月合并成 `.tar.zst`，`restore` 原样搬回。
- **收藏与批量操作**：星标收藏、只看收藏、批量归档与批量删除（两步确认）。
- **首屏秒回 + 四门体检**：零 I/O 标题源 + 分帧流式补齐（252 会话首屏 373 ms）；日志完整性 / 投影缓存 / 无损 JSON / 冷读收尾四项体检。

## 界面预览

![管理台：按工作区分组、勾选批量操作](assets/new-manager.png)

![归档视图：已归档会话集中管理](assets/old-archive.png)

![旧版侧栏：入口位次对比](assets/left-sidebar-old.png)

## 安装

**宿主支持**：`engines.dsh` 为 `>=0.1.0-rc.2 <0.3.0-0`，`0.1.x` 与 `0.2.x` 双线已验证。

### 让 Agent 帮你安装（推荐）

```text
请把 dsh-manage-session 最新版安装到我当前使用的 DSH profile，使用官方 npm 源，安装后确认版本并告诉我如何重新加载。
```

### 手动安装 / 更新

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

安装后重启 DSH（宿主插件在启动时加载），再刷新界面即可看到「会话管理」入口。

## 插件配置

设置命名空间 `manage-session`：

- `enabled` (`true`) — 总开关；关闭后管理台与所有 fenced 路由都不注册
- `historyFiles` (`true`) — 归档 / 取消归档 / 删除（回收站）三条写路
- `healthCheck` (`true`) — 四门体检与修复处方
- `directDelete` (`false`) — 侧栏会话菜单是否出现「删除」行（默认关）

**入口位次**：宿主提供侧栏顶部工具槽位时落在「插件」行之后，否则回落底栏。

## 使用指南

- **归档会话** — 勾选后点「归档」，侧栏立即不可见；活跃会话会自动先停活动再归档。
- **恢复会话** — 在「归档」域勾选后点「取消归档」，会话回到原工作区。
- **删除会话** — 点「删除」两次确认；会话先进回收站，uuid 立刻从记账里摘除。
- **搜索工作区** — 点工作区 chip，或在搜索框输入 `工作区:关键词`。
- **收藏 / 只看收藏** — 点星标收藏；视图菜单勾「只看收藏」。

## 归档、删除与清理（确定性脚本）

宿主关闭后跑脚本更彻底，脚本从不直接 `rm` 会话数据：

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list` 只读分类：`orphan-id`（记账有、盘上无）/ `empty-session` / `untitled-session` / `encoded-id` / `ok`。
- `trash` 搬进回收站并摘掉记账；`compact --window week` 按周期合并重压，并清空可直接恢复的散目录。
- `restore --archive <周期> [--ids ...]` 还原；`ledger` 是所有清理动作的 append-only 台账。
- **墓碑区**：`tombstones` 只看没删干净的（`pending-cleanup`），`forget` 撤掉实体已无的墓碑。

## 存储与路由

写入宿主文件前自动备份；不建立自己的会话索引，搜索能力由 `dsh-search-index` 提供。

- `~/.dsh/storages/workspace.json` — 归档集合与工作区成员（宿主文件）
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — 清理台账（append-only，逐条 uuid）
- `~/.dsh/trash/manage-session/` — 回收站：批次目录 + `archive/*.tar.zst`

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

## 注意事项

- 删除不可逆：回收站可还原，但 `compact` 之后需从 `.tar.zst` 还原；永久销毁批次要 `--yes`。
- 未命名 ≠ 删除残留：0 条消息的空会话与 `im:` 编码名会话本来就没有标题。
- 宿主在跑时脚本拒绝 `trash/compact/restore`（`--allow-running` 可显式跳过）。

## 常见问题

### 安装后找不到入口？

重启 DSH；确认装在当前 profile，且 profile 的 `cordis.patch.yml` 没有禁用 `dsh-manage-session`。

### 归档和删除有什么区别？

归档只是收起来，随时恢复；删除会移入回收站并摘除记账，压缩后仍可从归档还原。

### 能和别的归档插件共存吗？

可以。归档集合是宿主共享状态，两个插件读同一份数据，入口各自独立。

## 许可

本项目采用 [MIT License](LICENSE)。

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

