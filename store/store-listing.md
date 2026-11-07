# WebSnaps — Chrome ウェブストア掲載情報

対象: manifest 1.0.7 / 日本語UI。2026-11-07作成。ZIPの名前・短い説明は manifest.json から読み込まれます。

| 入力欄 | 入力内容 |
|---|---|
| 名前 | WebSnaps |
| プライマリ言語 | 日本語 |
| カテゴリ | 生産性（ダッシュボードに下位分類がある場合は「ツール」に相当する分類） |
| ホームページ | https://github.com/sasakitz/websnaps |
| サポートURL | https://github.com/sasakitz/websnaps/issues |
| プライバシーポリシーURL（2026-11-07公開・一致確認済み） | https://sasakitz.github.io/websnaps/store/privacy-policy.html |
| 価格 | 無料。アカウント登録・ログイン・課金なし |

URLの到達性と公開内容は提出直前に確認してください。英語説明を追加しても拡張機能UIは日本語です。下記の英語版は掲載文の追加ローカライズ用です。

## 短い説明（manifest.json と一致・132文字以内）

```text
Webページを範囲選択・要素選択・ページ全体で撮影。矢印やテキスト、ぼかしで編集し、PNG / JPG保存やクリップボードへのコピーができます。
```

## 日本語の詳細説明（貼り付け用）

```text
WebSnaps は、Webページのスクリーンショットを撮影し、その場で編集・保存できる Chrome 拡張機能です。資料作成や不具合報告、デザインの確認など、画面の情報をわかりやすく伝える作業に使えます。

【撮影方法を選べる】
・範囲選択：ドラッグで必要な部分を指定。ハンドルや幅・高さの数値入力で調整できます。
・要素選択：ページ上の要素にカーソルを合わせて選択できます。
・表示範囲：現在見えている範囲を撮影します。
・ページ全体：自動スクロールして縦に長いページを1枚の画像に結合します。

【撮影したら、すぐに編集】
撮影後は新しいタブにエディタが開きます。
・ペン、直線、矢印でポイントを強調
・四角形、楕円、塗りつぶしで囲みやハイライトを追加
・テキストで注釈を記入
・ぼかし、モザイクで見せたくない部分を加工
・切り抜きで不要な周囲をトリミング
・消しゴムで画像の一部を透明化
・元に戻す／やり直す（最大50段階。画像サイズに応じて履歴数を調整）

【保存・コピー】
PNG または JPG で端末に保存できます。クリップボードへのコピーはPNG画像です。保存形式の設定は端末内に保持されます。

【ショートカット】
Windows / Linux：Alt+Shift+S（範囲選択）、Alt+Shift+V（表示範囲）、Alt+Shift+F（ページ全体）
macOS：Command+Shift+S / V / F
Chrome の拡張機能ショートカット設定で変更できます。他の機能と競合する場合は再設定してください。

【端末内で処理】
撮影・編集はブラウザ内で行い、画像を開発者や外部サーバーに送信しません。撮影画像はエディタへの受け渡しと再読み込みのため端末内に一時保存し、編集タブを閉じると削除します。再読み込みで元の撮影画像を読み直すため、編集中の変更は保存してからタブを閉じてください。
アカウント登録、広告、アクセス解析はありません。

【ご利用上の制限】
Chrome の内部ページや Chrome ウェブストアなど、ブラウザが撮影・スクリプト実行を制限するページでは一部またはすべての機能を利用できません。
無限スクロール、埋め込みスクロール領域、動画、レイアウトが変化し続けるページでは、ページ全体を完全に再現できない場合があります。撮影中はタブを切り替えず、ページの読み込みが落ち着いてから操作してください。
ぼかし・モザイクの結果は共有前に確認してください。

操作画面は日本語です。
サポート：https://github.com/sasakitz/websnaps/issues
```

## 英語の詳細説明（追加掲載文用）

```text
WebSnaps captures, annotates and saves screenshots of web pages. The extension interface is in Japanese.

CAPTURE
• Select an area by dragging; adjust it with handles or exact width and height values.
• Select a page element by hovering over it.
• Capture the visible viewport.
• Capture a full page by automatically scrolling and stitching images.

EDIT
A built-in editor opens in a new tab after capture. Add pen strokes, lines, arrows, rectangles, ellipses and text. Use blur, mosaic, crop, eraser and shape fills. Undo and redo support up to 50 steps, adjusted to image size.

SAVE
Save as PNG or JPG, or copy a PNG image to the clipboard. Your preferred save format is stored locally.

SHORTCUTS
Windows / Linux: Alt+Shift+S (area), V (visible area), F (full page).
macOS: Command+Shift+S / V / F.
You can change these in Chrome's extension shortcut settings.

LOCAL PROCESSING
Screenshots are processed on your device and are not uploaded to the developer or an external server. Original captures are temporarily stored in the browser for editor handoff and reload, and removed when the editor tab closes. Reloading restores the original capture, so save your edits before closing the tab. No sign-in, ads or analytics.

LIMITATIONS
Chrome restricts some or all capture features on internal pages and the Chrome Web Store. Infinite scrolling, nested scroll areas, video and continuously changing layouts may not be reproduced completely. Keep the source tab active while capturing. Check blur and mosaic results before sharing.

Support: https://github.com/sasakitz/websnaps/issues
```

## 掲載画像（この5枚を順にアップロード）

| 順番 | ファイル | 内容 |
|---|---|---|
| 1 | screenshots/01-selection.png | 実装の矩形選択とW/H調整・撮影ボタン |
| 2 | screenshots/02-element.png | 実装の要素ホバー選択 |
| 3 | screenshots/03-editor.png | 実装のエディタで矢印・文字・囲みを追加 |
| 4 | screenshots/04-fullpage.png | 実際に結合した長いページをエディタで表示 |
| 5 | screenshots/05-popup.png | 実際のポップアップ画面を説明文と合成 |

各1280×800、RGB PNG（アルファなし）。サンプルページは自作・架空の内容です。5枚目以外は実画面の直接撮影です。
任意のプロモーション画像: `promo/promo_small.png`（440×280）、`promo/promo_marquee.png`（1400×560）。動画は用意していません（任意）。
ストアアイコン: `assets/store-icon-128.png`（128×128、透過余白付き）。ZIP内アイコンも同じブランドです。

画像仕様の根拠: [公式画像ガイド](https://developer.chrome.com/docs/webstore/images)。短い説明は[パッケージ準備ガイド](https://developer.chrome.com/docs/webstore/prepare)に基づきmanifestと同期しています。
