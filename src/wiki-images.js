'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { wikiId } = require('./wiki-api');

function imageUrl(value, wiki) {
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
      return null;
    if (url.hostname === 'img.atwikiimg.com') {
      if (!/^\/www\d+\.atwiki\.jp\//.test(url.pathname)) return null;
      url.pathname = url.pathname.replace(/^\/www\d+\.atwiki\.jp/, '');
      url.hostname = 'img.atwiki.jp';
    }
    if (url.hostname !== 'img.atwiki.jp') return null;
    const parts = url.pathname.split('/');
    if (wiki && parts[1] !== wiki) return null;
    if (
      !['attach', 'pub'].includes(parts[2]) ||
      !/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(url.pathname)
    )
      return null;
    url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
function extractImages(text, wiki) {
  return [
    ...new Set(
      [...text.matchAll(/(?:https?:)?\/\/(?:img\.atwiki\.jp|img\.atwikiimg\.com)\/[^\s"'<>),}]+/gi)]
        .map((m) => imageUrl(m[0].replace(/&amp;/g, '&'), wiki))
        .filter(Boolean),
    ),
  ];
}

// Only the public page and image hosts are contacted; OAuth credentials are never sent.
function download(url, kind, redirects = 0) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.port ||
    !(kind === 'html' ? target.hostname === 'w.atwiki.jp' : imageUrl(url))
  )
    return Promise.reject(Error('画像の取得先が不正です。'));
  return new Promise((resolve, reject) => {
    const req = https.get(
      target,
      {
        headers: {
          'User-Agent': 'Atwiki-Editor/' + require('../package.json').version,
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (redirects >= 3 || !res.headers.location)
            return reject(Error('画像の転送回数を超えました。'));
          try {
            download(new URL(res.headers.location, target).href, kind, redirects + 1).then(
              resolve,
              reject,
            );
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error(`画像取得: HTTP ${res.statusCode}`));
          return;
        }
        if (kind === 'image' && !/^image\//i.test(res.headers['content-type'] || '')) {
          res.resume();
          reject(Error('画像以外の応答が返されました。'));
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > (kind === 'html' ? 8 : 20) * 1024 * 1024)
            req.destroy(Error('画像取得のサイズ上限を超えました。'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    const timer = setTimeout(() => req.destroy(Error('画像取得がタイムアウトしました。')), 20000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}
function localImage(value, pages = []) {
  const url = imageUrl(value);
  if (!url) return null;
  const wiki = new URL(url).pathname.split('/')[1];
  // Match the wiki as well as the page ID; IDs are not globally unique.
  const matching = pages.filter((page) => page.wiki === wiki);
  if (!matching.length) return null;
  try {
    return imageTarget(url, matching).file;
  } catch {
    return null;
  }
}
function validPart(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/[<>:"/\\|?*\x00-\x1f]/.test(value) &&
    !/[. ]$/.test(value) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value) &&
    !value.startsWith('.')
  );
}
function validPath(value) {
  return (
    typeof value === 'string' &&
    value.split('/').length >= 2 &&
    value.split('/').every(validPart) &&
    /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(value)
  );
}
function imageTarget(url, pages) {
  const parts = new URL(url).pathname.split('/').slice(2).map(decodeURIComponent);
  if (parts[0] === 'pub') {
    const file = parts.join('/');
    if (!parts.every(validPart) || !validPath(file))
      throw Error('共通画像の名前をそのまま保存できません。');
    return { file, url };
  }
  const owner = pages.find((p) => p.pageid === Number(parts[1]));
  if (!owner) throw Error('添付先のページ名が不明です。全ページを同期してください。');
  const filename = parts.at(-1);
  if (
    !validPart(filename) ||
    !/^\d+$/.test(parts[2]) ||
    !(parts.length === 4 || (parts.length === 5 && ['t', 'm'].includes(parts[3])))
  )
    throw Error('添付画像の名前をそのまま保存できません。');
  const file = owner.pagename + '/' + filename;
  if (!validPath(file) || owner.pagename.split('/')[0].toLowerCase() === 'pub')
    throw Error('添付先のページ名をフォルダとして保存できません。');
  const original = new URL(url);
  original.pathname = original.pathname.replace(/(\/attach\/\d+\/\d+)\/[tm]\//, '$1/');
  return { file, url: original.href, owner, filename };
}
async function ensureDirectory(root, relative) {
  let directory = root;
  for (const part of relative.split('/')) {
    directory = path.join(directory, part);
    try {
      await fs.mkdir(directory);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error('画像の保存先が通常のフォルダではありません。');
  }
  return directory;
}
async function syncImages(root, wiki, page, localName, pages = [page], fetcher = download) {
  wikiId(`https://w.atwiki.jp/${wiki}/`);
  pages = [page, ...pages.filter((item) => item.pageid !== page.pageid)];
  const result = { updated: 0, kept: 0, problems: [] };
  let urls = extractImages(page.source, wiki);
  try {
    const html = await fetcher(`https://w.atwiki.jp/${wiki}/pages/${page.pageid}.html`, 'html');
    urls = [...new Set([...urls, ...extractImages(html.toString('utf8'), wiki)])];
  } catch (error) {
    result.problems.push('公開ページの画像一覧: ' + error.message);
  }
  if (urls.length > 200) result.problems.push('画像は1ページ200件まで取得します。');
  if (!urls.length) return result;
  const fetched = new Map();
  for (const url of urls.slice(0, 200)) {
    try {
      const target = imageTarget(url, pages);
      const { file } = target;
      const data = fetched.get(target.url) || (await fetcher(target.url, 'image'));
      fetched.set(target.url, data);
      const imageDirectory = await ensureDirectory(root, path.posix.dirname(file));
      const destination = path.join(root, file);
      let same = false;
      try {
        const existing = await fs.lstat(destination);
        if (!existing.isFile() || existing.isSymbolicLink())
          throw Error('画像の保存先が通常のファイルではありません。');
        same = (await fs.readFile(destination)).equals(data);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (same) result.kept++;
      else {
        const tempImage = path.join(imageDirectory, crypto.randomUUID() + '.tmp');
        try {
          await fs.writeFile(tempImage, data, { flag: 'wx' });
          await fs.rename(tempImage, destination);
        } finally {
          await fs.unlink(tempImage).catch(() => {});
        }
        result.updated++;
      }
    } catch (error) {
      result.problems.push(url + ': ' + error.message);
    }
  }
  return result;
}
module.exports = {
  imageUrl,
  extractImages,
  download,
  localImage,
  syncImages,
  imageTarget,
};
