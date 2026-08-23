/* 教师模式 · 设置（GitHub 备份配置/恢复/队列/手动导出导入/参数） */
WR.views = WR.views || {};

WR.views.settings = function (app) {
  WR.ui.zone('teacher');
  WR.ui.header({ title: '设置与备份', back: '#/home' });

  const wrap = WR.util.el('div', { class: 'page' });
  app.appendChild(wrap);
  let destroyFlag = false;

  function section(title, node) {
    const card = WR.util.el('div', { class: 'card' });
    card.appendChild(WR.util.el('div', { class: 'card-title', text: title }));
    card.appendChild(node);
    wrap.appendChild(card);
    return card;
  }

  function numField(labelText, value, opts) {
    const box = WR.util.el('div', { class: 'field' });
    box.appendChild(WR.util.el('label', { class: 'field-label', text: labelText }));
    box.appendChild(WR.util.el('input', Object.assign({
      class: 'input', type: 'number', value: String(value)
    }, opts || {})));
    return box;
  }
  function numVal(box) { return Number(box.querySelector('input').value); }

  /* ---------- 听写参数 ---------- */
  (async function () {
    const cfg = await WR.db.settings.merged();
    if (destroyFlag) return;
    const dBox = WR.util.el('div', {});
    const fTotal = numField('每次听写总词数', cfg.dictation.total, { min: 5, max: 200 });
    const fC2E = numField('中译英题数', cfg.dictation.c2e, { min: 0, max: 200 });
    const fE2C = numField('英译中题数', cfg.dictation.e2c, { min: 0, max: 200 });
    const fStep = numField('里程碑步长（已掌握每 N 词）', cfg.reward.milestone_step, { min: 5, max: 200 });
    const fBig = numField('大勋章兑换（每 N 枚小勋章）', cfg.reward.big_badge_per, { min: 2, max: 100 });
    [fTotal, fC2E, fE2C, fStep, fBig].forEach(function (f) { dBox.appendChild(f); });
    dBox.appendChild(WR.util.el('button', {
      class: 'btn btn-primary', text: '保存参数',
      onclick: async function () {
        const total = numVal(fTotal), c2e = numVal(fC2E), e2c = numVal(fE2C);
        if (c2e + e2c !== total) { WR.util.toast('中译英+英译中 必须等于总词数'); return; }
        await WR.db.settings.set('dictation', { total: total, c2e: c2e, e2c: e2c });
        await WR.db.settings.set('reward', { milestone_step: numVal(fStep), big_badge_per: numVal(fBig) });
        WR.util.toast('已保存');
      }
    }));
    section('听写与奖励参数', dBox);

    /* ---------- GitHub 自动备份 ---------- */
    const saved = await WR.db.settings.get('backup', {});
    const gBox = WR.util.el('div', {});
    gBox.appendChild(WR.util.el('p', { class: 'hint', text: '批改完成后自动把备份 JSON 提交到 GitHub 私有仓库（backup-latest.json），每次备份即一次 commit，可回滚历史。配置指引见 docs/github-backup-setup.md。' }));
    const mk = function (label, val, ph) {
      const box = WR.util.el('div', { class: 'field' });
      box.appendChild(WR.util.el('label', { class: 'field-label', text: label }));
      box.appendChild(WR.util.el('input', { class: 'input', type: 'text', value: val || '', placeholder: ph }));
      return box;
    };
    const fOwner = mk('备份仓库 owner（用户名）', saved.repo_owner, '如 zhang-san');
    const fRepo = mk('备份仓库名（私有）', saved.repo_name, '如 wordrobot-backup');
    const fToken = mk('Fine-grained PAT（仅授予该仓库 Contents 读写）', saved.github_token, 'github_pat_...');
    fToken.querySelector('input').type = 'password';
    [fOwner, fRepo, fToken].forEach(function (f) { gBox.appendChild(f); });
    const gBtns = WR.util.el('div', { class: 'row' });
    gBtns.appendChild(WR.util.el('button', {
      class: 'btn btn-primary', text: '保存并测试',
      onclick: async function () {
        await WR.db.settings.set('backup', {
          repo_owner: fOwner.querySelector('input').value.trim(),
          repo_name: fRepo.querySelector('input').value.trim(),
          github_token: fToken.querySelector('input').value.trim()
        });
        try {
          await WR.githubBackup.testConnection();
          WR.util.toast('连接成功 ✓');
        } catch (e) {
          WR.util.toast('连接失败：' + (e.message || e) + (e.status === 401 ? '（Token 无效或过期）' : e.status === 404 ? '（仓库不存在或无权限）' : ''));
        }
      }
    }));
    gBtns.appendChild(WR.util.el('button', {
      class: 'btn btn-secondary', text: '立即备份一次',
      onclick: async function () {
        if (!(await WR.githubBackup.configured())) { WR.util.toast('请先保存备份仓库配置'); return; }
        WR.util.toast('正在备份…');
        const r = await WR.githubBackup.backupNow('manual backup ' + WR.util.tsName(new Date()));
        WR.util.toast(r.ok ? '已备份到 GitHub ✓' : '备份失败，已入重试队列');
      }
    }));
    gBox.appendChild(gBtns);
    const gCard = section('GitHub 自动备份', gBox);

    /* 队列状态 */
    const qBox = WR.util.el('div', { class: 'row-space' });
    const qInfo = WR.util.el('span', { class: 'hint', text: '' });
    qBox.appendChild(qInfo);
    qBox.appendChild(WR.util.el('button', {
      class: 'btn btn-small', text: '重试积压',
      onclick: async function () {
        const rs = await WR.githubBackup.retryPending();
        WR.util.toast(rs.length ? (rs.every(function (r) { return r.ok; }) ? '积压备份已全部补交 ✓' : '部分重试仍失败') : '没有积压');
        renderQueue();
      }
    }));
    gCard.appendChild(qBox);
    async function renderQueue() {
      const pending = await WR.db.queue.pendingList();
      qInfo.textContent = '积压备份：' + pending.length + ' 条';
      qInfo.classList.toggle('warn-text', pending.length > 0);
    }
    renderQueue();

    /* ---------- 恢复 ---------- */
    const rBox = WR.util.el('div', {});
    const rBtns = WR.util.el('div', { class: 'row' });
    rBtns.appendChild(WR.util.el('button', {
      class: 'btn btn-secondary', text: '从 GitHub 恢复最新版',
      onclick: async function () {
        if (!(await WR.githubBackup.configured())) { WR.util.toast('请先配置 GitHub 备份'); return; }
        if (!await WR.util.confirmAsync('将用云端最新备份覆盖本机全部数据，继续？')) return;
        try {
          const data = await WR.githubBackup.fetchLatest();
          await WR.db.replaceAll(data);
          WR.util.toast('恢复完成 ✓');
          setTimeout(function () { location.hash = '#/home'; location.reload(); }, 800);
        } catch (e) {
          WR.util.toast('恢复失败：' + (e.message || e));
        }
      }
    }));
    rBtns.appendChild(WR.util.el('button', {
      class: 'btn btn-secondary', text: '查看历史版本',
      onclick: showHistory
    }));
    rBox.appendChild(rBtns);
    const fileInput = WR.util.el('input', { type: 'file', accept: '.json,application/json', class: 'hidden-file' });
    fileInput.addEventListener('change', async function () {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      if (!await WR.util.confirmAsync('将用该备份文件覆盖本机全部数据，继续？')) return;
      try {
        await WR.backup.importFile(f);
        WR.util.toast('导入完成 ✓');
        setTimeout(function () { location.hash = '#/home'; location.reload(); }, 800);
      } catch (e) {
        WR.util.toast('导入失败：' + (e.message || e));
      }
    });
    rBox.appendChild(fileInput);
    rBox.appendChild(WR.util.el('button', {
      class: 'btn btn-secondary', text: '从本地备份文件导入',
      onclick: function () { fileInput.click(); }
    }));
    section('恢复', rBox);

    async function showHistory() {
      if (!(await WR.githubBackup.configured())) { WR.util.toast('请先配置 GitHub 备份'); return; }
      const box = WR.util.el('div', {});
      box.appendChild(WR.ui.spinner('读取提交历史…'));
      const m = WR.ui.modal({ title: '备份历史（最近 30 次）', body: box, actions: [{ text: '关闭' }] });
      try {
        const list = await WR.githubBackup.history();
        box.innerHTML = '';
        if (!list.length) box.appendChild(WR.ui.empty('还没有备份'));
        list.forEach(function (h) {
          const row = WR.util.el('div', { class: 'history-row' });
          row.appendChild(WR.util.el('div', { class: 'list-item-main' }, [
            WR.util.el('div', { class: 'list-item-title', text: h.message }),
            WR.util.el('div', { class: 'list-item-sub', text: (h.date || '').replace('T', ' ').slice(0, 19) + ' · ' + h.sha.slice(0, 7) })
          ]));
          row.appendChild(WR.util.el('button', {
            class: 'btn btn-small', text: '恢复',
            onclick: async function () {
              if (!await WR.util.confirmAsync('恢复到该版本？当前数据将被覆盖')) return;
              try {
                const v = await WR.githubBackup.fetchVersion(h.sha);
                await WR.db.replaceAll(v.data);
                WR.util.toast('恢复完成 ✓');
                m.close();
                setTimeout(function () { location.hash = '#/home'; location.reload(); }, 800);
              } catch (e) { WR.util.toast('恢复失败：' + (e.message || e)); }
            }
          }));
          box.appendChild(row);
        });
      } catch (e) {
        box.innerHTML = '';
        box.appendChild(WR.ui.empty('读取失败：' + (e.message || e)));
      }
    }

    /* ---------- 手动备份 ---------- */
    const mBox = WR.util.el('div', { class: 'row' });
    mBox.appendChild(WR.util.el('button', {
      class: 'btn btn-secondary', text: '导出备份文件',
      onclick: async function () { await WR.backup.exportFile(); WR.util.toast('已导出到“文件”/下载'); }
    }));
    const persistBtn = WR.util.el('button', { class: 'btn btn-secondary', text: '' });
    async function refreshPersist() {
      const granted = await WR.backup.persistenceGranted();
      persistBtn.textContent = granted ? '存储持久化：已开启 ✓' : '申请存储持久化';
      persistBtn.disabled = granted;
    }
    persistBtn.addEventListener('click', async function () {
      const ok = await WR.backup.requestPersistence();
      WR.util.toast(ok ? '已开启持久化 ✓' : '系统暂未授予，不影响使用');
      refreshPersist();
    });
    mBox.appendChild(persistBtn);
    refreshPersist();
    section('手动备份（次要通道）', mBox);

    /* ---------- 危险区 ---------- */
    const dz = WR.util.el('div', {});
    dz.appendChild(WR.util.el('p', { class: 'hint', text: '清空本机全部数据（词库/批改/勋章/设置）。清空前建议先导出备份。' }));
    dz.appendChild(WR.util.el('button', {
      class: 'btn btn-danger', text: '清空全部数据',
      onclick: async function () {
        if (!await WR.util.confirmAsync('确定清空全部数据？不可恢复！')) return;
        if (!await WR.util.confirmAsync('最后确认：真的要清空吗？')) return;
        await WR.db.wipeAll();
        WR.util.toast('已清空');
        setTimeout(function () { location.hash = '#/home'; location.reload(); }, 600);
      }
    }));
    section('危险区', dz);
  })();

  return { destroy: function () { destroyFlag = true; } };
};
