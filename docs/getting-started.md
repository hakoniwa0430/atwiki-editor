# インストールと使い方

## インストール

VS Code 1.92.0 以降で利用できます。配布された `atwiki-editor-1.1.0.vsix` を用意し、拡張機能画面の「…」→「VSIX からのインストール…」で選択します。この方法ではNode.jsとnpmは不要です。GitHub Releasesの1.1.0配布VSIXはWindows x64向けです。他のOS・CPUでは対応する環境でソースから生成してください。

配布ファイルは[GitHub Releases](https://github.com/hakoniwa0430/atwiki-editor/releases)に掲載されている場合にダウンロードできます。

### ソースから生成する場合

Node.js 20.9以降とnpmを用意し、利用するOS・CPUの環境で、リポジトリのルートからVSIXを生成します。WebP変換用の実行時ライブラリを先にインストールしてください。

```sh
npm ci
npm run package
code --install-extension atwiki-editor-1.1.0.vsix
```

### 既存バージョンの入れ替え

同じ拡張機能ID（`atwiki-local-tools.atwiki-local-preview`）のバージョンを入れ替える場合は、次のコマンドでVSIXを指定します。`code` コマンドを利用できない環境では、拡張機能画面から「VSIX からのインストール…」を選んでください。

```sh
code --install-extension atwiki-editor-1.1.0.vsix --force
```

## 使い方

1. Wiki 用のフォルダを VS Code で開き、`.atwiki`、`.atw`、`.txt` を編集します。
2. コマンドパレットから「アットウィキ: プレビューを横に開く」を実行します。
3. 言語モードが「アットウィキ」の場合は、`Ctrl+Alt+V`（macOS は `Cmd+Alt+V`）でも開けます。

プレビューは保存前の編集も反映します。`.txt` の構文強調には言語モードを「アットウィキ」に変更してください。補完候補は `Ctrl+Space` で呼び出せます。

記法の例は [基本サンプル](../output/サンプル_アットウィキ.txt) と [拡張記法サンプル](../output/拡張記法サンプル.txt) にあります。

[ドキュメント一覧](../README.md#ドキュメント)
