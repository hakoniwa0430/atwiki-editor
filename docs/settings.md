# 設定

この拡張機能で変更できる設定項目と、その効果を説明します。

## 設定方法

VS Codeの設定画面で `atwiki` を検索し、必要な項目を変更します。設定JSON（`settings.json`）に設定名と値を記述することもできます。既存の設定がある場合は、必要な項目を追記してください。

## 設定項目一覧

| 設定名 | 既定値 | 内容 |
| --- | --- | --- |
| `atwiki.autoLink.excludedPages` | `[]` | ページ名の自動リンクから除外するローカルページ名（拡張子なし）。初期ページや非公開ページなどを指定します。 |
| `atwiki.preview.wikiName` | `"ローカルWiki"` | wikiname に表示するウィキ名。 |
| `atwiki.preview.wikiUrl` | `""` | wikiurl に表示するウィキのURL。 |
| `atwiki.preview.allowSharedImages` | `true` | ウィキ内共通利用ファイル管理の画像URL（img.atwiki.jp の /pub/）をHTTPSで読み込みます。旧画像URLも対応します。 |
| `atwiki.preview.allowRemoteImages` | `false` | HTTPS の外部画像全般を読み込みます。共通利用ファイルの画像は allowSharedImages でも個別に許可できます。 |
| `atwiki.preview.displayMode` | `"desktop"` | pc / mobile などの条件付き記法を確認するための表示モード。 |
| `atwiki.preview.theme` | `"uikit"` | uikit は Uikit レスポンシブに寄せた本文表示、paper は従来の用紙、editor は VS Code の配色です。 |
| `atwiki.preview.updateDelay` | `200` | 入力から再描画までの待機時間（ミリ秒）。 |
| `atwiki.preview.syncScroll` | `true` | エディターのスクロール位置をプレビューに反映します。 |
| `atwiki.preview.allowExternalEmbeds` | `false` | YouTube・ニコニコ動画・X・Discordの埋め込みを取得します。表示すると外部サービスへ接続します。 |
| `atwiki.preview.allowExternalFeeds` | `false` | 公開HTTPSのRSS/Atomを取得します。最大4フィード・各512KB、60秒キャッシュ。HTTP指定はHTTPSへ変換します。 |

## プレビューの表示と更新

- `atwiki.preview.theme`：`uikit` はUikitレスポンシブに寄せた本文表示、`paper` は用紙風、`editor` はVS Codeの配色を使います。
- `atwiki.preview.displayMode`：`desktop` または `mobile` を指定し、`pc` / `mobile` などの条件付き記法の表示を切り替えます。
- `atwiki.preview.updateDelay`：入力後に再描画するまでの待機時間です。0〜2000ミリ秒で指定します。
- `atwiki.preview.syncScroll`：`true` にするとエディターのスクロール位置をプレビューに反映します。

## Wikiの表示情報

`atwiki.preview.wikiName` は `wikiname`、`atwiki.preview.wikiUrl` は `wikiurl` に表示する値を指定します。

## ページ名の自動リンク

`atwiki.autoLink.excludedPages` に、ページ名の自動リンクから除外するローカルページ名を拡張子なしの配列で指定します。既定値は空の配列 `[]` です。

```json
{
  "atwiki.autoLink.excludedPages": ["メニュー", "下書き"]
}
```

## 動画・SNSの埋め込み

```json
{
  "atwiki.preview.allowExternalEmbeds": true
}
```

既定値は `false` です。次の記法で埋め込みを有効にします。

| 対象 | 記法 |
| --- | --- |
| YouTube | `youtube` / `u2b` |
| YouTube・ニコニコ動画 | `video` |
| ニコニコ動画 | `nicovideo` / `nicovideo2` |
| Xの投稿・プロフィール | `twitter_widget3` / `twitter_widget_profile2` |
| Discord | `discord_widget` |

無効時は元ページへのリンクを表示します。有効時もリンクを併記します。外部サービス側の制限により、埋め込みが表示・再生できない場合があります。

`instagram_widget` と `twitter_widget_search2` は、それぞれInstagramのページ、Xの検索結果へのリンクを表示します。この設定を有効にしても埋め込みには変わりません。

## RSS/Atomの取得

```json
{
  "atwiki.preview.allowExternalFeeds": true
}
```

既定値は `false` です。`showrss` / `rss` / `feedreader` で公開HTTPSのRSS/Atomを取得し、一覧表示します。HTTP指定はHTTPSに変換します。

無効時・取得待ち・取得失敗時は配信元へのリンクなどを表示します。取得は最大4フィード、各512KBまでで、60秒間キャッシュします。

## 外部画像の取得

| 設定名 | 既定値 | 内容 |
| --- | --- | --- |
| `atwiki.preview.allowSharedImages` | `true` | アットウィキ共通利用ファイルの画像（`img.atwiki.jp` の `/pub/`）をHTTPSで取得 |
| `atwiki.preview.allowRemoteImages` | `false` | HTTPSの外部画像全般を取得 |

共通利用ファイル以外の外部画像も表示する場合は、次を設定します。

```json
{
  "atwiki.preview.allowRemoteImages": true
}
```

## 外部コンテンツの取得を無効にする

外部コンテンツの取得・埋め込み表示には通信が発生します。これらの設定による取得をすべて無効にするには、次の4項目を `false` にします。

```json
{
  "atwiki.preview.allowSharedImages": false,
  "atwiki.preview.allowRemoteImages": false,
  "atwiki.preview.allowExternalEmbeds": false,
  "atwiki.preview.allowExternalFeeds": false
}
```

[記法の対応状況](../COMPATIBILITY.md) / [ドキュメント一覧](../README.md#ドキュメント)
