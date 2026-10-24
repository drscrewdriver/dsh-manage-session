# Changelog

## 1.0.0

`dsh-session-steward` 0.5.7 から複製・改名した独立パッケージの初版です（旧パッケージの履歴は
そのリポジトリの CHANGELOG を参照）。本パッケージの位置づけは**セッションマネージャー**：
アクティブ／アーカイブ済みセッションの統合管理と全文検索。

### 位置づけと命名

- パッケージ名 / プラグイン id：`dsh-session-steward` → `dsh-manage-sessions`。表示名：セッション管理（9 言語同期）。
- 設定名前空間：`session-steward` → `manage-sessions`、`switch-search` → `manage-sessions-search`。
- ルート接頭辞：`/session-steward/api` → `/manage-sessions/api`、`/switch-search/api` → `/manage-sessions-search/api`。
- ストレージ：索引・墓碑の既定ディレクトリ `~/.dsh-switch-search` → `~/.dsh-manage-sessions-index`、
  お気に入り `session-steward-favorites.json` → `manage-sessions-favorites.json`（旧パッケージと干渉しません）。
- スタイル接頭辞 `dss_`/`dsws_` → `dms_`/`dmss_`。スタイルシート id と data 属性も改名。

### 新規：入口の位置（上部ツール枠 / 下部フォールバック）

- ホストが上部ツール行（`sidebar.panellist` パネル行 + `main` ページ枠）を宣言している場合、
  検索と管理の 2 つの入口を**パネル行**として「プラグイン」行の直後、「その他」ランチャーの手前
  （order 5 / 6）に配置し、クリックでメイン列に全ページ表示。ページ内「閉じる」で会話に戻ります。
- その枠が無いホスト（旧ライン／簡易レイアウト）ではサイドバー下部（`sidebar.footer.action`）に
  フォールバックし、フローティングダイアログを開きます。
- 判定はロード時（`slots.specDynamic` で両席を確認）。枠が後から現れた場合は下部入口を外して上部へ切替。
- パネル行／ページは設定スイッチ（`enabled` / `search` / `healthCheck`）に連動し、切替は即時反映。

### 付随変更

- パネルに全ページ形態（`variant: 'page'`）を追加：遮罩と浮動配置を外しメイン列を埋めます。ダイアログ形態は不変。
- ドキュメント刷新：README / INSTALL を 4 言語で同期（位置づけ・入口・ルート・設定表）。互換節は
  `scripts/sync-hosts.mjs` の単一ソース生成のまま。
- 対応ホストのホワイトリストは不変：`engines.dsh` は 0.1.0-rc.2 〜 0.2.1-rc.3 の rc 列挙。
