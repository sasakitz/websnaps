# Privacy practices — ダッシュボード入力資料

対象: WebSnaps 1.0.7 / manifest.jsonの権限を変更せず提出する場合。実装確認日: 2026-11-07。

## 単一目的（貼り付け用）

```text
ユーザーが指示したWebページのスクリーンショットを撮影し、ブラウザ内のエディタで注釈・画像加工を行い、PNG/JPG保存またはクリップボードへのコピーで出力すること。
```

## 権限の理由（各欄へ貼り付け）

### activeTab

```text
Provides temporary access to the active page after the user invokes WebSnaps from the toolbar or a keyboard shortcut. Used to capture the visible tab and access the page for user-requested screenshots. Captures are not started automatically during ordinary browsing.
```

### scripting

```text
Injects the bundled selection UI (content/selector.js and selector.css) into the user-selected page. It reads DOM element bounds for element selection. For full-page capture, bundled functions read page dimensions and computed styles, scroll the page, temporarily adjust fixed/sticky elements and restore the original styles and scroll position. No scripts are downloaded or executed from a server.
```

### clipboardWrite

```text
Writes the edited screenshot as a PNG image to the system clipboard only when the user clicks Copy in the editor. The extension does not read the clipboard.
```

### storage

```text
Stores the preferred PNG/JPG output format locally using chrome.storage.local (format and pendingFormat). Screenshot handoff data are stored separately in the extension's IndexedDB. No chrome.storage.sync or cloud storage is used.
```

### tabs

```text
Reads the target tab URL to identify pages where script injection is restricted. On service-worker startup, the extension queries open tabs and inspects their URLs to find its own editor pages and retain only the temporary captures still in use. It also removes a capture when its editor tab closes. Tab URLs are processed locally and are not saved as a browsing history or transmitted externally. This permission is for tab URL inspection, not merely for opening an editor tab.
```

### ホスト権限 &lt;all_urls&gt;

```text
The current package requests host access to capture pages chosen by the user and to inject the bundled selection and full-page capture scripts on those pages. It is used for chrome.tabs.captureVisibleTab and chrome.scripting operations. DOM geometry, computed styles and scroll dimensions are read for selection and stitching. No manifest content script runs automatically on every site, and no screenshot or page data is sent to the developer or an external server. Chrome's protected pages remain restricted.
```

広域ホスト権限は審査で追加説明・削減を求められる可能性があります。「ページ内容を読み取らない」「UI挿入に絶対に必須」とは説明しません。`activeTab`を使った権限縮小は可能性がありますが、今回の資材作成では撮影・再起動時の挙動を変更しないためmanifestの権限を維持しています。審査で削減を求められた場合は、実装・実ブラウザテスト・ポリシー・本資料を合わせて更新し、再梱包してください。

## リモートコード

選択: **No, I am not using remote code.**

```text
All executable JavaScript and styles are bundled in the uploaded ZIP. There are no remote scripts, dynamic code downloads, eval, new Function, analytics SDKs or remotely hosted WebAssembly. importScripts only loads the bundled shared/capture-store.js.
```

## データ使用の申告

「外部送信しない」だけを理由に全項目を未選択にしないでください。公式FAQは端末内のみの処理も開示対象としています。以下は実装上のローカルな取り扱いに基づく入力案です。ダッシュボードで表示される各項目の定義と最終照合して入力します。

| データ分類 | 入力案 | 根拠 |
|---|---|---|
| ウェブサイトのコンテンツ / Website content | 選択 | ページの画像、要素の位置・サイズ、表示スタイルを撮影・編集に利用 |
| ウェブ履歴 / Web history | 選択 | 撮影対象URLと、起動時に開いているタブのURLを参照。履歴の保存・送信はなし |
| ユーザーのアクティビティ / User activity | 選択 | 範囲選択中のマウス・キー操作をローカルで処理。通常閲覧時の行動追跡はなし |
| 個人を特定できる情報、健康情報、財務・支払い情報、認証情報、個人的コミュニケーション、位置情報 | 専用の取得・抽出はなし | 任意ページの撮影画像に含まれる可能性はあるため、ポリシーで明示。これらを画像に含むこと自体を該当とするフォーム定義であれば、対応する項目も選択する。構造化した収集・販売はしない |

上記は「収集なし」という申告ではありません。画像に写り込む情報を含め、端末内だけで処理する旨をポリシーおよび審査コメントで補足します。

## データ使用の3つの宣誓

実装上、以下はいずれも該当するためチェックできます。提出者本人が内容を確認して宣誓します。

- ユーザーデータを承認された用途以外で第三者に販売・移転しない。
- 単一目的と無関係な目的で利用・移転しない。
- 信用力の判定または融資目的で利用・移転しない。

プライバシーポリシーURL候補: https://sasakitz.github.io/websnaps/store/privacy-policy.html
公開前のローカルHTMLはURL欄の代わりになりません。

## 実装との対応

| 処理 | 実装 |
|---|---|
| ユーザー起動・撮影・自動スクロール・URL判定 | background.js |
| 起動時のタブ照合・閉じた編集タブの画像削除 | background.js: captureCleanup / tabs.onRemoved |
| 要素選択・矩形選択・選択中の入力処理 | content/selector.js |
| 一時画像の保存・削除・prune | shared/capture-store.js |
| 形式設定 | popup/popup.js、editor/editor.js |
| 元画像の再読み込み・画像加工・ファイル出力・コピー | editor/editor.js |

## 参考（2026-11-07確認）

- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [User Data FAQ: ローカル処理も開示対象](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [activeTabによる一時アクセス](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Tabs APIとtabs権限の違い](https://developer.chrome.com/docs/extensions/reference/api/tabs)
