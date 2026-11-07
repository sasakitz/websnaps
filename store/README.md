# WebSnaps — CWS掲載・審査提出資材

WebSnaps 1.1.0向け。日本語の掲載文、実画面の掲載画像、プライバシーポリシー、審査フォーム入力内容とテスト手順、提出ZIPをまとめています。CWSへの提出自体は行っていません。

## 使うファイル

| 用途 | ファイル |
|---|---|
| **CWSにアップロードする拡張機能** | [dist/websnaps-1.1.0.zip](dist/websnaps-1.1.0.zip) |
| 資料をまとめて受け渡す | [dist/websnaps-1.1.0-submission-kit.zip](dist/websnaps-1.1.0-submission-kit.zip) |
| 掲載文・画像順・URL | [store-listing.md](store-listing.md) |
| プライバシー欄・権限理由 | [review/privacy-practices.md](review/privacy-practices.md) |
| 審査員向け説明と操作手順 | [review/reviewer-instructions.md](review/reviewer-instructions.md) |
| 公開するプライバシーポリシー | [privacy-policy.html](privacy-policy.html) |
| 提出手順・本人設定の残作業 | [submission-checklist.md](submission-checklist.md) |
| 検証済み範囲・制限 | [review/verification.md](review/verification.md) |
| ファイル別ハッシュと寸法検査 | [review/package-verification.json](review/package-verification.json) |
| 配布ZIPのSHA-256 | [dist/SHA256SUMS.txt](dist/SHA256SUMS.txt) |

`submission-kit.zip` は保管・受け渡し用です。Chromeウェブストアにアップロードするのは `websnaps-1.1.0.zip` のみです。ルートの `websnaps.zip` も同じ内容に更新しています。

## 画像

- `screenshots/01-selection.png` 〜 `05-popup.png`: 掲載順に5枚。1280×800 / RGB PNG。
- `assets/store-icon-128.png`: ストア用128×128。既存ロゴに透明余白を付与。
- `promo/promo_small.png`: 440×280 / RGB PNG。
- `promo/promo_marquee.png`: 1400×560 / RGB PNG。
- `assets/popup-raw.png`: 5枚目の元にした実際のポップアップ。単独ではストアにアップロードしません。
- `screenshots/demo-page.html`: 自作の架空ページ。撮影画像の再現・審査用。

以前の `ss1`〜`ss4` の古いPNGモックは削除し、参照用HTMLを現在の画像への案内に置き換えています。`ss4_popup.html` は5枚目の掲載レイアウトのソースです。

## 再生成

リポジトリのルートで実行します。Python 3、Pillow、websockets、Google Chrome（CDPの`Extensions.loadUnpacked`が利用できる版）が必要です。Fedoraに新規導入する場合は利用可能な現行RPMを優先してください。今回の作業では既存のインストールを使用しています。

```bash
node tests/background.test.js > store/review/background-tests.txt
node tests/editor.test.js > store/review/editor-tests.txt
python3 store/tools/render_assets.py
python3 store/tools/build_submission.py
```

`render_assets.py` は一時プロファイルでChromeを起動し、127.0.0.1のサンプルページを実際の拡張機能で撮影します。個人のブラウザプロファイルは使いません。画像とブラウザ検証JSONを生成し、一時プロファイルを削除します。`CHROME` 環境変数でChrome実行ファイルを指定できます。

`build_submission.py` は本体を明示的な許可リストでZIP化し、サイズ・説明文の一致・参照ファイル・ZIP内容を確認してから、提出資料一式とSHA-256を生成します。コードまたは資料を変更したら再実行してください。ツールの依存関係がない環境でも、完成済みZIPとPNGはそのまま使えます。

## 提出前の状態

2026-11-07に今回のプライバシーポリシーをGitHub Pagesへ公開しました。公開URLはHTTP 200で応答し、ローカルHTMLとのバイト単位の一致を確認済みです。公開コミット: `4ce858bc6721dae9fae7d8ac09926afa04f0173e`。

アカウント本人情報、配信設定、データ申告の最終宣誓、通常Chromeでの手動確認は [チェックリスト](submission-checklist.md) に残しています。
