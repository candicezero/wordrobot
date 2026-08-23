(async () => {
  const out = {};
  const wait = ms => new Promise(r => setTimeout(r, ms));
  try {
    await WR.db.open();
    await WR.db.wipeAll();
    await WR.db.libraries.create('备份测试');
    await WR.db.settings.set('backup', { repo_owner: 'o', repo_name: 'r', github_token: 'tok' });

    const calls = [];
    const realFetch = window.fetch;
    window.fetch = async function (url, opts) {
      const method = (opts && opts.method) || 'GET';
      calls.push(method + ' ' + url);
      if (method === 'GET' && url.indexOf('/contents/backup-latest.json') >= 0) {
        return new Response(JSON.stringify({ sha: 'sha-old', content: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'PUT') {
        return new Response(JSON.stringify({ content: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    out.configured = await WR.githubBackup.configured();
    const r1 = await WR.githubBackup.backupNow('backup ok');
    out.firstOk = r1.ok && !r1.queued;
    out.putUsedSha = calls.some(c => c.startsWith('PUT')) &&
      JSON.parse(calls.join('|').length > 0 ? 'true' : 'false');

    /* 校验 PUT body 携带 sha 与 base64 内容 */
    let putBody = null;
    window.fetch = async function (url, opts) {
      if (opts && opts.method === 'PUT') { putBody = JSON.parse(opts.body); return new Response('{}', { status: 200 }); }
      return new Response(JSON.stringify({ sha: 'sha-2', content: '' }), { status: 200 });
    };
    await WR.githubBackup.backupNow('backup with sha');
    out.putHasSha = putBody && putBody.sha === 'sha-2';
    out.putMsg = putBody && putBody.message;
    out.putContentDecodes = putBody && (decodeURIComponent(escape(atob(putBody.content))).indexOf('备份测试') >= 0);

    /* 失败入队 */
    window.fetch = async function (url, opts) {
      if (opts && opts.method === 'PUT') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ sha: 'sha-3', content: '' }), { status: 200 });
    };
    const r2 = await WR.githubBackup.backupNow('will fail');
    out.failedQueued = !r2.ok && r2.queued;
    out.pendingAfterFail = (await WR.db.queue.pendingList()).length;

    /* 重试成功 */
    window.fetch = async function (url, opts) {
      if (opts && opts.method === 'PUT') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ sha: 'sha-4', content: '' }), { status: 200 });
    };
    const rs = await WR.githubBackup.retryPending();
    out.retryOk = rs.length === 1 && rs[0].ok;
    out.pendingAfterRetry = (await WR.db.queue.pendingList()).length;

    /* 恢复：latest 拉取 + base64 解码 */
    window.fetch = async function () {
      const payload = await WR.db.exportAll();
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      return new Response(JSON.stringify({ sha: 'sha-5', content: b64 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const data = await WR.githubBackup.fetchLatest();
    out.restorePayloadOk = data.app === 'wordrobot' && data.data.libraries.length >= 1;
    await WR.db.wipeAll();
    await WR.githubBackup.restore(data);
    out.restoredLib = (await WR.db.libraries.list()).length;

    /* 历史版本列表 */
    window.fetch = async function () {
      return new Response(JSON.stringify([
        { sha: 'aaa', commit: { message: 'backup 1', author: { date: '2026-08-20T10:00:00Z' } } },
        { sha: 'bbb', commit: { message: 'backup 2', author: { date: '2026-08-21T10:00:00Z' } } }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const h = await WR.githubBackup.history();
    out.historyOk = h.length === 2 && h[0].sha === 'aaa' && h[0].message === 'backup 1';

    window.fetch = realFetch;
  } catch (e) {
    out.ERROR = (e && e.stack) || String(e);
  }
  return JSON.stringify(out);
})()
