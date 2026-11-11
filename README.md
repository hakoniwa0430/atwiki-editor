# Atwiki Editor

アットウィキ記法の編集・ライブプレビューに対応した非公式の VS Code 拡張機能です。対象は VS Code 1.92.0 以降です。

## インストール

配布された `atwiki-editor-1.1.1.vsix` を、VS Codeの拡張機能画面の「…」→「VSIXからのインストール…」で選びます。VSIXからの導入にはNode.jsやnpmは不要です。1.1.1の配布VSIXはWindows x64向けです。配布ファイルは[GitHub Releases](https://github.com/hakoniwa0430/atwiki-editor/releases)に掲載されている場合にダウンロードできます。

ソースから生成する場合は、Windows x64でNode.js 20.9以降、npm、Python 3.11以降を用意して以下を実行します。WebP変換用の実行時ライブラリを同梱し、対応ソースZIPも生成します。他のOS・CPU向けの配布では、その環境用の[ライセンス・ソースマニフェストの整備](docs/third-party-licenses.md)が必要です。

```sh
npm ci
python scripts/third-party-sources.py --download
npm run package
code --install-extension atwiki-editor-1.1.1.vsix
```

使い方は[インストールと使い方](docs/getting-started.md)を参照してください。本家アットウィキの完全互換ではありません。外部コンテンツの通信設定と埋め込みの制限は[設定](docs/settings.md)および[リリースノート](docs/release-notes.md)に記載しています。

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
- [Wikiとの接続・同期・投稿](docs/wiki-sync.md)
- [記法の対応状況](COMPATIBILITY.md)
- [リリースノート](docs/release-notes.md)

## ライセンス

本体は [MIT License](LICENSE) です。同梱ライブラリにはそれぞれのライセンスが適用されます。[同梱ソフトウェアのライセンスと対応ソース](docs/third-party-licenses.md)、`vendor/` 内のライセンス本文、および [PROVENANCE.txt](vendor/PROVENANCE.txt) を参照してください。画像処理ライブラリの対応ソースZIPは、配布時にVSIXと同じリリースへ掲載します。

## 不具合報告

[GitHub Issues](https://github.com/hakoniwa0430/atwiki-editor/issues)に、OS・VS Codeと拡張機能のバージョン・再現手順・期待する表示と実際の表示を記載してください。再現用のWiki記法は、個人情報や非公開情報を除いた最小限の内容にしてください。
