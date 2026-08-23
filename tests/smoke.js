/* 集成冒烟测试：IndexedDB 全流程（词库→录入→听写→批改→权重→勋章→掌握→备份恢复） */
document.title = 'SMOKE_SCRIPT_LOADED';
(function markStart() {
  const d = document.createElement('div');
  d.className = 'case'; d.id = 'script-marker';
  d.textContent = '脚本已加载，等待 IndexedDB…';
  document.getElementById('results').appendChild(d);
})();
(async function () {
  const results = [];
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; results.push({ name: name, ok: true, detail: '' }); }
    else { fail++; results.push({ name: name, ok: false, detail: detail || 'false' }); }
    renderNow();
  }
  function renderNow() {
    document.getElementById('summary').innerHTML = fail === 0
      ? '<span class="pass">全部通过 ✓ ' + pass + ' 项</span>'
      : '<span class="fail">失败 ' + fail + ' / ' + (pass + fail) + '</span>';
    const box = document.getElementById('results');
    box.innerHTML = '';
    results.forEach(function (r) {
      const div = document.createElement('div');
      div.className = 'case';
      div.innerHTML = (r.ok ? '<span class="pass">✓</span> ' : '<span class="fail">✗</span> ') + r.name +
        (r.detail ? '<pre>' + r.detail + '</pre>' : '');
      box.appendChild(div);
    });
  }
  try {
    await WR.db.open();
    await WR.db.wipeAll();
    await WR.dictionary.load('../assets/dictionary.json');

    /* 1. 词库 + 录入 + 词典回填 */
    const lib = await WR.db.libraries.create('冒烟词库');
    check('词库创建', !!lib.id && lib.name === '冒烟词库');
    const cfg = await WR.db.settings.merged();
    const report = await WR.db.words.addFromInput(lib.id,
      ['Ability', 'about', '*laboratory', 'Happy', 'nomatchword'], cfg);
    check('录入 5 词成功', report.added.length === 5, JSON.stringify(report));
    check('无重复跳过', report.skipped.length === 0);
    const words = await WR.db.words.listByLibrary(lib.id);
    check('词库 5 条', words.length === 5);
    const byName = {};
    words.forEach(function (w) { byName[w.word] = w; });
    check('词典回填 ability 音标', byName.ability.phonetic.indexOf('b') >= 0 || byName.ability.phonetic.length > 3,
      byName.ability.phonetic);
    check('词典回填 ability 词义', /能力/.test(byName.ability.meaning), byName.ability.meaning);
    check('大小写归一 Ability→ability', !!byName.ability);
    check('laboratory 缺释义（PDF 实测缺词）', !byName.laboratory.meaning && !byName.laboratory.phonetic,
      JSON.stringify(byName.laboratory));
    check('缺释义计入报告', report.missing.length === 2, JSON.stringify(report.missing));
    const dupReport = await WR.db.words.addFromInput(lib.id, ['ABOUT', 'newword'], cfg);
    check('重复词跳过（大小写不敏感）', dupReport.skipped.length === 1 && dupReport.added.length === 1);

    /* 2. 手动补录 laboratory */
    const lab = (await WR.db.words.listByLibrary(lib.id)).find(function (w) { return w.word === 'laboratory'; });
    lab.meaning = 'n. 实验室'; lab.phonetic = '/lə\'bɒrətri/'; lab.meaning_source = 'manual';
    await WR.db.words.update(lab);

    /* 3. 生成听写（全量 6 词 → 折算 c2e=4） */
    let active = await WR.db.words.listByLibrary(lib.id);
    let wrongPool = await WR.grading.wrongPoolForLibrary(lib.id);
    check('初始错词池为空', wrongPool.length === 0);
    const built = WR.selector.buildItems({
      activeWords: active, wrongWords: wrongPool,
      total: 50, c2e: 30, e2c: 20
    });
    check('不足全部入选（6词）', built.total === 6, 'total=' + built.total);
    check('折算 c2e=round(6*.6)=4', built.c2e_count === 4, 'c2e=' + built.c2e_count);
    check('nomatchword 只做英译中', built.items.filter(function (i) { return i.word === 'nomatchword'; })[0].q_type === 'E2C');
    const session = await WR.db.sessions.create(lib.id, built.items);
    const items = await WR.db.sessions.items(session.id);
    check('session 持久化', items.length === 6 && items[0].seq === 1);

    /* 4. 学生 A 批改：错 2 题 */
    const stuA = await WR.db.students.create('小明');
    const wrongIds = [items[0].id, items[3].id];
    const selCfg = { wrong_multiplier: 2, weight_cap: 8, correct_per_decrease: 3, decrease_divisor: 2, weight_floor: 0.25, mastered_threshold: 10 };
    const rewardCfg = { milestone_step: 3, big_badge_per: 10 };
    const g1 = await WR.grading.saveGrading({
      session: session, items: items, student: stuA,
      wrongItemIds: wrongIds, cfg: selCfg, rewardCfg: rewardCfg
    });
    check('得分 67', g1.score === 67, 'score=' + g1.score);
    check('小勋章 +1', (await WR.db.badges.countsByStudent(stuA.id)).small === 1);
    const w0 = (await WR.db.words.listByLibrary(lib.id)).find(function (w) { return w.word === items[0].word; });
    check('答错权重×2', w0.weight === 2 && w0.wrong_count === 1, JSON.stringify(w0));

    /* 5. 错词池（同一 session 内保存第二次批改前） */
    wrongPool = await WR.grading.wrongPoolForLibrary(lib.id);
    check('错词池 2 词（任一学生标错即入池）', wrongPool.length === 2,
      wrongPool.map(function (w) { return w.word; }).join(','));
    check('错词池来自最新任务', wrongPool.every(function (w) { return w.weight !== undefined; }));

    /* 6. 学生 B 批改：全对 → A 标错词的 wrong/correct 各自累计 */
    const stuB = await WR.db.students.create('小红');
    await WR.grading.saveGrading({
      session: session, items: items, student: stuB,
      wrongItemIds: [], cfg: selCfg, rewardCfg: rewardCfg
    });
    const w0b = (await WR.db.words.listByLibrary(lib.id)).find(function (w) { return w.word === items[0].word; });
    check('A错+B对 混合统计', w0b.wrong_count === 1 && w0b.correct_count === 1, JSON.stringify(w0b));

    /* 7. 修改批改（撤销重算）：A 改为只错 1 题 */
    await WR.grading.saveGrading({
      session: session, items: items, student: stuA,
      wrongItemIds: [items[0].id], cfg: selCfg, rewardCfg: rewardCfg
    });
    const w3 = (await WR.db.words.listByLibrary(lib.id)).find(function (w) { return w.word === items[3].word; });
    check('重批撤销：items[3] 计数回滚', w3.wrong_count === 0 && w3.correct_count === 1, JSON.stringify(w3));
    const gradA = await WR.db.gradings.get(session.id, stuA.id);
    check('重批更新同一条 grading', gradA.score === 83, 'score=' + gradA.score);
    check('重批不重复发勋章', (await WR.db.badges.countsByStudent(stuA.id)).small === 1);

    /* 8. 掌握流转：新词库单词，10 次全对批改 → 移入已掌握 + 里程碑(step=3) */
    const lib2 = await WR.db.libraries.create('掌握词库');
    await WR.db.words.addFromInput(lib2.id, ['ability'], cfg);
    const stuM = await WR.db.students.create('掌握者');
    for (let round = 0; round < 10; round++) {
      const still = await WR.db.words.listByLibrary(lib2.id);
      if (!still.length) break;
      const sess = await WR.db.sessions.create(lib2.id, WR.selector.buildItems({
        activeWords: still, wrongWords: [], total: 1, c2e: 1, e2c: 0
      }).items);
      await WR.grading.saveGrading({
        session: sess, items: await WR.db.sessions.items(sess.id), student: stuM,
        wrongItemIds: [], cfg: selCfg, rewardCfg: rewardCfg
      });
    }
    const mastered = await WR.db.mastered.listByLibrary(lib2.id);
    const masteredWords = mastered.map(function (m) { return m.word; });
    check('答对10次移入已掌握', masteredWords.indexOf('ability') >= 0, JSON.stringify(masteredWords));
    check('已掌握词不再出现在活跃词',
      !(await WR.db.words.listByLibrary(lib2.id)).find(function (w) { return w.word === 'ability'; }));

    /* 里程碑（step=3）：再补 2 个已掌握词凑 3，下一次批改触发 */
    await WR.db.words.addFromInput(lib2.id, ['about', 'happy'], cfg);
    const extra = await WR.db.words.listByLibrary(lib2.id);
    for (const w of extra) {
      await WR.db.mastered.addFromWordRow(w);
      await WR.db.words.remove(w.id);
    }
    await WR.db.words.addFromInput(lib2.id, ['zoo'], cfg);
    const sess2 = await WR.db.sessions.create(lib2.id, WR.selector.buildItems({
      activeWords: await WR.db.words.listByLibrary(lib2.id), wrongWords: [], total: 1, c2e: 1, e2c: 0
    }).items);
    await WR.grading.saveGrading({
      session: sess2, items: await WR.db.sessions.items(sess2.id), student: stuM,
      wrongItemIds: [], cfg: selCfg, rewardCfg: rewardCfg
    });
    const milestones = await WR.db.milestones.listByLibrary(lib2.id);
    check('里程碑按步长触发', milestones.length === 1 && milestones[0].mastered_count === 3,
      JSON.stringify(milestones.map(function (m) { return m.mastered_count; })));
    const pending = await WR.db.milestones.pendingAll();
    check('里程碑待播放', pending.length === 1);
    await WR.db.milestones.markShown(pending[0].id);
    check('播放后不再待播', (await WR.db.milestones.pendingAll()).length === 0);

    /* 掌握词移回 */
    const m0 = mastered[0];
    await WR.db.mastered.moveBack(m0);
    check('掌握词移回活跃', !!(await WR.db.words.getByWord(lib2.id, m0.word)));

    /* 10. 导出 / 恢复 往返 */
    const payload = await WR.db.exportAll();
    const counts = {};
    for (const k in payload.data) counts[k] = payload.data[k].length;
    check('导出包含各表数据', counts.words >= 2 && counts.mastered_words >= 1 && counts.gradings >= 4 && counts.libraries === 2,
      JSON.stringify(counts));
    await WR.db.wipeAll();
    check('清空后为空', (await WR.db.words.listByLibrary(lib.id)).length === 0);
    await WR.db.replaceAll(payload);
    const libWordsInPayload = payload.data.words.filter(function (w) { return w.library_id === lib.id; });
    const restored = await WR.db.words.listByLibrary(lib.id);
    check('恢复后词数一致', restored.length === libWordsInPayload.length,
      restored.length + '/' + libWordsInPayload.length);
    const restoredLibs = await WR.db.libraries.list();
    check('恢复后词库在', restoredLibs.length === 2 && restoredLibs.some(function (l) { return l.name === '冒烟词库'; }));

    renderNow();
  } catch (e) {
    fail++;
    results.push({ name: '异常中断', ok: false, detail: (e && e.stack) || String(e) });
    renderNow();
  }
})();
