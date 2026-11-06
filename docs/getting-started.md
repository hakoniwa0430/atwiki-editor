# インストールと使い方

## インストール

VS Code 1.85.0 以降で利用できます。配布された `atwiki-local-preview-1.0.0.vsix` を用意し、拡張機能画面の「…」→「VSIX からのインストール…」で選択します。この方法ではNode.jsとnpmは不要です。

配布ファイルは[GitHub Releases](https://github.com/hakoniwa0430/atwiki-editor/releases)に掲載されている場合にダウンロードできます。

### ソースから生成する場合

Node.js と npm を用意し、リポジトリのルートで VSIX を生成します。実行時ライブラリは同梱しているため、パッケージ生成に `npm ci` は不要です。

```sh
npm run package
code --install-extension atwiki-local-preview-1.0.0.vsix
```

### 既存バージョンの入れ替え

同じ拡張機能ID（`atwiki-local-tools.atwiki-local-preview`）のバージョンを入れ替える場合は、次のコマンドでVSIXを指定します。`code` コマンドを利用できない環境では、拡張機能画面から「VSIX からのインストール…」を選んでください。

```sh
code --install-extension atwiki-local-preview-1.0.0.vsix --force
```

## 使い方

1. Wiki 用のフォルダを VS Code で開き、`.atwiki`、`.atw`、`.txt` を編集します。
2. コマンドパレットから「アットウィキ: プレビューを横に開く」を実行します。
3. 言語モードが「アットウィキ」の場合は、`Ctrl+Alt+V`（macOS は `Cmd+Alt+V`）でも開けます。

プレビューは保存前の編集も反映します。`.txt` の構文強調には言語モードを「アットウィキ」に変更してください。補完候補は `Ctrl+Space` で呼び出せます。

記法の例は [基本サンプル](../output/サンプル_アットウィキ.txt) と [拡張記法サンプル](../output/拡張記法サンプル.txt) にあります。

[ドキュメント一覧](../README.md#ドキュメント)
