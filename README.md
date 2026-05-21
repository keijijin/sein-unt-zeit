# sein-unt-zeit（存在と時間 — じっくり読書室）

ハイデガー『存在と時間』を、§ごとのドイツ語テキスト・日本語訳・解説・用語集・FAQ とともに読む Web アプリです。

- **GitHub**: https://github.com/keijijin/sein-unt-zeit
- **公開サイト（OpenShift）**: https://web-app-sein-unt-zeit.apps.ocp.xflr6.sandbox2278.opentlc.com/

## 必要環境

- Node.js 20 以降推奨
- Python 3（原文 `de-sections.json` 抽出用）

## セットアップ

1. リポジトリを clone する。
2. 手元に入手した**正規の紙書または電子版**に従い、抽出用 PDF を `doc/Heidegger_Sein_und_Zeit.pdf` として配置する（著作権のため PDF はリポジトリに含めていません）。
3. リポジトリルートに `.env` を作成（`.env.example` を参考に `ANTHROPIC_API_KEY` を設定）。
4. 原文 JSON の生成: `python3 scripts/extract_de_sections.py`
5. フロント: `cd web && npm install && npm run dev`

## 主な npm スクリプト（`web` ディレクトリ）

| スクリプト | 内容 |
|------------|------|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（内的完結稿の同期を含む） |
| `npm run translate:ja` | §ごと日本語訳の生成 |
| `npm run overview:gen` / `overview:sync` | §解説の生成と `public` へのコピー |
| `npm run completion:gen` / `completion:sync` | 内的完結稿の生成と同期 |
| `npm run export:ja-txt` | 日本語訳を 10 節ずつ txt に分割出力 |

## OpenShift へのデプロイ

```bash
oc project sein-unt-zeit
oc apply -k deploy/openshift
oc start-build web --from-dir=. --follow
```

詳細は [deploy/openshift/README.md](deploy/openshift/README.md) を参照してください。

## ライセンス

本リポジトリの**コード・スクリプト・当プロジェクトが生成した解説テキスト等**のライセンスは、リポジトリに `LICENSE` が無い場合は未設定です。必要に応じて追加してください。  
ハイデガーの原著本文の複製・再配布は著作権に従ってください。
