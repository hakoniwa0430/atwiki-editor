'use strict';
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const { version } = require('../package.json');
const MAX_BYTES = 512 * 1024;
function feedUrl(value) {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    )
      return null;
    url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
function download(value, redirects = 0, dependencies = {}) {
  const lookup = dependencies.lookup || dns.lookup;
  const get = dependencies.get || https.get;
  return new Promise((resolve, reject) => {
    let request,
      ended = false;
    const finish = (error, result) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (error) {
        request?.destroy();
        reject(error);
      } else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('RSS取得がタイムアウトしました')), 8000);
    (async () => {
      const normalized = feedUrl(value);
      if (!normalized) throw new Error('公開HTTPSフィードのURLを指定してください');
      const url = new URL(normalized);
      const addresses = await lookup(url.hostname, { all: true, family: 4 });
      if (ended) return;
      if (!addresses.length || addresses.some((x) => !publicIPv4(x.address)))
        throw new Error('ローカル・非公開アドレスへのRSS接続はできません');
      const address = addresses[0].address;
      request = get(
        url,
        {
          headers: {
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
            'Accept-Encoding': 'identity',
            'User-Agent': `Atwiki-Editor/${version}`,
          },
          lookup: (_hostname, opts, cb) =>
            cb(null, opts?.all ? [{ address, family: 4 }] : address, 4),
        },
        (response) => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            response.resume();
            if (redirects >= 3 || !response.headers.location)
              return finish(new Error('RSSの転送回数を超えました'));
            let next;
            try {
              next = new URL(response.headers.location, url).href;
            } catch {
              return finish(new Error('RSSの転送先が不正です'));
            }
            download(next, redirects + 1, dependencies).then((r) => finish(null, r), finish);
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            return finish(new Error(`RSS取得エラー: HTTP ${response.statusCode}`));
          }
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              response.destroy();
              finish(new Error('RSSが512KBを超えています'));
            } else chunks.push(chunk);
          });
          response.on('error', finish);
          response.on('end', () => {
            const bytes = Buffer.concat(chunks);
            const header = bytes.subarray(0, 200).toString('ascii');
            const encoding = header.match(/encoding=["']([^"']+)/i)?.[1] || 'utf-8';
            try {
              finish(null, {
                xml: new TextDecoder(encoding, { fatal: true }).decode(bytes),
                url: url.href,
              });
            } catch {
              finish(new Error('RSSの文字コードを読み取れません'));
            }
          });
        },
      );
      request.on('error', finish);
    })().catch(finish);
  });
}
function createFeedLoader(fetcher = download) {
  const cache = new Map();
  return async (urls) => {
    const result = Object.create(null);
    await Promise.all(
      [...new Set(urls)].slice(0, 4).map(async (url) => {
        const previous = cache.get(url);
        if (!previous || previous.until < Date.now()) {
          if (cache.size >= 20) cache.delete(cache.keys().next().value);
          cache.set(url, {
            until: Date.now() + 60000,
            value: Promise.resolve()
              .then(() => fetcher(url))
              .catch((e) => ({ error: e.message })),
          });
        }
        result[url] = await cache.get(url).value;
      }),
    );
    return result;
  };
}
module.exports = { feedUrl, publicIPv4, download, createFeedLoader };
