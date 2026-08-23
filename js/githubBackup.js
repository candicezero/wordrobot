/* GitHub 备份（设计 §5.7）：fine-grained PAT + Contents API 直存 backup-latest.json */
WR.githubBackup = (function () {
  const API = 'https://api.github.com';
  const PATH = '/contents/backup-latest.json';

  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(b64) {
    return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ''))));
  }

  async function cfg() {
    const s = await WR.db.settings.get('backup', {});
    return {
      owner: (s.repo_owner || '').trim(), repo: (s.repo_name || '').trim(),
      token: (s.github_token || '').trim()
    };
  }

  async function configured() {
    const c = await cfg();
    return !!(c.owner && c.repo && c.token);
  }

  async function api(path, opts) {
    opts = opts || {};
    const c = await cfg();
    const headers = {
      'Authorization': 'token ' + c.token,
      'Accept': 'application/vnd.github+json'
    };
    if (opts.headers) Object.assign(headers, opts.headers);
    const res = await fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body });
    if (!res.ok) {
      const err = new Error('GitHub API ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async function commitLatest(commitMsg, payloadStr) {
    const c = await cfg();
    const full = '/repos/' + c.owner + '/' + c.repo + PATH;
    let sha = null;
    try {
      const meta = await api(full);
      sha = meta && meta.sha;
    } catch (e) {
      if (e.status !== 404) throw e; // 404 = 首次备份，尚无文件
    }
    return api(full, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMsg,
        content: b64encode(payloadStr),
        sha: sha || undefined
      })
    });
  }

  /* 批改完成后调用；失败自动入重试队列 */
  async function backupNow(commitMsg) {
    const payload = await WR.db.exportAll();
    const str = JSON.stringify(payload);
    try {
      await commitLatest(commitMsg, str);
      return { ok: true, queued: false };
    } catch (e) {
      try { await WR.db.queue.enqueue(str, commitMsg); } catch (e2) { /* ignore */ }
      return { ok: false, queued: true, error: e };
    }
  }

  async function retryPending() {
    const list = await WR.db.queue.pendingList();
    const results = [];
    for (const q of list) {
      try {
        await commitLatest(q.commit_msg, q.payload_json);
        await WR.db.queue.markSent(q.id);
        results.push({ id: q.id, ok: true });
      } catch (e) {
        await WR.db.queue.markFailed(q.id);
        results.push({ id: q.id, ok: false, error: String(e && e.message || e) });
      }
    }
    return results;
  }

  async function testConnection() {
    const c = await cfg();
    await api('/repos/' + c.owner + '/' + c.repo);
    return true;
  }

  async function fetchLatest() {
    const c = await cfg();
    const meta = await api('/repos/' + c.owner + '/' + c.repo + PATH);
    return JSON.parse(b64decode(meta.content));
  }

  async function fetchVersion(sha) {
    const c = await cfg();
    const meta = await api('/repos/' + c.owner + '/' + c.repo + PATH + '?ref=' + encodeURIComponent(sha));
    return { data: JSON.parse(b64decode(meta.content)), meta: meta };
  }

  async function history() {
    const c = await cfg();
    const list = await api('/repos/' + c.owner + '/' + c.repo +
      '/commits?path=backup-latest.json&per_page=30');
    return (list || []).map(function (x) {
      return {
        sha: x.sha,
        message: x.commit && x.commit.message || '',
        date: x.commit && x.commit.author && x.commit.author.date || ''
      };
    });
  }

  async function restore(payload) {
    await WR.db.replaceAll(payload);
  }

  return {
    configured: configured, backupNow: backupNow, retryPending: retryPending,
    testConnection: testConnection, fetchLatest: fetchLatest, fetchVersion: fetchVersion,
    history: history, restore: restore
  };
})();
