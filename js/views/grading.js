/* 教师模式 · 听写任务列表 + 批改页（多学生 / checkbox / 草稿 / 批改完成） */
WR.views = WR.views || {};

/* ---------- 任务列表 ---------- */
WR.views.sessions = function (app) {
  WR.ui.zone('teacher');
  WR.ui.header({ title: '听写任务', back: '#/home' });

  const wrap = WR.util.el('div', { class: 'page' });
  const listBox = WR.util.el('div', { class: 'card' });
  listBox.appendChild(WR.ui.spinner());
  wrap.appendChild(listBox);
  app.appendChild(wrap);

  (async function () {
    const sessions = await WR.db.sessions.listDesc();
    const libs = {};
    (await WR.db.libraries.list()).forEach(function (l) { libs[l.id] = l; });
    listBox.innerHTML = '';
    if (!sessions.length) {
      listBox.appendChild(WR.ui.empty('还没有听写任务，去孩子模式开始一次吧'));
      return;
    }
    for (const se of sessions) {
      const grads = await WR.db.gradings.bySession(se.id);
      const row = WR.util.el('div', { class: 'session-row' });
      row.appendChild(WR.util.el('div', { class: 'list-item-main' }, [
        WR.util.el('div', { class: 'list-item-title' }, [
          WR.util.el('span', { class: 'ts-name', text: se.ts_name }),
          WR.util.el('span', { class: 'tag', text: (libs[se.library_id] ? libs[se.library_id].name : '已删除词库') })
        ]),
        WR.util.el('div', { class: 'list-item-sub', text: se.total + ' 题（中译英 ' + se.c2e_count + ' / 英译中 ' + se.e2c_count + '） · ' + WR.util.fmtDateTime(se.created_at) + (grads.length ? ' · 已批改 ' + grads.length + ' 人' : '') })
      ]));
      const ops = WR.util.el('div', { class: 'row-inline' });
      ops.appendChild(WR.util.el('button', {
        class: 'btn btn-small btn-primary', text: '批改',
        onclick: function () { WR.router.nav('#/teacher/grading/' + se.ts_name); }
      }));
      ops.appendChild(WR.util.el('button', {
        class: 'btn btn-small', text: '答案页',
        onclick: async function () { await exportAnswerSheet(se.ts_name); }
      }));
      row.appendChild(ops);
      listBox.appendChild(row);
    }
  })();
};

/* 导出打印版标准答案页（可存 PDF / 打印） */
async function exportAnswerSheet(tsName) {
  const session = await WR.db.sessions.byTsName(tsName);
  if (!session) { WR.util.toast('任务不存在'); return; }
  const items = await WR.db.sessions.items(session.id);
  const libs = await WR.db.libraries.list();
  const lib = libs.find(function (l) { return l.id === session.library_id; });
  const esc = WR.util.esc;
  const rows = items.map(function (it) {
    const stem = JSON.parse(it.stem_json || '{}');
    const ans = JSON.parse(it.answer_json || '{}');
    let stemText, ansText;
    if (it.q_type === 'C2E') {
      stemText = (stem.zh || '') + (stem.pos ? '（' + stem.pos + '）' : '') + ' ' + (stem.first_letter || '') + '______';
      ansText = (ans.word || '') + '  ' + (ans.phonetic || '');
    } else {
      stemText = (stem.word || '') + (stem.pos ? '（' + stem.pos + '）' : '');
      ansText = ans.meaning || '';
    }
    return '<tr><td>' + it.seq + '</td><td>' + (it.q_type === 'C2E' ? '中译英' : '英译中') + '</td>' +
      '<td>' + esc(stemText) + '</td><td>' + esc(ansText) + '</td></tr>';
  }).join('');
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>听写答案 ' + esc(session.ts_name) + '</title><style>' +
    'body{font-family:-apple-system,"PingFang SC",sans-serif;margin:24px;color:#111}' +
    'h1{font-size:20px;margin:0 0 4px}p{color:#555;margin:0 0 16px;font-size:13px}' +
    'table{width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed}' +
    'th,td{border:1px solid #999;padding:6px 8px;text-align:left;word-break:break-all}' +
    'th{background:#f0f0f0}.c{text-align:center;width:44px}' +
    '@media print{body{margin:0}}' +
    '</style></head><body>' +
    '<h1>听写标准答案 · ' + esc(lib ? lib.name : '') + '</h1>' +
    '<p>' + esc(session.ts_name) + ' · 共 ' + items.length + ' 题（中译英 ' + session.c2e_count + ' / 英译中 ' + session.e2c_count + '）</p>' +
    '<table><thead><tr><th class="c">序号</th><th class="c">题型</th><th>题干</th><th>标准答案</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></body></html>';
  WR.backup.download('答案-' + session.ts_name + '.html', html, 'text/html');
  WR.util.toast('答案页已导出，可在“文件”中打开并打印');
}

