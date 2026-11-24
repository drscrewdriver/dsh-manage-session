# Changelog

## 2.0.14

**管理台のインタラクションを三つ修正（ユーザー報告）。**

- **一括操作バーがフローティング操作に隠れない**：下端の全幅バー（ボタンが右端に押される）から、左下に浮くカードへ変更（`batchInfo` を `flex:0 1 auto` に、ボタンは「N 件選択」の直後）。10px 上に上げて枠線と影を付け、右下の表示切替（セグメント/カード/折りたたみ）と重ならない。
- **ダブルクリックで開く、シングルクリックは選択のみ（誤タップ防止）**：行のクリックではもうセッションを開きません — シングルクリックはカードを選択するだけ、開くにはダブルクリック（またはキーボードの Enter／スペース）。実際に開くときは先にパネルページを閉じ（`layout.selectPanel(null)`）、次のフレームで `uiWorkspace.openSession` に渡します（ホストが「セッションを先に切替、最後にパネルを閉じる」ために最初のクリックが無効になっていた問題を回避）。
- **ナビゲーションの耐障害性（異常に飛ばされない）**：ナビゲーションサービス不在／セッション削除済み／サービス例外は、パネル内のエラー帯（`manage.open.failed`：「{id}」を開けません：理由）に変換され、手動で閉じられます。パネル・選択・スクロール位置は保持されます。

## 2.0.13

**初回表示の即時化＋タイトルのフレーム単位ストリーミング補完。**

- `session-catalog` は `sessionQuery.readTitleSnapshots`（ログ全体を展開して最後のタイトルを fold する契約。実測 252 セッション / 858 MB / 12.4 秒）を呼ばなくなりました。タイトルは I/O 不要の 3 段階で解決します：アクティブセッションのライブ投影 → `sessionProjectionCache` の checkpoint → セッション単位のキャッシュファイル。どれも外れた場合だけ `pending` になります。実測：243/252 は初回応答でタイトルあり（3 サービス全て不在でキャッシュファイルのみの場合でも 373 ms）、`pending` は 9 件。
- fenced メソッド **`session-catalog-stream`** を追加（`text/event-stream`、POST のみ）：`pending` を DRS 流の**フレーム単位**で読みます — 先頭 256 KB の窓から、`session/title` を含むフレームが出るまでだけ展開し、フレームごとに `await`（スレッドプール）し８フレーム毎に制御を戻します。窓は ×4 で 8 MB / 32 フレーム / 8 秒の予算まで。実測：9 件中 5 件を 558 KB・35 フレーム・26 ms で補完、最終カバレッジ 248/252（残り 4 件は本当に `session/title` を持たない）。
- `titleSource` フィールドを追加：`live` / `cache` / `pending` / `none`（旧クライアントは無視可）。
- 中止可能：パネルを閉じる / クライアント abort → `req|res.close` で `AbortController` が発火し、ホストは即座に読み取りを停止します（`aborted after N frames`）。
- プロセス内タイトル memo（TTL 5 分、`live` は入れず、`none` は否定結論として保持）。クリーンアップ後は id 単位、アーカイブ／解除後は全件無効化。
- ついでの修正：`runtime.sessionQuery` を遅延 getter に（サービスの後乗せで永遠に `undefined` になっていた）。

## 1.0.0

`dsh-session-steward` 0.5.7 から複製・改名した独立パッケージの初版です（旧パッケージの履歴は
そのリポジトリの CHANGELOG を参照）。本パッケージの位置づけは**セッションマネージャー**：
アクティブ／アーカイブ済みセッションの統合管理と全文検索。

### 位置づけと命名

- パッケージ名 / プラグイン id：`dsh-session-steward` → `dsh-manage-session`。表示名：セッション管理（9 言語同期）。
- 設定名前空間：`session-steward` → `manage-session`、`switch-search` → `manage-session-search`。
- ルート接頭辞：`/session-steward/api` → `/manage-session/api`、`/switch-search/api` → `/manage-session-search/api`。
- ストレージ：索引・墓碑の既定ディレクトリ `~/.dsh-switch-search` → `~/.dsh-manage-session-index`、
  お気に入り `session-steward-favorites.json` → `manage-session-favorites.json`（旧パッケージと干渉しません）。
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
