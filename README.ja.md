<div align="center">

# dsh-manage-session

**セッションコンソール · アーカイブとゴミ箱 — アクティブ／アーカイブ済みセッションを一括管理**

[简体中文](README.md) · [English](README.en.md) · **日本語** · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> コミュニティが保守する DeepSeek Harness（DSH）プラグインです。DeepSeek AI 公式製品ではありません。

本文は **2.0.26** を説明しています。変更履歴は[こちら](CHANGELOG.md)。

## 機能概要

使わないセッションはアーカイブへ、必要ならいつでも復元。削除はゴミ箱経由で、取り返しのつかない削除はしません。

- **アーカイブ済みビュー**：パネル内の「アーカイブ」範囲で全アーカイブ済みセッションを一覧化し、ワークスペース別に集計。
- **ワークスペース検索**：ワークスペースチップ、`workspace:` 接頭辞、タイトル／パスの部分一致で数十のプロジェクトでも即絞り込み。
- **復元と削除**：復元＝アーカイブ解除（サイドバーに戻る）。削除＝アーカイブ → ゴミ箱へ移動 → 記帳から uuid を除去（復元可能）。
- **ゴミ箱と定期圧縮**：`trash` で `~/.dsh/trash/manage-session/<バッチ>/` へ移動し、`compact` が日／週／月単位で `.tar.zst` に統合、`restore` で戻せます。
- **お気に入りと一括操作**：スター、お気に入りのみ表示、一括アーカイブ／一括削除（二段確認）。
- **即時表示＋四門ヘルスチェック**：ゼロ I/O のタイトル源＋フレーム分割ストリーム（252 セッションで初回 373 ms）。ログ整合性／投影キャッシュ／可逆 JSON／コールドリードの四項目。

## 画面

![管理画面：ワークスペース別のグループと一括選択](assets/new-manager.png)

![アーカイブ表示：アーカイブ済みをまとめて管理](assets/old-archive.png)

![旧サイドバー：入口位置の比較](assets/left-sidebar-old.png)

## インストール

**ホスト対応**：`engines.dsh` は `>=0.1.0-rc.2 <0.3.0-0`。`0.1.x` と `0.2.x` の両系統で検証済み。

### Agent にインストールさせる（推奨）

```text
dsh-manage-session の最新版を、いま使っている DSH プロファイルへ公式 npm レジストリから導入し、バージョン確認と再読み込み方法を教えてください。
```

### 手動インストール／更新

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

導入後に DSH を再起動してください（ホストプラグインは起動時に読み込まれます）。画面を更新すると「セッション管理」入口が表示されます。

## 設定

設定名前空間は `manage-session`：

- `enabled` (`true`) — 全体スイッチ。無効にするとパネルと全 fenced ルートが登録されない
- `historyFiles` (`true`) — アーカイブ／解除／削除（ゴミ箱）の書き込み経路
- `healthCheck` (`true`) — 四門ヘルスチェックと修復処方
- `directDelete` (`false`) — サイドバーのセッションメニューに「削除」行を出すか（既定は無効）

**入口位置**：ホストがサイドバー上部ツール枠を提供すれば「プラグイン」行の直後、なければ下部へ。

## 使い方

- **セッションをアーカイブ** — 選択して「アーカイブ」。サイドバーから即座に消えます。実行中のセッションは活動停止後にアーカイブされます。
- **セッションを復元** — 「アーカイブ」範囲で選択し「解除」。元のワークスペースに戻ります。
- **セッションを削除** — 「削除」を二回押して確定。ゴミ箱へ移り、uuid は記帳から即座に外れます。
- **ワークスペース検索** — ワークスペースチップを押すか、検索欄に `workspace:キーワード`。
- **お気に入り** — スターで登録し、表示メニューの「お気に入りのみ」で絞り込み。

## アーカイブ・削除・クリーンアップ（決定的スクリプト）

ホスト終了後にスクリプトを実行すると完全です。スクリプトはセッションデータを直接 `rm` しません：

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list` は読み取り専用の分類：`orphan-id`（記帳のみ／実体なし）/ `empty-session` / `untitled-session` / `encoded-id` / `ok`。
- `trash` でゴミ箱へ移動し記帳を除去。`compact --window week` は期間単位で統合再圧縮し、直接復元できる散ディレクトリを空にします。
- `restore --archive <期間> [--ids ...]` で復元。`ledger` は全操作の append-only 台帳です。
- **墓碑エリア**：`tombstones` は削除しきれなかったもの（`pending-cleanup`）だけを表示し、`forget` は実体が無い墓碑を撤去します。

## 保存場所とルート

ホストファイルは書き込み前に自動バックアップ。独自のセッション索引は持たず、検索は `dsh-search-index` が担当します。

- `~/.dsh/storages/workspace.json` — アーカイブ集合とワークスペース所属（ホストファイル）
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — クリーンアップ台帳（append-only、uuid 単位）
- `~/.dsh/trash/manage-session/` — ゴミ箱：バッチディレクトリ＋`archive/*.tar.zst`

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

## 注意点

- 削除は最終的に不可逆：ゴミ箱から復元できますが、`compact` 後は `.tar.zst` から復元。バッチの完全破棄には `--yes` が必要です。
- 「未命名」は削除残骸ではありません：メッセージ 0 件の空セッションと `im:` 符号化 ID セッションは元からタイトルがありません。
- ホスト起動中はスクリプトが `trash/compact/restore` を拒否します（`--allow-running` で明示的に回避可）。

## よくある質問

### 導入後に入口が見えない

DSH を再起動し、現在のプロファイルに入っているか、`cordis.patch.yml` で `dsh-manage-session` を無効化していないか確認してください。

### アーカイブと削除の違い

アーカイブは収納だけでいつでも戻せます。削除はゴミ箱へ移し記帳も外しますが、圧縮後もアーカイブから復元できます。

### 他のアーカイブ系プラグインと併用できる？

可能です。アーカイブ集合はホスト共有状態で、両方が同じデータを読み、入口は独立します。

## ライセンス

本プロジェクトは [MIT License](LICENSE) です。

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

