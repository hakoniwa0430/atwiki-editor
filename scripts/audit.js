'use strict';
const fs = require('node:fs');
const { LOCAL_NAMES } = require('../src/plugins');
const excluded = require('../src/unsupported');
const catalog = require('../test/official-catalog.json').filter((x) => x.name !== 'swf');
const unique = [...new Map(catalog.map((x) => [x.name, x])).values()];
if (!unique.some((x) => x.name === 'twitter_widget_search2'))
  unique.push({ name: 'twitter_widget_search2', category: '情報を集めるプラグイン' });
for (const { name } of unique) {
  if (!LOCAL_NAMES.includes(name) && !excluded[name]) throw Error('Unclassified: ' + name);
  if (LOCAL_NAMES.includes(name) && excluded[name]) throw Error('Conflicting status: ' + name);
}
const implemented = unique.filter(({ name }) => LOCAL_NAMES.includes(name));
const unsupported = unique.filter(({ name }) => !LOCAL_NAMES.includes(name));
const row = ({ name, category }) =>
  '| `' + name + '` | ' + category + ' | ' + (excluded[name] || '実装済み') + ' |';
const report = [
  '# 実装済み記法対応状況（' + require('../package.json').version + '）',
  '',
  '現在の実装登録と照合した記法の対応表です。カタログ ' +
    unique.length +
    ' 件のうち、実装済み ' +
    implemented.length +
    ' 件、実行対象外 ' +
    unsupported.length +
    ' 件です。',
  '',
  '## 実装済み記法',
  '',
  '| 記法 | 区分 | 状態 |',
  '| --- | --- | --- |',
  ...implemented.map(row),
  '',
  '## 対応困難な項目（実行対象外）',
  '',
  'サーバー機能・外部サービス・旧ブラウザー技術などに依存し、現状のローカルプレビューでは実行対象外としている ' +
    unsupported.length +
    ' 項目です。各記法の状態欄に理由を記載しています。',
  '',
  '| 記法 | 区分 | 状態 |',
  '| --- | --- | --- |',
  ...unsupported.map(row),
  '',
  '## カタログの参考元',
  '',
  '- [アットウィキご利用ガイド：プラグイン一覧](https://w.atwiki.jp/guide/pages/264.html)',
  '- [アットウィキご利用ガイド：動画系プラグイン](https://w.atwiki.jp/guide/pages/801.html)',
  '- [アットウィキご利用ガイド：情報を集めるプラグイン](https://w.atwiki.jp/guide/pages/266.html)',
  '',
].join('\n');
if (process.argv.includes('--write')) fs.writeFileSync('COMPATIBILITY.md', report);
else if (fs.readFileSync('COMPATIBILITY.md', 'utf8').replace(/\r\n/g, '\n') !== report)
  throw Error('COMPATIBILITY.md is out of date');
console.log(
  `Catalog: ${unique.length}; registered: ${LOCAL_NAMES.length}; classifications verified`,
);
