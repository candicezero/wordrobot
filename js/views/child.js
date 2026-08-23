/* 孩子模式 · 首页（选词库+勋章墙）、听写互动（TTS/ASR）、完成页（表扬/里程碑） */
WR.views = WR.views || {};

const POS_ZH = {
  'n.': '名词', 'v.': '动词', 'adj.': '形容词', 'adv.': '副词',
  'prep.': '介词', 'conj.': '连词', 'pron.': '代词', 'num.': '数词',
  'int.': '感叹词', 'interj.': '感叹词', 'art.': '冠词', 'aux.': '助动词',
  'abbr.': '缩写', 'vi.': '不及物动词', 'vt.': '及物动词'
};
function posToZh(pos) {
  return String(pos || '').split('/').map(function (p) {
    return POS_ZH[p] || p.replace(/\.$/, '');
  }).join('、');
}

/* ---------- 孩子首页 ---------- */
let childLibSelId = null; /* 模块级：词库选择在 router.refresh 后保留 */

WR.views.childHome = function (app) {
  WR.ui.zone('child');
  WR.ui.header({ title: '开始听写', back: '#/home' });

  const wrap = WR.util.el('div', { class: 'page child-page' });
  app.appendChild(wrap);
  let destroyFlag = false;

  (async function () {
    const cfg = await WR.db.settings.merged();
    const students = await WR.db.students.list();
    const libs = await WR.db.libraries.list();
    if (destroyFlag) return;

    if (!students.length) {
      wrap.appendChild(WR.ui.empty('还没有学生'));
      wrap.appendChild(WR.util.el('button', {
        class: 'btn btn-primary', text: '去添加学生',
        onclick: function () { WR.router.nav('#/teacher/students'); }
      }));
      return;
    }
    if (!libs.length) {
      wrap.appendChild(WR.ui.empty('还没有词库，请请爸爸妈妈先建词库'));
      return;
    }

    let studentId = await WR.db.settings.get('child_student_id', null);
    let student = students.find(function (s) { return s.id === studentId; }) || students[0];
    let library = libs.find(function (l) { return l.id === childLibSelId; }) ||
      libs[0]; // list() 已按 updated_at 倒序 → 默认最近录入的词库

    /* 学生选择 */
    const stuCard = WR.util.el('div', { class: 'card' });
    stuCard.appendChild(WR.util.el('div', { class: 'card-title small', text: '我是' }));
    const chips = WR.util.el('div', { class: 'chip-row' });
    students.forEach(function (s) {
      chips.appendChild(WR.util.el('button', {
        class: 'chip' + (s.id === student.id ? ' active' : ''),
        text: s.name,
        onclick: function () {
          student = s;
          WR.db.settings.set('child_student_id', s.id);
          WR.router.refresh();
        }
      }));
    });
    stuCard.appendChild(chips);
    wrap.appendChild(stuCard);

    /* 词库选择 */
    const libCard = WR.util.el('div', { class: 'card' });
    libCard.appendChild(WR.util.el('div', { class: 'card-title small', text: '今天听写哪个词库？' }));
    const libList = WR.util.el('div', { class: 'chip-row wrap' });
    libs.forEach(function (l) {
      libList.appendChild(WR.util.el('button', {
        class: 'chip' + (l.id === library.id ? ' active' : ''),
        text: l.name,
        onclick: function () {
          childLibSelId = l.id;
          WR.router.refresh();
        }
      }));
    });
    libCard.appendChild(libList);
    wrap.appendChild(libCard);

    /* 勋章墙 */
    const counts = await WR.db.badges.countsByStudent(student.id);
    const masteredCount = await WR.db.mastered.countByLibrary(library.id);
    const pending = (await WR.db.milestones.listByLibrary(library.id)).filter(function (m) { return !m.shown_at; });
    const toNext = WR.reward.toNextMilestone(masteredCount, cfg.reward.milestone_step);

    const wall = WR.util.el('div', { class: 'card badge-wall' });
    wall.appendChild(WR.util.el('div', { class: 'badge-item' }, [
      WR.util.el('div', { class: 'badge-emoji', text: '⭐' }),
      WR.util.el('div', { class: 'badge-num', text: String(counts.small) }),
      WR.util.el('div', { class: 'badge-label', text: '小勋章' })
    ]));
    wall.appendChild(WR.util.el('div', { class: 'badge-item' }, [
      WR.util.el('div', { class: 'badge-emoji', text: '🏆' }),
      WR.util.el('div', { class: 'badge-num', text: String(counts.big) }),
      WR.util.el('div', { class: 'badge-label', text: '大勋章' })
    ]));
    wall.appendChild(WR.util.el('div', { class: 'badge-item' }, [
      WR.util.el('div', { class: 'badge-emoji', text: '📚' }),
      WR.util.el('div', { class: 'badge-num', text: String(masteredCount) }),
      WR.util.el('div', { class: 'badge-label', text: '已掌握单词' })
    ]));
    wrap.appendChild(wall);

    const nextHint = WR.util.el('div', { class: 'milestone-hint' });
    nextHint.textContent = pending.length
      ? '🎉 有 ' + pending.length + ' 个新成就等你看！'
      : '再掌握 ' + toNext + ' 个单词就达成新里程碑！';
    wrap.appendChild(nextHint);

    /* 开始按钮 */
    wrap.appendChild(WR.util.el('button', {
      class: 'btn btn-big btn-start', text: '开始听写！',
      onclick: function () { startDictation(library.id, cfg); }
    }));
  })();

  async function startDictation(libId, cfg) {
    const active = await WR.db.words.listByLibrary(libId);
    const wrongPool = await WR.grading.wrongPoolForLibrary(libId);
    if (active.length + wrongPool.length < 5) {
      WR.util.toast('词库单词不足 5 个，请先扩充词库', 3000);
      return;
    }
    const built = WR.selector.buildItems({
      activeWords: active, wrongWords: wrongPool,
      total: cfg.dictation.total, c2e: cfg.dictation.c2e, e2c: cfg.dictation.e2c
    });
    if (!built.items.length) { WR.util.toast('没有可用的单词'); return; }
    if (built.total < cfg.dictation.total) {
      WR.util.toast('词库共 ' + built.total + ' 词，全部入选', 2600);
    }
    const session = await WR.db.sessions.create(libId, built.items);
    WR.router.nav('#/child/dictation/' + session.ts_name);
  }

  return { destroy: function () { destroyFlag = true; } };
};

