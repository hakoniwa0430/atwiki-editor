# 同梱ソフトウェアのライセンスと対応ソース

Atwiki Editor 本体は MIT License です。同梱した第三者のコード、アイコン、フォント、画像処理ライブラリには、それぞれのライセンスが適用されます。本体の MIT 表記によって第三者のライセンスが置き換わることはありません。

## 表示用ライブラリ

| コンポーネント | ライセンス | 同梱資料 |
| --- | --- | --- |
| KaTeX 0.18.2 | MIT | `vendor/KATEX-LICENSE.txt` |
| highlight.js 11.11.1 | BSD-3-Clause | `vendor/HIGHLIGHT-LICENSE.txt` |
| QR Code Generator | MIT | `vendor/QRCODE-LICENSE.txt` |
| Font Awesome Free 6.7.2 | コード: MIT、アイコン: CC BY 4.0 | `vendor/FONT-AWESOME-LICENSE.txt` |

著作者、取得元、加工内容は `vendor/PROVENANCE.txt` に記載しています。

## Windows x64 の画像処理ライブラリ

sharp 0.35.5 は Apache-2.0 です。`@img/sharp-win32-x64` には libvips 8.18.7 と依存ライブラリが含まれ、LGPL-3.0-or-later、MPL-1.1、MIT、BSD 系などの条件が適用されます。上流が LGPL 2 / 2.1 の「以降の版」条項を使って LGPLv3 を選択しているコンポーネントは、その選択を引き継ぎます。

- コンポーネントごとの適用条件: `vendor/native-licenses/THIRD-PARTY-NOTICES.md`
- GPLv3、LGPLv3、MPL-1.1 の全文: `vendor/native-licenses/` の各 `.txt`
- 元ソースの著作権・ライセンス・特許表示: `vendor/native-licenses/UPSTREAM-NOTICES.txt`
- 配布元、版、ソースアーカイブの SHA-256: `vendor/native-licenses/sources.json`
- npm パッケージ自身のライセンス: `node_modules/` の各 `LICENSE` と `README.md`

ソース・告知集には、libvips の依存28件に加え、librsvg の Cargo.lock に記録された Rust クレートを収録しています。ビルド用・テスト用・別プラットフォーム用を含む一覧であり、全件が配布 DLL に組み込まれているという意味ではありません。各ソースに含まれるテストやツールのライセンスを、拡張機能本体に適用するものでもありません。

本プロジェクトでは上流の実行バイナリを変更していません。`libvips-42.dll` は公式の `vips-dev-x64-web-8.18.7-static.zip` 内の DLL と SHA-256 が一致することを確認しています。この「static」は依存ライブラリを libvips DLL に組み込むビルドを指します。拡張機能は sharp のネイティブモジュールから DLL を読み込みます。Windows の C++ バインディング DLL は sharp の `src/binding.gyp` によって別途ビルドされます。

## 対応ソースの入手

v1.1.1 の配布時には、VSIX と同じ [GitHub Release](https://github.com/hakoniwa0430/atwiki-editor/releases/tag/v1.1.1) に次の3ファイルを掲載します。ブランチ上での準備だけでは公開は行われません。

- `atwiki-editor-1.1.1.vsix`
- `atwiki-editor-1.1.1-third-party-sources.zip`
- `atwiki-editor-1.1.1-third-party-sources.zip.sha256`

ソース ZIP は、元のライブラリソース、Rust クレート、上流のビルド定義・パッチ、sharp 本体、ライセンス資料を含みます。ソースの取得に申請や追加料金は不要です。再配布者も対応するソースを一緒に提供してください。上流のプロジェクトトップページへのリンクだけを、対応ソースの代わりにしないでください。

## 再ビルドと DLL の差し替え

ソース ZIP の `sources/` にあるアーカイブを展開して使用します。ビルドツール、SDK、Node.js、Docker などの開発環境は別途必要です。完全なオフラインビルド環境ではありません。

1. `build-win64-mxe-v8.18.7.tar.gz`、`mxe-c36160b231e66e1cbe032ed54aef7617e8b259da.tar.gz` を展開します。MXE の基準コミットは `c36160b231e66e1cbe032ed54aef7617e8b259da` です。上流ビルド定義の `container/base.Dockerfile` にある MXE の clone をこのコミットに固定するか、同梱した MXE ツリーを使ってください。
2. `build-win64-mxe` の README と `build.sh --help` を確認し、Linux / Docker 環境で `./build.sh --without-prebuilt --target x86_64-w64-mingw32.static vips-web` を実行します。設定・パッチは同梱した `build/` と `container/` にあります。ソースキャッシュには同梱アーカイブを使えます。MXE の `pkg/` に置くファイル名とチェックサムは各 `.mk` を参照してください。
3. librsvg の Rust 依存は `.crate` として同梱しています。元の Cargo.lock 全体を保存しているため、上流パッチで除去される依存も含みます。上流のビルド定義が適用するパッチを保持してください。Cargo の vendor / ローカルレジストリ機能でこれらのソースを使用できます。
4. `sharp-libvips-v1.3.4.tar.gz` 内の `build/win.sh` が Windows 用ヘッダー・DLL を sharp 向けにまとめる手順です。変更した libvips を使用する場合は、この手順のダウンロードを手元で生成した ZIP に置き換えます。
5. `sharp-v0.35.5.tar.gz` 内の `.github/workflows/ci.yml`、`src/binding.gyp`、`install/build.js` が Windows のネイティブモジュールと C++ DLL のビルド手順です。対応する Node.js、Python、Visual Studio C++ Build Tools を用意し、上流の依存インストール後、`npm run build:dist`、`npm run build` を実行します。変更したヘッダー・ライブラリを sharp のビルド用 libvips パッケージに配置します。
6. VS Code を閉じてから、インストール先の `node_modules/@img/sharp-win32-x64/lib/` にある DLL / `.node` を互換性のある再ビルド品に置き換え、VS Code を起動します。元ファイルは退避してください。拡張機能には、変更したライブラリの使用を拒む署名検査・ハッシュ検査はありません。更新・再インストールで置き換わるため、再ビルド品は別途保存してください。

LGPL が認めるライブラリの変更、差し替え、およびその変更をデバッグするためのリバースエンジニアリングを、本プロジェクトの配布条件で禁止しません。バイナリの再ビルド自体は、このライセンス資料整備時には実行していません。

## メンテナー向け配布手順

リポジトリのルートで Python 3.11 以降を使い、次を実行します。

```text
python scripts/third-party-sources.py --download --notices
npm.cmd test
npm.cmd run check
npm.cmd run package
```

ソース取得は `sources.json` の SHA-256 が一致した場合だけ成功します。ソース ZIP と `.sha256` を VSIX と同じ公開場所に掲載し、公開後に各ファイルを取得できることを確認してください。LGPL/GPL によるソース提供の責任は配布者にあります。公開先の添付漏れや削除に注意してください。

依存更新時は、版・対応ソース・ハッシュ・上流パッチ・ライセンス資料をまとめて更新します。この資料とマニフェストは Windows x64 / sharp 0.35.5 用です。他の環境向けの配布物は、その環境の実際のネイティブ依存について同じ確認を行ってください。