/* ---------- 批改页 ---------- */
WR.views.grading = function (app, params) {
  WR.ui.zone('teacher');
  const wrap = WR.util.el('div', { class: 'page' });
  wrap.appendChild(WR.ui.spinner());
  app.appendChild(wrap);

  let destroyFlag = false;
  let students = [], items = [], session = null;
  let currentStudent = null;
  const checked = {};   // itemId → true（当前学生的勾选状态）

  (async function () {
    session = await WR.db.sessions.byTsName(params.ts);
    if (!session) { WR.util.toast('听写任务不存在'); WR.router.nav('#/teacher/sessions'); return; }
    items = await WR.db.sessions.items(session.id);
    students = await WR.db.students.list();
    const libs = await WR.db.libraries.list();
    const lib = libs.find(function (l) { return l.id === session.library_id; });
    if (destroyFlag) return;

    WR.ui.header({
      title: '批改 · ' + session.ts_name,
      subtitle: (lib ? lib.name : '') + ' · ' + items.length + ' 题',
      back: '#/teacher/sessions'
    });

    if (students.length) {
      currentStudent = students[0];
      await loadDraft();
    }
    render();
  })();

  async function loadDraft() {
    for (const k in checked) delete checked[k];
    if (!currentStudent) return;
    const gradings = await WR.db.gradings.bySession(session.id);
    const saved = gradings.find(function (g) { return g.student_id === currentStudent.id; });
    if (saved) {
      try { JSON.parse(saved.wrong_item_ids || '[]').forEach(function (id) { checked[id] = true; }); } catch (e) { /* ignore */ }
      return;
    }
    const draft = await WR.db.drafts.get(session.id, currentStudent.id);
    if (draft) {
      try { JSON.parse(draft.checked_ids || '[]').forEach(function (id) { checked[id] = true; }); } catch (e) { /* ignore */ }
    }
  }

  const saveDraft = WR.util.debounce(async function () {
    if (!currentStudent || !session) return;
    await WR.db.drafts.put(session.id, currentStudent.id, Object.keys(checked).map(Number));
  }, 400);

  async function render() {
    if (destroyFlag) return;
    wrap.innerHTML = '';

    /* 学生条 */
    const stuCard = WR.util.el('div', { class: 'card' });
    stuCard.appendChild(WR.util.el('div', { class: 'card-title', text: '学生' }));
    const chips = WR.util.el('div', { class: 'chip-row' });
    const gradings = await WR.db.gradings.bySession(session.id);
    students.forEach(function (s) {
      const g = gradings.find(function (x) { return x.student_id === s.id; });
      const active = currentStudent && s.id === currentStudent.id;
      const chip = WR.util.el('button', {
        class: 'chip' + (active ? ' active' : ''),
        onclick: async function () { currentStudent = s; await loadDraft(); render(); }
      }, s.name + (g ? '（' + g.score + '分）' : ''));
      chips.appendChild(chip);
    });
    chips.appendChild(WR.util.el('button', {
      class: 'chip chip-add', text: '＋ 新学生',
      onclick: async function () {
        const name = window.prompt('学生姓名');
        if (name === null) return;
        if (!name.trim()) return;
        const s = await WR.db.students.create(name);
        students.push(s);
        currentStudent = s;
        await loadDraft();
        render();
      }
    }));
    stuCard.appendChild(chips);
    wrap.appendChild(stuCard);

    if (!currentStudent) {
      wrap.appendChild(WR.ui.empty('请先添加学生'));
      return;
    }

    /* 题目勾选 */
    const itemCard = WR.util.el('div', { class: 'card' });
    const head = WR.util.el('div', { class: 'row-space' });
    head.appendChild(WR.util.el('div', { class: 'card-title', text: '勾选“本次答错”的题目' }));
    head.appendChild(WR.util.el('div', { class: 'row-inline' }, [
      WR.util.el('button', { class: 'btn btn-small btn-ghost', text: '全清', onclick: function () { for (const k in checked) delete checked[k]; render(); } })
    ]));
    itemCard.appendChild(head);

    items.forEach(function (it) {
      const stem = JSON.parse(it.stem_json || '{}');
      const ans = JSON.parse(it.answer_json || '{}');
      let stemText, ansText;
      if (it.q_type === 'C2E') {
        stemText = (stem.zh || '') + (stem.pos ? '（' + stem.pos + '）' : '') + ' ' + (stem.first_letter || '') + '______';
        ansText = (ans.word || '') + (ans.phonetic ? '  ' + ans.phonetic : '');
      } else {
        stemText = (stem.word || '') + (stem.pos ? '（' + stem.pos + '）' : '');
        ansText = ans.meaning || '（缺释义）';
      }
      const label = WR.util.el('label', { class: 'grade-row' + (checked[it.id] ? ' wrong' : '') });
      label.appendChild(WR.util.el('input', {
        type: 'checkbox', class: 'grade-check',
        ...(checked[it.id] ? { checked: '' } : {}),
        onclick: async function (e) {
          if (e.target.checked) checked[it.id] = true;
          else delete checked[it.id];
          e.target.closest('.grade-row').classList.toggle('wrong', e.target.checked);
          wrongCount().then(function (n) {
            const el = document.getElementById('wrong-count');
            if (el) el.textContent = String(n);
          });
          saveDraft();
        }
      }));
      label.appendChild(WR.util.el('span', { class: 'seq', text: String(it.seq) }));
      label.appendChild(WR.util.el('span', { class: 'qtype', text: it.q_type === 'C2E' ? '中⇢英' : '英⇢中' }));
      label.appendChild(WR.util.el('span', { class: 'stem', text: stemText }));
      label.appendChild(WR.util.el('span', { class: 'answer', text: ansText }));
      itemCard.appendChild(label);
    });
    wrap.appendChild(itemCard);

    /* 底部操作 */
    const actionCard = WR.util.el('div', { class: 'card' });
    const wrongNow = await wrongCount();
    actionCard.appendChild(WR.util.el('div', { class: 'grade-summary' }, [
      WR.util.el('span', { text: '答错题数：' }),
      WR.util.el('span', { class: 'wrong-count', id: 'wrong-count', text: String(wrongNow) }),
      WR.util.el('span', { class: 'hint', text: '（保存后权重更新、错词进下次词表）' })
    ]));
    actionCard.appendChild(WR.util.el('button', {
      class: 'btn btn-primary btn-big', text: '批改完成',
      onclick: finishGrading
    }));
    wrap.appendChild(actionCard);
  }

  function wrongCount() {
    return Promise.resolve(Object.keys(checked).length);
  }

  async function finishGrading() {
    if (!currentStudent) return;
    const wrongIds = Object.keys(checked).map(Number);
    const cfgAll = await WR.db.settings.merged();
    const result = await WR.grading.saveGrading({
      session: session, items: items, student: currentStudent,
      wrongItemIds: wrongIds,
      cfg: cfgAll.selection, rewardCfg: cfgAll.reward
    });

    let msg = currentStudent.name + '：' + result.score + ' 分，错 ' + result.wrongItems.length + ' 题';
    if (result.bigBadgeEarned) msg += '，兑换 1 枚大勋章 🏆';
    if (result.milestones.length) msg += '，里程碑达成 ' + result.milestones.join('/') + ' 词！';
    WR.util.toast(msg, 3500);

    /* 自动 GitHub 备份（失败入队，不阻塞） */
    const backupMsg = 'backup ' + session.ts_name + ' ' + currentStudent.name + ' ' + result.score + '分';
    if (await WR.githubBackup.configured()) {
      WR.githubBackup.backupNow(backupMsg).then(function (r) {
        if (r.ok) WR.util.toast('已自动备份到 GitHub ✓');
        else WR.util.toast('自动备份失败，已加入重试队列（' + (r.error && r.error.status || '') + '）');
      });
    } else {
      WR.ui.modal({
        title: '未配置自动备份',
        body: '<p>批改已保存。建议在「设置」中配置 GitHub 自动备份，或在“备份”页手动导出。</p>',
        actions: [
          { text: '去设置', class: 'btn-primary', onclick: function (close) { close(); WR.router.nav('#/teacher/settings'); } },
          { text: '知道了', class: 'btn-secondary' }
        ]
      });
    }
    render();
  }

  return {
    destroy: function () { destroyFlag = true; }
  };
};
