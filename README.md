# Atwiki Editor

アットウィキ記法の編集・ライブプレビューに対応した非公式の VS Code 拡張機能です。対象は VS Code 1.85.0 以降。開発には Node.js と npm を使用します。

## インストール

リポジトリのルートで以下を実行します。VSIXの生成にはNode.jsとnpmが必要です。実行時ライブラリは同梱済みのため、生成前の `npm ci` は不要です。

```sh
npm run package
code --install-extension atwiki-local-preview-1.0.0.vsix
```

生成済みのVSIXがある場合は、VS Codeの拡張機能画面の「…」→「VSIXからのインストール…」からファイルを選んでもインストールできます。使い方は[インストールと使い方](docs/getting-started.md)を参照してください。

## 開発

```sh
npm ci
npm test
npm run check
npm run audit
```

| コマンド | 内容 |
| --- | --- |
| `npm test` | 自動テスト |
| `npm run check` | JavaScript 構文、JSON、同梱資産の確認 |
| `npm run audit` | 記法の分類と対応表の整合性確認 |
| `npm run audit:write` | 対応表の再生成 |
| `npm run format` / `npm run format:check` | Prettier による整形／確認 |
| `npm run package` | VSIX の生成 |

## ドキュメント

- [機能概要](docs/features.md)
- [インストールと使い方](docs/getting-started.md)
- [設定](docs/settings.md)
- [記法の対応状況](COMPATIBILITY.md)
- [リリースノート](docs/release-notes.md)

## ライセンス

本体は [MIT License](LICENSE) です。同梱ライブラリのライセンスと由来は `vendor/` 内の `*-LICENSE.txt` および [PROVENANCE.txt](vendor/PROVENANCE.txt) を参照してください。
