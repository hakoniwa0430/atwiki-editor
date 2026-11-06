# インストールと使い方

## インストール

Node.js と npm を用意し、リポジトリのルートで VSIX を生成します。実行時ライブラリは同梱しているため、パッケージ生成に `npm ci` は不要です。

```sh
npm run package
code --install-extension atwiki-local-preview-1.0.0.vsix
```

VS Code の拡張機能画面から「VSIX からのインストール…」を選ぶこともできます。

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
