'use strict';
const crypto = require('node:crypto');
const { authorization } = require('./wiki-api');
const REDIRECT = 'https://vscode.dev/redirect';

class WikiOAuth {
  constructor(vscode, context) {
    this.vscode = vscode;
    const pkg = require('../package.json');
    this.extensionId = context.extension?.id || `${pkg.publisher}.${pkg.name}`;
    this.active = undefined;
    if (vscode.window.registerUriHandler) {
      context.subscriptions.push(
        vscode.window.registerUriHandler({ handleUri: (uri) => this.handle(uri) }),
      );
    }
    context.subscriptions.push({
      dispose: () => this.active?.finish({ error: '接続処理を終了しました。' }),
    });
  }
  handle(uri) {
    const active = this.active;
    if (!active) return;
    let parsed;
    try {
      parsed = new URL(uri.toString(true));
    } catch {
      return;
    }
    if (
      parsed.protocol !== `${this.vscode.env.uriScheme}:` ||
      parsed.hostname !== this.extensionId ||
      parsed.pathname !== '/oauth-callback' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash ||
      parsed.searchParams.getAll('nonce').length !== 1 ||
      parsed.searchParams.get('nonce') !== active.nonce
    )
      return;
    if (Date.now() > active.expires) {
      active.finish({ error: '認可の待機時間を超えました。接続をやり直してください。' });
      return;
    }
    if (parsed.searchParams.has('error')) {
      active.finish({ error: '認可が許可されませんでした。' });
      return;
    }
    if (parsed.searchParams.getAll('code').length !== 1 || !parsed.searchParams.get('code')) return;
    active.finish({ code: parsed.searchParams.get('code') });
  }
  async login(config) {
    const vscode = this.vscode;
    if (
      !vscode.window.registerUriHandler ||
      !vscode.env.asExternalUri ||
      !vscode.window.withProgress
    )
      throw Error('この環境ではVS Codeへの認可結果の受け取りに対応していません。');
    if (this.active) throw Error('接続処理が進行中です。');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const callback = await vscode.env.asExternalUri(
      vscode.Uri.parse(
        `${vscode.env.uriScheme}://${this.extensionId}/oauth-callback?nonce=${nonce}`,
      ),
    );
    const pending = authorization(config, callback.toString(true));
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'アットウィキ: ブラウザで連携を許可し、「Visual Studio Codeを開く」で戻ってください',
        cancellable: true,
      },
      async (_progress, cancellation) => {
        let resolve;
        const result = new Promise((done) => {
          resolve = done;
        });
        const active = {
          nonce,
          expires: Date.now() + 10 * 60 * 1000,
          finish: (value) => {
            if (this.active !== active) return;
            this.active = undefined;
            resolve(value);
          },
        };
        this.active = active;
        const timer = setTimeout(
          () => active.finish({ error: '認可の待機時間を超えました。接続をやり直してください。' }),
          10 * 60 * 1000,
        );
        const listener = cancellation.onCancellationRequested(() =>
          active.finish({ cancelled: true }),
        );
        try {
          if (cancellation.isCancellationRequested) active.finish({ cancelled: true });
          if (this.active && !(await vscode.env.openExternal(vscode.Uri.parse(pending.url))))
            active.finish({ error: '認可画面を開けませんでした。' });
          const outcome = await result;
          if (outcome.error) throw Error(outcome.error);
          return outcome.cancelled ? undefined : { code: outcome.code, pending };
        } finally {
          clearTimeout(timer);
          listener.dispose();
          if (this.active === active) this.active = undefined;
        }
      },
    );
  }
}
module.exports = { WikiOAuth, REDIRECT };