/* ---------- 听写互动 ---------- */
WR.views.dictation = function (app, params) {
  WR.ui.zone('child');
  const wrap = WR.util.el('div', { class: 'page child-page' });
  app.appendChild(wrap);
  wrap.appendChild(WR.ui.spinner());

  let destroyFlag = false;
  let session = null, items = [], idx = 0, busy = false;
  let asrActive = false;

  (async function () {
    session = await WR.db.sessions.byTsName(params.ts);
    if (!session) { WR.util.toast('听写任务不存在'); WR.router.nav('#/child'); return; }
    items = await WR.db.sessions.items(session.id);
    if (destroyFlag) return;

    WR.ui.header({
      title: '听写中',
      subtitle: '',
      back: '#/home',
      actions: [{ text: '退出', class: 'danger-link', onclick: exit }]
    });
    renderStartOverlay();
  })();

  function renderStartOverlay() {
    wrap.innerHTML = '';
    const ov = WR.util.el('div', { class: 'start-overlay' });
    ov.appendChild(WR.util.el('div', { class: 'start-emoji', text: '🎧' }));
    ov.appendChild(WR.util.el('div', { class: 'start-title', text: '准备好纸和笔' }));
    ov.appendChild(WR.util.el('div', { class: 'start-sub', text: '共 ' + items.length + ' 题。机器人念题，你说“下一个”或点按钮前进；没听清就说“再说一遍”。' }));
    const startBtn = WR.util.el('button', { class: 'btn btn-big btn-start', text: '开始听写！' });
    startBtn.addEventListener('click', async function () {
      WR.tts.unlock();
      startAsr();
      idx = 0;
      renderQuestion();
      await speakCurrent();
    }, { once: true });
    ov.appendChild(startBtn);
    ov.appendChild(WR.util.el('div', { class: 'hint', text: WR.asr.supported ? '🎤 可以用语音口令控制' : '（当前浏览器不支持语音口令，用按钮即可）' }));
    wrap.appendChild(ov);
  }

  function startAsr() {
    if (!WR.asr.supported) return;
    asrActive = WR.asr.start(function (cmd) {
      if (busy) return;
      if (cmd === 'repeat') repeat();
      else if (cmd === 'next') next();
    }, function (err) {
      asrActive = false;
      WR.util.toast('语音口令不可用（' + err + '），请用按钮操作', 3000);
      const dot = document.getElementById('asr-dot');
      if (dot) dot.classList.remove('on');
    });
    return asrActive;
  }

  function stemText(stem, qType) {
    if (qType === 'C2E') {
      const posPart = stem.pos ? ' <span class="pos">' + WR.util.esc(stem.pos) + '</span>' : '';
      return '<span class="zh">' + WR.util.esc(stem.zh || '') + posPart + '</span>' +
        '<span class="blank-hint">' + WR.util.esc(stem.first_letter || '') + ' ______</span>';
    }
    const posPart = stem.pos ? ' <span class="pos">' + WR.util.esc(stem.pos) + '</span>' : '';
    return '<span class="en-word">' + WR.util.esc(stem.word || '') + posPart + '</span><span class="blank-hint">______</span>';
  }

  function renderQuestion() {
    const it = items[idx];
    const stem = JSON.parse(it.stem_json || '{}');
    wrap.innerHTML = '';

    const progress = WR.util.el('div', { class: 'dict-progress' });
    progress.appendChild(WR.util.el('span', { class: 'dict-count', text: (idx + 1) + ' / ' + items.length }));
    progress.appendChild(WR.util.el('span', { class: 'qtype-badge ' + (it.q_type === 'C2E' ? 'c2e' : 'e2c'), text: it.q_type === 'C2E' ? '中译英' : '英译中' }));
    if (it.from_wrong_pool) progress.appendChild(WR.util.el('span', { class: 'tag tag-star', title: '来自错词池', text: '错词重练' }));
    if (asrActive) progress.appendChild(WR.util.el('span', { class: 'asr-dot on', id: 'asr-dot', text: '🎤' }));
    wrap.appendChild(progress);

    const q = WR.util.el('div', { class: 'question-card' });
    q.innerHTML = stemText(stem, it.q_type);
    wrap.appendChild(q);

    const btns = WR.util.el('div', { class: 'dict-btns' });
    const repeatBtn = WR.util.el('button', { class: 'btn btn-secondary btn-big', text: '🔊 再听一遍' });
    repeatBtn.addEventListener('click', function () { repeat(); });
    const nextBtn = WR.util.el('button', { class: 'btn btn-primary btn-big', text: idx === items.length - 1 ? '🎉 完成！' : '下一题 ➜' });
    nextBtn.addEventListener('click', function () { next(); });
    btns.appendChild(repeatBtn);
    btns.appendChild(nextBtn);
    wrap.appendChild(btns);

    const tips = WR.util.el('div', { class: 'hint center', text: '在纸上写答案，写完点“下一题”' });
    wrap.appendChild(tips);
  }

  async function speakCurrent() {
    const it = items[idx];
    if (!it) return;
    const stem = JSON.parse(it.stem_json || '{}');
    const segs = [];
    if (it.q_type === 'C2E') {
      segs.push({ lang: 'zh', text: '第' + it.seq + '题。' });
      let t = '中文意思：' + (stem.zh || '') + '。';
      if (stem.pos) t += '词性：' + posToZh(stem.pos) + '。';
      if (stem.first_letter) t += '首字母提示：' + stem.first_letter + '。';
      t += '请写出这个英文单词。';
      segs.push({ lang: 'zh', text: t });
    } else {
      segs.push({ lang: 'zh', text: '第' + it.seq + '题。' });
      segs.push({ lang: 'zh', text: '英文单词：' });
      /* 英文单词读两遍（已确认行为） */
      segs.push({ lang: 'en', text: stem.word || '', rate: 0.75 });
      segs.push({ lang: 'en', text: stem.word || '', rate: 0.75 });
      let t = '';
      if (stem.pos) t += '词性：' + posToZh(stem.pos) + '。';
      t += '请写出中文意思。';
      segs.push({ lang: 'zh', text: t });
    }
    busy = true;
    WR.asr.suspend();
    try {
      await WR.tts.speak(segs);
    } finally {
      busy = false;
      WR.asr.resume();
    }
  }

  async function repeat() {
    if (busy) { WR.tts.stop(); }
    await speakCurrent();
  }

  async function next() {
    if (busy) WR.tts.stop();
    busy = false;
    idx++;
    if (idx >= items.length) {
      finish();
      return;
    }
    renderQuestion();
    await speakCurrent();
  }

  async function finish() {
    WR.asr.stop();
    WR.tts.stop();
    try {
      await WR.tts.speak([
        { lang: 'zh', text: '今天 ' + items.length + ' 题已经完成！' },
        { lang: 'zh', text: '你真棒！' }
      ]);
    } catch (e) { /* ignore */ }
    WR.router.nav('#/child/done/' + session.ts_name);
  }

  function exit() {
    WR.util.confirmAsync('退出本次听写？（进度不会保存）').then(function (ok) {
      if (!ok) return;
      WR.asr.stop();
      WR.tts.stop();
      WR.router.nav('#/child');
    });
  }

  return {
    destroy: function () {
      destroyFlag = true;
      WR.asr.stop();
      WR.tts.stop();
    }
  };
};

