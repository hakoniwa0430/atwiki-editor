'use strict';
const crypto = require('node:crypto');
const https = require('node:https');

function wikiId(value) {
  value = String(value).trim();
  if (/^[a-zA-Z0-9-][a-zA-Z0-9_-]*$/.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('Wikiの個別名またはHTTPS URLを入力してください。');
  }
  const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'w.atwiki.jp' ||
    url.port ||
    url.username ||
    url.password ||
    !match ||
    match[1].startsWith('_')
  )
    throw Error('https://w.atwiki.jp/Wiki名/ の形式で指定してください。');
  return match[1];
}
function redirectUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('登録したHTTPSリダイレクトURIを入力してください。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
    throw Error('リダイレクトURIはクエリ・フラグメントのないHTTPS URLにしてください。');
  return url.href;
}
function authorization(config, callbackUri) {
  const verifier = crypto.randomBytes(48).toString('base64url');
  // vscode.dev/redirect decodes state as the destination URI. Its nonce remains
  // bound to this login attempt and is checked by the extension's URI handler.
  const state = callbackUri
    ? encodeURIComponent(callbackUri)
    : crypto.randomBytes(32).toString('base64url');
  const url = new URL('https://auth.atwiki.jp/oauth2/auth');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirect,
    scope: 'user:read wiki:read wiki:write offline_access',
    audience: 'https://w.atwiki.jp/_api/v1',
    code_challenge_method: 'S256',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    state,
  }).toString();
  return { url: url.href, verifier, state, created: Date.now() };
}
function callbackCode(value, config, pending) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('認可後のURL全体を貼り付けてください。');
  }
  const base = new URL(config.redirect);
  if (
    url.origin !== base.origin ||
    url.pathname !== base.pathname ||
    url.hash ||
    url.username ||
    url.password ||
    url.searchParams.getAll('state').length !== 1 ||
    url.searchParams.get('state') !== pending.state ||
    Date.now() - pending.created > 10 * 60 * 1000
  )
    throw Error('認可URLの照合に失敗しました。接続をやり直してください。');
  if (
    url.searchParams.has('error') ||
    url.searchParams.getAll('code').length !== 1 ||
    !url.searchParams.get('code')
  )
    throw Error('認可が完了していません。接続をやり直してください。');
  return url.searchParams.get('code');
}
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Atwiki-Editor/' + require('../package.json').version,
          Accept: 'application/json',
          ...options.headers,
        },
      },
      (res) => {
        const chunks = [];
        let length = 0;
        res.on('data', (chunk) => {
          length += chunk.length;
          if (length > 8 * 1024 * 1024) req.destroy(Error('応答サイズの上限を超えました。'));
          else chunks.push(chunk);
        });
        res.on('error', () =>
          reject(Error('通信が中断されました。再取得して状態を確認してください。')),
        );
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const messages = {
              401: '接続の有効期限が切れました。再接続してください。',
              403: '権限がありません。アプリのスコープとWikiの権限を確認してください。',
              404: 'ページが見つからないか閲覧できません。',
              409: '本家が更新されています。取得・差分確認からやり直してください。',
              412: '本家が更新されています。取得・差分確認からやり直してください。',
              429: '利用制限に達しました。時間をおいて再実行してください。',
            };
            const error = Error(
              messages[res.statusCode] || `API通信に失敗しました（HTTP ${res.statusCode}）。`,
            );
            error.status = res.statusCode;
            reject(error);
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(Error('APIから正しいJSONが返りませんでした。'));
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(Error('通信がタイムアウトしました。再取得して状態を確認してください。')),
      20000,
    );
    req.on('close', () => clearTimeout(timer));
    req.on('error', () =>
      reject(Error('通信できませんでした。投稿の場合は再取得して結果を確認してください。')),
    );
    req.end(options.body);
  });
}
function validatePage(page, expected) {
  if (
    !page ||
    !Number.isSafeInteger(page.pageid) ||
    page.pageid < 1 ||
    (expected && page.pageid !== Number(expected)) ||
    typeof page.source !== 'string' ||
    typeof page.pagename !== 'string' ||
    typeof page.etag !== 'string' ||
    !page.etag ||
    /[\r\n]/.test(page.etag)
  )
    throw Error('APIのページ情報が不正です。同期を中止しました。');
  return page;
}
function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n');
}
function syncState(base, local, remote) {
  base = normalizeText(base);
  local = normalizeText(local);
  remote = normalizeText(remote);
  if (local === remote) return 'equal';
  if (local === base) return 'remote';
  if (remote === base) return 'local';
  return 'conflict';
}
class WikiApi {
  constructor(secrets, transport = request) {
    this.secrets = secrets;
    this.transport = transport;
    this.sessions = new Map();
  }
  async config(key = 'atwiki.oauth') {
    const raw = await this.secrets.get(key);
    if (!raw) throw Error('先に「アットウィキ: Wikiに接続」を実行してください。');
    return JSON.parse(raw);
  }
  async token(config, fields) {
    const encode = (value) => new URLSearchParams({ x: value }).toString().slice(2);
    const data = await this.transport('https://auth.atwiki.jp/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${encode(config.clientId)}:${encode(config.clientSecret)}`).toString(
            'base64',
          ),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    });
    if (
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0 ||
      typeof data.refresh_token !== 'string' ||
      !data.refresh_token
    )
      throw Error('トークン応答が不正です。offline_accessを含めて再接続してください。');
    return {
      ...config,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expires: Date.now() + data.expires_in * 1000,
    };
  }
  async call(config, route, options = {}) {
    if (!/^\/(?:whoami|pages(?:\/[1-9]\d*)?)(?:\?[^#]*)?$/.test(route))
      throw Error('APIパスが不正です。');
    if (wikiId(`https://w.atwiki.jp/${config.wiki}/`) !== config.wiki)
      throw Error('Wiki IDが不正です。');
    return this.transport(`https://w.atwiki.jp/_api/v1/wikis/${config.wiki}${route}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${config.accessToken}` },
    });
  }
  async session(key = 'atwiki.oauth') {
    if (this.sessions.has(key)) return this.sessions.get(key);
    const pending = (async () => {
      let config = await this.config(key);
      if (config.expires < Date.now() + 60000) {
        config = await this.token(config, {
          grant_type: 'refresh_token',
          refresh_token: config.refreshToken,
        });
        await this.secrets.store(key, JSON.stringify(config));
      }
      return config;
    })();
    this.sessions.set(key, pending);
    try {
      return await pending;
    } finally {
      this.sessions.delete(key);
    }
  }

  async page(config, id) {
    return validatePage(await this.call(config, `/pages/${id}`), id);
  }
  async publish(config, page, text) {
    validatePage(page);
    return validatePage(
      (
        await this.call(config, `/pages/${page.pageid}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': page.etag,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ body: text }),
        })
      ).data,
      page.pageid,
    );
  }
  async create(config, name) {
    return validatePage(
      (
        await this.call(config, '/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ pagename: name, body: '' }),
        })
      ).data,
    );
  }
}
module.exports = {
  wikiId,
  redirectUrl,
  authorization,
  callbackCode,
  request,
  validatePage,
  syncState,
  normalizeText,
  WikiApi,
};
