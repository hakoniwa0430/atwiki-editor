'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process');
require('./check-native-licenses').checkNativeLicenses();
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.js')) {
      const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (r.status !== 0) throw Error(r.stderr || file);
      count++;
    } else if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}
for (const dir of ['src', 'media', 'scripts', 'test', 'vendor', 'syntaxes', 'snippets']) walk(dir);
const css = fs.readFileSync('media/vendor/katex/katex.min.css', 'utf8');
for (const m of css.matchAll(/url\(([^)]+)\)/g))
  if (!fs.existsSync(path.join('media/vendor/katex', m[1].replace(/["']/g, ''))))
    throw Error('Missing font: ' + m[1]);
for (const name of ['KATEX', 'FONT-AWESOME', 'HIGHLIGHT', 'QRCODE'])
  if (fs.readFileSync(`vendor/${name}-LICENSE.txt`, 'utf8').length < 500)
    throw Error('License incomplete: ' + name);
console.log(`Syntax checked: ${count} JavaScript files; JSON, KaTeX fonts and licenses present.`);
