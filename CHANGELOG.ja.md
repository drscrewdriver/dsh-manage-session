# Changelog

## 2.0.21

**修正：符号化 ID のセッション（`im:` / `imu:`）が削除しきれない（記帳は消えたのにディレクトリが残る）。**

- 原因：ホスト側が `session-` 接頭辞しか剥がしておらず、`im:` のディレクトリ名は `~XXXX` 符号化（例 `im~003A…~0040im.wechat`）のため位置を特定できず、後置検証も「削除済み」と誤判定。
- 修正：`encodeSegment` / `decodeSegment` をホスト側に追加し、ディレクトリ索引に 4 種類のキーを登録。`locateSessionUsage` と投影キャッシュファイル検索も候補で照合。
- 併せて `im:` セッションのタイトル読み取りも修正（キャッシュ名も符号化名のため従来は必ず miss）。

## 2.0.20

**クリーンアップコマンドを絶対パスの自動組み立てに変更：`node_modules/...` の固定記述も、profile への cd も不要。**

- ホスト側 `session-tombstones` が `scriptPath` を返すように：本パッケージの `lib/index.js` 位置から `../scripts/session-purge.mjs` を導出。
- パネルは返されたパスでコマンドを組み立て、空白を含む場合は自動で二重引用符を付与。古いホストでは相対パスにフォールバック。
- 文言を「profile で実行」から「直接実行（下記は現在のインストール先）」に変更。

## 2.0.19

**クリーンアップタブのコマンド表：各行に「読み取り専用 / 書き込み・復元可 / 破壊的」を明記し、説明を付けました。**

- 5 コマンドを `pre` にまとめるのをやめ（閲覧と削除の区別がつかないとの指摘）、1 行ずつ：**分類バッジ + コマンド + 説明 + 個別コピー**。
- 分類：`list` / `tombstones` / `ledger` = **読み取り専用**；`trash` / `compact` / `restore` = **書き込み・復元可**；`purge --batch --yes` = **破壊的**（復元不可）。
- 先頭に凡例を追加し、「すべてコピー」は維持。

## 2.0.18

**クリーンアップ領域をタブ化：管理画面の下部から「健診」の隣のバックグラウンドタブへ移動。**

- パネルは 3 タブ：**管理 / 健診 / クリーンアップ**。`historyFiles=false` でクリーンアップタブを、`healthCheck=false` で健診タブを隠します。
- タブ内容：削除しきれなかった項目の一覧 + 再試行削除 / 墓碑の取り消し + 5 コマンドの一括コピー + 台帳パス（DSH 終了後に実行する旨を明記）。
- 独立コンポーネント `cleanup-panel.tsx`（自前スタイル）に分離：タブ切替で管理画面のアンマウントに影響されず、管理画面はセッション一覧だけに戻ります。

## 2.0.17

**管理画面に「クリーンアップ領域」を追加：削除しきれなかったものが見え、その場で処理でき、削除コマンドもコピーできます。**

- パネル下部に「クリーンアップ領域」：`session-tombstones` は**削除しきれなかったもの**（`pending-cleanup` / 無効な墓碑）だけを返し、uuid・理由・状態を行表示します。
- 行内の操作：**再試行削除**（purge を再利用：アーカイブ → detach → 削除 → 後置検証）と**墓碑の取り消し**（実体が無い場合のみ表示、host 側でも再検証）。
- コマンドをコピー可能（`list / trash / compact / tombstones / ledger` の 5 行、DSH 終了後に profile で実行する旨を明記）。台帳パスも表示します。
- 新メソッド：`session-tombstones`（読み取り専用）と `session-tombstone-forget`（書き込み、実体が残っていれば拒否）。`historyFiles` スイッチ配下。

## 2.0.16

**README を単一ソース生成に再構成（10 言語）＋ワークスペース検索の接頭辞＋ archive キーワードの兵兼。**

- README は `docs/readme/i18n.mjs`（文言）と `scripts/gen-readme.mjs`（骨格）から生成；`scripts/check-readme.mjs` でバージョン一致・見出し同型・archive キーワード・リンク・files ホワイトリストを検査（`prepublishOnly` に接続）。
- 検索欄で `工作区:` / `workspace:` 接頭辞に対応（半角/全角コロン）。cwd のみを対象とし、それ以外はタイトル/パスの部分一致。
- `description` / `keywords` / `dsh.plugin.json` を archive・アーカイブ済み・ゴミ箱・restore を含む文言に統一（パッケージ名変更やエイリアスパッケージは行わない）。
- **墓碑の永続化＋冷再利用プローブ**：削除結果を `~/.dsh-manage-session-index/retired-tombstones.jsonl` に（createdAt/cwd/state 付きで）記録。`deleted` は再起動後も非表示、同 id でも身元が違えば新セッションと判断して墓碑を取り消します。
- **削除後の後置検証**：本当に削除できたものだけ `deleted`。ディレクトリ/キャッシュが残存する場合は `pending-cleanup`（**非表示にしない**）とし、パネルに「未完全削除 N 件」と表示。
- **墓碑エリアの清掃**：スクリプトに `tombstones`（未完全削除のみ表示）と `forget`（実体が無いもののみ許可）を追加。`trash` 成功と `restore` は対応する墓碑を自動で取り消します。

## 2.0.15

**決定的なクリーンアップスクリプト（ゴミ箱版。「ファイルを消したのに uuid が残る」幽霊行の修正）。**

- `scripts/session-purge.mjs` を追加：ホスト終了後に実行し、**セッションデータを直接 rm しない** —— `list`（読み取り専用の分類：`orphan-id` / `empty-session` / `untitled-session` / `encoded-id` / `ok`）→ `archive`（アーカイブ集合に書き込み、再検証）→ `trash`（セッションディレクトリと投影キャッシュを `~/.dsh/trash/manage-session/<batch>/` へ丸ごと移動し、`manifest.json` を残す。その後記帳から uuid を外す）→ `compact`（期間 day/week/month で期限切れバッチを一つの `archive/<期間>.tar.zst` に統合再圧縮し、直接復元できる散ディレクトリを空にする）→ `restore`（ゴミ箱またはアーカイブからそのまま戻す）→ `ledger`（append-only 台帳：uuid / cwd / バイト数 / sha256）。
- 順序は「アーカイブ → 再検証 → ファイル移動 → 記帳整理」で固定。どの段で失敗しても再実行できる状態で止まる；`purge` は実体の無い幽霊 uuid 専用、バッチの永久破棄は `purge --batch <名> --yes`。
- ホストプロセスが動いていれば trash/compact/restore を拒否（`--allow-running` で明示的に無効化可）。移動対象は `<dshHome>/sessions/<workspace>/<session>/` の直接の子のみ。
- セッション id ↔ ディレクトリ名の双方向エンコード（`~XXXX`）に対応：`im:` 仮想セッションも一覧・ゴミ箱行き・復元ができる。

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
