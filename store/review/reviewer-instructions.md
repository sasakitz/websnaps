# 審査担当者向け説明 / Reviewer instructions

Version: 1.1.0. No account, password, license key, payment or backend service is required. The UI is in Japanese. No additional hardware is needed.

## 審査フォーム「テスト手順」貼り付け用（英語）

```text
WebSnaps captures, edits and exports web-page screenshots. There is no sign-in, payment or server dependency. The interface is in Japanese.

1. Open a regular HTTPS page such as https://example.com. Click the WebSnaps toolbar icon (pin it from the Extensions menu if necessary).
2. Choose 範囲選択 (Area selection). Drag a rectangle. Resize it with the handles or W/H inputs. Click キャプチャ (Capture), or press Enter. A new editor tab opens with only the selected area. Esc cancels selection.
3. For element selection, start 範囲選択 again, choose 要素選択 in the top toolbar, hover over a page element, click to select it, then click キャプチャ.
4. For a visible screenshot, open the popup on the source page and choose 表示範囲.
5. For full-page capture, use a vertically scrollable HTTPS page and choose ページ全体. Keep the source tab active and do not scroll while capture runs. The editor opens with a stitched image; the source page's scroll position and styles are restored afterward.
6. In the editor, try 矢印 (Arrow), テキスト (Text), ぼかし (Blur), モザイク (Mosaic) and 切り抜き (Crop). Undo/redo controls are at the top. To enter text, click the image, type, and click outside the text box or press Ctrl+Enter (Command+Enter on macOS). Confirm a crop with Enter.
7. Select PNG or JPG and click 画像を保存 (Save image). A file is downloaded. Click コピー (Copy) to copy a PNG image and paste into a compatible image application.
8. Close the editor tab. Its temporary original capture is removed from IndexedDB. After abnormal browser shutdown, orphaned captures are pruned at the next service-worker startup. Reloading an editor reloads the original capture; unsaved edits are held only in memory.

Default shortcuts: Windows/Linux Alt+Shift+S, V, F; macOS Command+Shift+S, V, F. Conflicts can be resolved at chrome://extensions/shortcuts.

All capture/edit processing is local. Original screenshots and capture metadata are temporarily stored in the extension's IndexedDB. Format preferences are in chrome.storage.local. Tab URLs, DOM bounds, computed styles and selection input are processed locally for capture and cleanup. No screenshot, browsing data or telemetry is sent to us or any server. No remote code is used. The host permission is used by the bundled capture and selection scripts; there is no automatically injected manifest content script.

Chrome internal pages and the Chrome Web Store restrict injection/capture. Please test on an ordinary HTTPS page. Infinite scrolling, nested scroll areas and continuously changing pages may not produce a complete full-page image. Capturing is user initiated; there is no background browsing recorder.
```

## 日本語の操作対応表

| 日本語UI | 英語 |
|---|---|
| 範囲選択 / 矩形選択 | Area / Rectangle selection |
| 要素選択 | Element selection |
| 表示範囲 | Visible viewport |
| ページ全体 | Full-page capture |
| キャプチャ | Capture selection |
| 矢印 / テキスト | Arrow / Text |
| ぼかし / モザイク | Blur / Mosaic |
| 切り抜き | Crop |
| 画像を保存 / コピー | Save image / Copy PNG |

## 再現用サンプルページ（添付可能）

`store/screenshots/demo-page.html` は外部依存のない自作ページです。機密データや実在の顧客情報を含みません。実行例:

```bash
# リポジトリまたは提出資料一式のルートで実行
python3 -m http.server 8765 --bind 127.0.0.1
```

Chromeで `http://127.0.0.1:8765/store/screenshots/demo-page.html` を開きます。ファイルURLへのアクセス許可は不要です。スクロールした末尾は「End of page」です。

掲載画像はこのページと実際の拡張機能から作成しています。5枚目は実際のポップアップ画像に説明文を添えた掲載用レイアウトです。

## 補足・問い合わせ

- 権限別の説明とデータ分類は `privacy-practices.md`。
- 検証済み範囲と未実施項目は `verification.md`。
- サポートURL候補: https://github.com/sasakitz/websnaps/issues （提出前に到達性を確認）。
- 審査担当者への連絡先メールはCWSデベロッパーアカウントで設定した本人確認済みアドレスを使用します。実在しないメール・テストアカウントは作成していません。
