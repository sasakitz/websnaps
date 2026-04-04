# store/ — Chrome Web Store 申請資材

このディレクトリには Chrome Web Store への申請に必要な資材が含まれています。

## ファイル構成

```
store/
├── README.md                  このファイル
├── store-listing.md           ストアリスト文章（名前・説明・スクリーンショット仕様）
├── privacy-policy.html        プライバシーポリシー（GitHub Pages でホスト）
├── submission-checklist.md    申請チェックリスト・権限説明・審査対応ガイド
└── promo/
    ├── generate_promo.py      プロモーション画像ジェネレーター
    ├── promo_small.png        440×280 小プロモーションタイル（背景のみ）
    └── promo_marquee.png      1400×560 マーキータイル（背景のみ）
```

## クイックスタート

### 1. プライバシーポリシーを公開する
GitHub Pages を有効化（Settings → Pages → main ブランチ）後、以下のURLでアクセス可能:
```
https://sasakitz.github.io/websnaps/store/privacy-policy.html
```

### 2. 申請用 ZIP を作成する
```bash
# プロジェクトルートで実行
zip -r websnaps.zip . \
  --exclude "store/*" \
  --exclude ".git/*" \
  --exclude ".claude/*"
```

### 3. プロモーション画像を仕上げる
```bash
python3 store/promo/generate_promo.py
```
生成された PNG（背景のみ）に Figma / Canva 等でテキストを追加してください。

### 4. チェックリストに従って申請
`submission-checklist.md` の手順に従って申請してください。
