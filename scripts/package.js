'use strict';
// OPC/VSIX packaging, including installed runtime dependencies for this platform.
const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const pkg = require('../package.json');
const root = path.resolve(__dirname, '..');
// A distributable VSIX must have its matching source companion ready locally.
require('./check-native-licenses').checkNativeLicenses({ distribution: true });
const xml = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
  );
const entries = [];
function add(name, data) {
  entries.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
}
function include(relative) {
  const file = path.join(root, relative);
  if (fs.statSync(file).isDirectory()) {
    for (const name of fs.readdirSync(file).sort()) include(`${relative}/${name}`);
  } else add(`extension/${relative}`, fs.readFileSync(file));
}
for (const file of [
  'package.json',
  'README.md',
  'COMPATIBILITY.md',
  'docs',
  'LICENSE',
  'language-configuration.json',
  'src',
  'media',
  'vendor',
  'syntaxes',
  'snippets',
  'output/サンプル_アットウィキ.txt',
  'output/拡張記法サンプル.txt',
])
  include(file);
// Keep native image codecs and their licenses, but exclude development dependencies.
const runtimePackages = new Set();
function includeDependency(name, optional = false) {
  if (runtimePackages.has(name)) return;
  const relative = `node_modules/${name}`;
  const manifest = path.join(root, relative, 'package.json');
  if (!fs.existsSync(manifest)) {
    if (optional) return;
    throw Error(`Missing runtime dependency ${name}; run npm ci first.`);
  }
  runtimePackages.add(name);
  const dependency = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  include(relative);
  for (const child of Object.keys(dependency.dependencies || {})) includeDependency(child);
  for (const child of Object.keys(dependency.optionalDependencies || {}))
    includeDependency(child, true);
}
for (const name of Object.keys(pkg.dependencies || {})) includeDependency(name);
// Fail packaging rather than ship a VSIX with an absent or incompatible native codec.
require(path.join(root, 'node_modules/sharp'));
const targetPlatform = `${process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? 'alpine' : process.platform}-${process.arch}`;
add(
  '[Content_Types].xml',
  `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="woff2" ContentType="font/woff2"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="txt" ContentType="text/plain"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>`,
);
add(
  'extension.vsixmanifest',
  `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
<Metadata><Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}"/><DisplayName>${xml(pkg.displayName)}</DisplayName><Description xml:space="preserve">${xml(pkg.description)}</Description><Tags>${xml(pkg.keywords.join(','))}</Tags><Categories>${xml(pkg.categories.join(','))}</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/><Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/><Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value=""/><Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="false"/></Properties><License>extension/LICENSE</License>${pkg.icon ? `<Icon>extension/${xml(pkg.icon)}</Icon>` : ''}</Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets>${pkg.icon ? `<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${xml(pkg.icon)}" Addressable="true"/>` : ''}<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/></Assets></PackageManifest>`,
);
const manifestEntry = entries.find((entry) => entry.name === 'extension.vsixmanifest');
manifestEntry.data = Buffer.from(
  manifestEntry.data
    .toString()
    .replace('<Identity ', `<Identity TargetPlatform="${xml(targetPlatform)}" `),
);
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [],
  central = [];
let offset = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.name),
    data = deflateRawSync(entry.data),
    crc = crc32(entry.data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8);
  record.writeUInt16LE(8, 10);
  record.writeUInt16LE(0x21, 14);
  record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(data.length, 20);
  record.writeUInt32LE(entry.data.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE(offset, 42);
  local.push(header, name, data);
  central.push(record, name);
  offset += header.length + name.length + data.length;
}
const directory = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const output = path.join(root, `atwiki-editor-${pkg.version}.vsix`);
fs.writeFileSync(output, Buffer.concat([...local, directory, end]));
console.log(
  `Created ${path.basename(output)} (${entries.length} files, ${fs.statSync(output).size} bytes)`,
);