/* ---------- 完成页 ---------- */
WR.views.childDone = function (app, params) {
  WR.ui.zone('child');
  const wrap = WR.util.el('div', { class: 'page child-page' });
  app.appendChild(wrap);
  wrap.appendChild(WR.ui.spinner());
  let destroyFlag = false;

  (async function () {
    const session = await WR.db.sessions.byTsName(params.ts);
    if (!session) { WR.router.nav('#/child'); return; }
    const libs = await WR.db.libraries.list();
    const lib = libs.find(function (l) { return l.id === session.library_id; });
    const pendingAll = await WR.db.milestones.pendingAll();
    const pending = pendingAll.filter(function (m) { return m.library_id === session.library_id; });
    if (destroyFlag) return;

    WR.ui.header({ title: '今日完成！', back: '#/home' });
    wrap.innerHTML = '';

    const card = WR.util.el('div', { class: 'done-card' });
    card.appendChild(WR.util.el('div', { class: 'done-emoji', text: '🎉' }));
    card.appendChild(WR.util.el('div', { class: 'done-title', text: '今天 ' + session.total + ' 题已经完成！' }));
    card.appendChild(WR.util.el('div', { class: 'done-sub', text: '你真棒！' }));
    card.appendChild(WR.util.el('div', { class: 'done-detail', text: (lib ? lib.name : '') + ' · 中译英 ' + session.c2e_count + ' · 英译中 ' + session.e2c_count }));
    card.appendChild(WR.util.el('div', { class: 'hint', text: '请把答题本交给老师批改吧～' }));
    wrap.appendChild(card);

    wrap.appendChild(WR.util.el('button', {
      class: 'btn btn-primary btn-big', text: '回首页',
      onclick: function () { WR.router.nav('#/child'); }
    }));

    /* 里程碑动画（每个只播一次） */
    if (pending.length) playMilestones(pending);
  })();

  async function playMilestones(list) {
    for (const m of list) {
      if (destroyFlag) return;
      await playOne(m);
      await WR.db.milestones.markShown(m.id);
    }
  }

  function playOne(m) {
    return new Promise(function (resolve) {
      const ov = WR.util.el('div', { class: 'milestone-overlay' });
      const box = WR.util.el('div', { class: 'milestone-box' });
      for (let i = 0; i < 18; i++) {
        const c = WR.util.el('span', { class: 'confetti c' + (i % 6), text: ['🎉', '⭐', '🎊', '✨', '🏅', '🌟'][i % 6] });
        c.style.left = (5 + Math.random() * 90) + '%';
        c.style.animationDelay = (Math.random() * 0.8) + 's';
        ov.appendChild(c);
      }
      box.appendChild(WR.util.el('div', { class: 'milestone-emoji', text: '🏆' }));
      box.appendChild(WR.util.el('div', { class: 'milestone-title', text: '里程碑达成！' }));
      box.appendChild(WR.util.el('div', { class: 'milestone-num', text: '已掌握 ' + m.mastered_count + ' 个单词' }));
      ov.appendChild(box);
      document.body.appendChild(ov);
      WR.tts.speak([
        { lang: 'zh', text: '恭喜达成里程碑！你已经掌握了 ' + m.mastered_count + ' 个单词！' }
      ]);
      setTimeout(function () { ov.remove(); resolve(); }, 4000);
    });
  }

  return { destroy: function () { destroyFlag = true; } };
};
