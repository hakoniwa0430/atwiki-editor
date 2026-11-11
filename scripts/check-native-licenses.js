'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

function checkNativeLicenses({ distribution = false } = {}) {
  const read = (file) => fs.readFileSync(path.join(root, file));
  const manifest = JSON.parse(read('vendor/native-licenses/sources.json'));
  const sharp = JSON.parse(read('node_modules/sharp/package.json'));
  if (sharp.version !== manifest.sharp)
    throw Error('Native license manifest: sharp version mismatch');
  const versions = JSON.parse(read(`node_modules/@img/sharp-${manifest.platform}/versions.json`));
  for (const [file, expected] of Object.entries(manifest.binaries)) {
    if (
      path.basename(file) !== file ||
      crypto
        .createHash('sha256')
        .update(read(`node_modules/@img/sharp-${manifest.platform}/lib/${file}`))
        .digest('hex') !== expected
    ) {
      throw Error(`Native binary differs from reviewed distribution: ${file}`);
    }
  }
  const recorded = Object.fromEntries(manifest.sources.map((entry) => [entry.name, entry.version]));
  if (
    Object.keys(versions).length !== Object.keys(recorded).length ||
    Object.entries(versions).some(([name, version]) => recorded[name] !== version)
  ) {
    throw Error('Native license manifest: dependency versions mismatch');
  }
  const filenames = new Set();
  for (const entry of [...manifest.sources, ...manifest.rustSources, ...manifest.buildSources]) {
    if (
      !/^[\w.+-]+$/.test(entry.file) ||
      filenames.has(entry.file) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !entry.urls.length ||
      entry.urls.some((url) => !url.startsWith('https://'))
    ) {
      throw Error(`Invalid source manifest entry: ${entry.name}`);
    }
    filenames.add(entry.file);
  }
  for (const name of [
    'GPL-3.0-only',
    'LGPL-3.0-only',
    'MPL-1.1',
    'MPL-2.0',
    'MIT',
    'Apache-2.0',
    'UPSTREAM-NOTICES',
  ]) {
    if (read(`vendor/native-licenses/${name}.txt`).length < 1000)
      throw Error(`Missing license text: ${name}`);
  }
  read('docs/third-party-licenses.md');
  if (distribution) {
    if (`${process.platform}-${process.arch}` !== manifest.platform) {
      throw Error('Prepare native license/source manifests for this platform before distributing.');
    }
    const version = JSON.parse(read('package.json')).version;
    const filename = `atwiki-editor-${version}-third-party-sources.zip`;
    const receipt = JSON.parse(read('.inspection/source-distribution.json'));
    if (receipt.version !== version || receipt.archive !== filename)
      throw Error('Regenerate the source companion for this version.');
    const documents = fs
      .readdirSync(path.join(root, 'vendor/native-licenses'))
      .map((file) => `vendor/native-licenses/${file}`);
    documents.push('docs/third-party-licenses.md', 'scripts/third-party-sources.py');
    for (const file of documents) {
      if (
        crypto.createHash('sha256').update(read(file)).digest('hex') !== receipt.documents[file]
      ) {
        throw Error(
          `Source companion is stale: ${file}; regenerate with scripts/third-party-sources.py`,
        );
      }
    }
    const expected = read(`${filename}.sha256`).toString().trim();
    const actual = crypto.createHash('sha256').update(read(filename)).digest('hex');
    if (expected !== `${actual}  ${filename}`)
      throw Error('Companion source archive checksum mismatch');
  }
  return filenames.size;
}

module.exports = { checkNativeLicenses };
if (require.main === module)
  console.log(`Verified ${checkNativeLicenses()} native source manifest entries.`);
