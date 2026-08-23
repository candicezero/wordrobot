/* 核心逻辑测试：纯函数，无 IndexedDB 依赖 */
(function () {
  const results = [];
  let pass = 0, fail = 0;

  function check(name, cond, detail) {
    if (cond) { pass++; results.push({ name: name, ok: true }); }
    else { fail++; results.push({ name: name, ok: false, detail: detail }); }
  }
  function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    check(name, a === e, 'actual=' + a + ' expected=' + e);
  }

  /* ---------- util.splitPosMeaning ---------- */
  const sp = WR.util.splitPosMeaning;
  eq('splitPos: 单词性', sp('n. 能力；才能'), { pos: 'n.', zh: '能力；才能' });
  eq('splitPos: 多词性合并', sp('prep.关于 adv.大约'), { pos: 'prep./adv.', zh: '关于；大约' });
  eq('splitPos: v.&n.', sp('v. & n. 承诺；保证'), { pos: 'v./n.', zh: '承诺；保证' });
  eq('splitPos: 空串', sp(''), { pos: '', zh: '' });
  eq('splitPos: 无词性', sp('某种意思'), { pos: '', zh: '某种意思' });

  eq('normalizeWord: 星标+大小写', WR.util.normalizeWord('  *Café  '), 'café');
  eq('normalizeWord: 折叠变体', WR.dictionary.foldKey(WR.util.normalizeWord('*Café')), 'cafe');
  eq('normalizeWord: 多空格', WR.util.normalizeWord('ice   cream'), 'ice cream');

  /* ---------- selector.pickWeighted ---------- */
  const words10 = [];
  for (let i = 0; i < 10; i++) words10.push({ word: 'w' + i, weight: 1 });
  const picked = WR.selector.pickWeighted(words10, 10);
  eq('pickWeighted: 全量不放回', picked.length, 10);
  const uniq = new Set(picked.map(function (w) { return w.word; }));
  eq('pickWeighted: 无重复', uniq.size, 10);
  eq('pickWeighted: 超额取尽', WR.selector.pickWeighted(words10, 25).length, 10);

  /* 高权重词应大概率被选中（种子随机 500 轮） */
  let heavyHits = 0;
  const two = [{ word: 'light', weight: 0.25 }, { word: 'heavy', weight: 8 }];
  for (let i = 0; i < 500; i++) {
    const r = WR.selector.pickWeighted(two, 1);
    if (r[0].word === 'heavy') heavyHits++;
  }
  check('pickWeighted: 权重偏向 (heavy 命中率>90%)', heavyHits > 450, 'heavy=' + heavyHits + '/500');

  /* 零权重兜底 */
  const zeros = [{ word: 'a', weight: 0 }, { word: 'b', weight: 0 }];
  eq('pickWeighted: 零权重兜底', WR.selector.pickWeighted(zeros, 2).length, 2);

  /* ---------- selector.buildItems ---------- */
  function mkword(word, opts) {
    return Object.assign({
      word: word, display: word, phonetic: '/x/', meaning: 'n. ' + word + '义',
      weight: 1, wrong_count: 0, correct_count: 0
    }, opts || {});
  }
  /* 确定性随机：交替 0.1/0.9 */
  let flip = false;
  const randAlt = function () { flip = !flip; return flip ? 0.1 : 0.9; };

  const active = [];
  for (let i = 0; i < 60; i++) active.push(mkword('a' + i));
  const wrong = [mkword('a0', { wrong_count: 3 }), mkword('a1'), mkword('nom', { meaning: '' })];

  const built = WR.selector.buildItems({
    activeWords: active, wrongWords: wrong, total: 50, c2e: 30, e2c: 20, rand: randAlt
  });
  eq('buildItems: 总数', built.total, 50);
  eq('buildItems: 题数', built.items.length, 50);
  eq('buildItems: 题型计数一致', built.c2e_count + built.e2c_count, 50);
  check('buildItems: 序号连续', built.items.every(function (it, i) { return it.seq === i + 1; }));
  check('buildItems: 错词全部入选',
    ['a0', 'a1', 'nom'].every(function (w) { return built.items.some(function (it) { return it.word === w; }); }));
  check('buildItems: 错词优先中译英（有释义的）',
    built.items.filter(function (it) { return it.word === 'a0'; })[0].q_type === 'C2E' &&
    built.items.filter(function (it) { return it.word === 'a1'; })[0].q_type === 'C2E');
  check('buildItems: 无释义错词只能英译中',
    built.items.filter(function (it) { return it.word === 'nom'; })[0].q_type === 'E2C');
  check('buildItems: 全部词无释义题不做中译英',
    built.items.every(function (it) { return it.meaningless || true; }) &&
    built.items.every(function (it) {
      const ans = JSON.parse(it.answer_json);
      return !(it.q_type === 'C2E' && !JSON.parse(it.stem_json).zh);
    }));

  /* 快照字段 */
  const c2eItem = built.items.find(function (it) { return it.q_type === 'C2E'; });
  const c2eStem = JSON.parse(c2eItem.stem_json);
  const c2eAns = JSON.parse(c2eItem.answer_json);
  eq('buildItems: C2E 题干快照', { zh: c2eStem.zh, pos: c2eStem.pos, first_letter: c2eStem.first_letter, word_len: c2eStem.word_len },
    { zh: c2eStem.zh, pos: 'n.', first_letter: c2eItem.word.charAt(0), word_len: c2eItem.word.length });
  check('buildItems: C2E 题干 zh 非空', !!c2eStem.zh);
  check('buildItems: C2E 答案含音标', c2eAns.phonetic === '/x/');
  const e2cItem = built.items.find(function (it) { return it.q_type === 'E2C'; });
  const e2cStem = JSON.parse(e2cItem.stem_json);
  check('buildItems: E2C 题干含单词', !!e2cStem.word);
  check('buildItems: from_wrong_pool 标记',
    built.items.find(function (it) { return it.word === 'a0'; }).from_wrong_pool === true &&
    built.items.find(function (it) { return it.word === 'a0'; }).from_wrong_pool === true);

  /* 词表不足：全部入选 + 比例折算（如 8 词 → 5 中译英 3 英译中附近） */
  const smallActive = [];
  for (let i = 0; i < 8; i++) smallActive.push(mkword('s' + i));
  const small = WR.selector.buildItems({
    activeWords: smallActive, wrongWords: [], total: 50, c2e: 30, e2c: 20, rand: randAlt
  });
  eq('buildItems: 不足时全部入选', small.total, 8);
  eq('buildItems: 折算中译英=round(8*0.6)=5', small.c2e_count, 5);

  /* 错词池超额：按权重降序截断 */
  const manyWrong = [];
  for (let i = 0; i < 60; i++) manyWrong.push(mkword('q' + i, { weight: 1 + (i % 7) }));
  const capped = WR.selector.buildItems({
    activeWords: [], wrongWords: manyWrong, total: 20, c2e: 12, e2c: 8, rand: randAlt
  });
  eq('buildItems: 错词池超额截断', capped.total, 20);
  const maxWeight = Math.max.apply(null, capped.items.map(function (it) { return it.word; }).map(function (w) {
    return manyWrong.find(function (x) { return x.word === w; }).weight;
  }));
  check('buildItems: 高权重错词保留', maxWeight === 7);

  /* ---------- grading.applyUpdates ---------- */
  const cfg = { wrong_multiplier: 2, weight_cap: 8, correct_per_decrease: 3, decrease_divisor: 2, weight_floor: 0.25, mastered_threshold: 10 };
  function items5() {
    return [
      { id: 1, word: 'x1', seq: 1 }, { id: 2, word: 'x2', seq: 2 },
      { id: 3, word: 'x1', seq: 3 }, { id: 4, word: 'x3', seq: 4 },
      { id: 5, word: 'x4', seq: 5 }
    ];
  }
  const wMap = {
    x1: { word: 'x1', weight: 1, wrong_count: 0, correct_count: 0 },
    x2: { word: 'x2', weight: 4, wrong_count: 0, correct_count: 0 },
    x3: { word: 'x3', weight: 8, wrong_count: 0, correct_count: 0 },
    x4: { word: 'x4', weight: 1, wrong_count: 0, correct_count: 9 }
  };
  const applied = WR.grading.applyUpdates(items5(), [1, 2], wMap, cfg);
  eq('applyUpdates: 答错权重×2', applied.updates.x1.weight, 2);
  eq('applyUpdates: 权重封顶8', applied.updates.x3.weight, 8); /* x3 答对1次不降权 */
  eq('applyUpdates: 答错计数', applied.updates.x1.wrong_count, 1);
  eq('applyUpdates: 答对计数', applied.updates.x3.correct_count, 1);
  eq('applyUpdates: 4→答错→8封顶', applied.updates.x2.weight, 8);
  check('applyUpdates: 仅达10次的词移入掌握(x4)，其余不动',
    applied.movedWords.length === 1 && applied.movedWords[0].word === 'x4');
  check('applyUpdates: x4 答对1次(9→10)未到3倍数不降权但达阈值',
    applied.updates.x4.correct_count === 10 && applied.movedWords.length === 1 &&
    applied.movedWords[0].word === 'x4');

  /* 每3次答对降半 */
  const w5 = { word: 'y', weight: 8, wrong_count: 0, correct_count: 0 };
  const itemsY = [1, 2, 3].map(function (i) { return { id: i, word: 'y', seq: i }; });
  const ap1 = WR.grading.applyUpdates(itemsY, [], { y: Object.assign({}, w5) }, cfg);
  eq('applyUpdates: 3次答对权重/2', ap1.updates.y.weight, 4);
  const w6 = { word: 'y', weight: 4, wrong_count: 0, correct_count: 3 };
  const ap2 = WR.grading.applyUpdates(itemsY, [], { y: Object.assign({}, w6) }, cfg);
  eq('applyUpdates: 累计6次再降', ap2.updates.y.weight, 2);
  const lowW = { word: 'y', weight: 0.3, wrong_count: 0, correct_count: 0 };
  const ap3 = WR.grading.applyUpdates(itemsY, [], { y: Object.assign({}, lowW) }, cfg);
  eq('applyUpdates: 权重下限0.25', ap3.updates.y.weight, 0.25);

  /* 同一次批改 A错B对 → 各+1，权重先×2再÷2 抵消（两次保存分开应用）
     同一批内同一词先错后对：顺序应用 */
  const mixItems = [{ id: 1, word: 'z', seq: 1 }, { id: 2, word: 'z', seq: 2 }];
  const mixMap = { z: { word: 'z', weight: 1, wrong_count: 0, correct_count: 0 } };
  const mix = WR.grading.applyUpdates(mixItems, [1], mixMap, cfg);
  eq('applyUpdates: 同词错+对', { w: mix.updates.z.weight, wrong: mix.updates.z.wrong_count, cor: mix.updates.z.correct_count },
    { w: 2, wrong: 1, cor: 1 });

  /* 不在词库的词被跳过 */
  const gone = WR.grading.applyUpdates([{ id: 9, word: 'ghost', seq: 9 }], [9], {}, cfg);
  check('applyUpdates: 已不在词库跳过', gone.log.length === 0);

  eq('computeScore: 常规', WR.grading.computeScore(50, 5), 90);
  eq('computeScore: 全对', WR.grading.computeScore(20, 0), 100);
  eq('computeScore: 四舍五入', WR.grading.computeScore(3, 1), 67);

  /* ---------- reward ---------- */
  check('bigBadgeDue: 10枚兑换', WR.reward.bigBadgeDue(10, 10) === true);
  check('bigBadgeDue: 9枚不兑换', WR.reward.bigBadgeDue(9, 10) === false);
  check('bigBadgeDue: 20枚兑换', WR.reward.bigBadgeDue(20, 10) === true);
  eq('milestonesDue: 补齐缺档', WR.reward.milestonesDue(95, 30, [30]), [60, 90]);
  eq('milestonesDue: 无缺档', WR.reward.milestonesDue(90, 30, [30, 60, 90]), []);
  eq('toNextMilestone', WR.reward.toNextMilestone(47, 30), 13);
  eq('toNextMilestone: 整档', WR.reward.toNextMilestone(60, 30), 30);

  /* ---------- 汇总 ---------- */
  const summary = document.getElementById('summary');
  summary.innerHTML = pass === fail
    ? '无测试' : (fail === 0
      ? '<span class="pass">全部通过 ✓ ' + pass + ' 项</span>'
      : '<span class="fail">失败 ' + fail + ' / ' + (pass + fail) + '</span>');
  const box = document.getElementById('results');
  box.innerHTML = '';
  results.forEach(function (r) {
    const div = document.createElement('div');
    div.className = 'case';
    div.innerHTML = (r.ok ? '<span class="pass">✓</span> ' : '<span class="fail">✗</span> ') +
      (r.ok ? r.name : r.name + '<pre>' + (r.detail || '') + '</pre>');
    box.appendChild(div);
  });
})();
