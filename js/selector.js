/* 听写词表生成（设计 §3）：错词池优先 + 权重不放回抽样 + 题型分配 + 快照 */
WR.selector = (function () {
  const U = () => WR.util;

  /* 权重加权不放回抽样 n 个 */
  function pickWeighted(candidates, n, rand) {
    rand = rand || Math.random;
    const pool = candidates.slice();
    const out = [];
    while (pool.length && out.length < n) {
      const total = pool.reduce(function (s, w) { return s + Math.max(Number(w.weight) || 0, 0); }, 0);
      let idx;
      if (total <= 0) {
        idx = Math.floor(rand() * pool.length);
      } else {
        let r = rand() * total;
        idx = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
          r -= Math.max(Number(pool[i].weight) || 0, 0);
          if (r <= 0) { idx = i; break; }
        }
      }
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  function makeItem(entry, qType) {
    const w = entry.row;
    const display = w.display || w.word;
    const sp = U().splitPosMeaning(w.meaning);
    if (qType === 'C2E') {
      return {
        seq: 0, word: w.word, q_type: 'C2E', from_wrong_pool: !!entry.wrong,
        stem_json: JSON.stringify({
          type: 'C2E', zh: sp.zh, pos: sp.pos,
          first_letter: display.charAt(0).toLowerCase(), word_len: display.length
        }),
        answer_json: JSON.stringify({
          type: 'C2E', word: display, phonetic: w.phonetic || '', meaning: w.meaning || ''
        })
      };
    }
    return {
      seq: 0, word: w.word, q_type: 'E2C', from_wrong_pool: !!entry.wrong,
      stem_json: JSON.stringify({ type: 'E2C', word: display, pos: sp.pos }),
      answer_json: JSON.stringify({ type: 'E2C', word: display, meaning: w.meaning || '' })
    };
  }

  /* activeWords: 词库全部活跃词；wrongWords: 上次批改答错且仍在词库的词行
     total/c2e/e2c: 配置目标；词不足时全部入选并按 c2e:e2c 比例折算（设计 §3.3） */
  function buildItems(opts) {
    const activeWords = opts.activeWords, wrongWords = opts.wrongWords || [];
    const total = opts.total, c2e = opts.c2e, e2c = opts.e2c;
    const rand = opts.rand || Math.random;
    const hasMeaning = function (w) { return !!(w.meaning && String(w.meaning).trim()); };

    let pool = wrongWords.slice();
    if (pool.length > total) {
      pool.sort(function (a, b) {
        return (Number(b.weight) || 0) - (Number(a.weight) || 0) ||
          (b.wrong_count || 0) - (a.wrong_count || 0);
      });
      pool = pool.slice(0, total);
    }
    const chosen = {};
    pool.forEach(function (w) { chosen[w.word] = true; });
    const need = Math.max(total - pool.length, 0);
    const candidates = activeWords.filter(function (w) { return !chosen[w.word]; });
    const randoms = pickWeighted(candidates, need, rand);

    const entries = pool.map(function (w) { return { row: w, wrong: true }; })
      .concat(randoms.map(function (w) { return { row: w, wrong: false }; }));
    const N = entries.length;

    /* 词表不足时按 c2e:e2c 比例折算 */
    let c2eSlots = N > 0 ? Math.round(N * c2e / (c2e + e2c)) : 0;
    let e2cSlots = N - c2eSlots;

    const c2eItems = [], e2cItems = [], dropped = [];

    /* 分配次序：受约束的先占位——
       1) 无释义的错词与随机词（只能英译中）→ 2) 有释义错词优先中译英（重练拼写）→
       3) 有释义随机词随机题型补足。词表不足时保证全部入选（§3.3）。 */
    const wrongNoMeaning = entries.filter(function (x) { return x.wrong && !hasMeaning(x.row); });
    const wrongWithMeaning = entries.filter(function (x) { return x.wrong && hasMeaning(x.row); });
    const restNoMeaning = entries.filter(function (x) { return !x.wrong && !hasMeaning(x.row); });
    const restWithMeaning = U().shuffle(entries.filter(function (x) { return !x.wrong && hasMeaning(x.row); }), rand);

    wrongNoMeaning.forEach(function (x) {
      if (e2cSlots > 0) { e2cItems.push(x); e2cSlots--; } else dropped.push(x);
    });
    restNoMeaning.forEach(function (x) {
      if (e2cSlots > 0) { e2cItems.push(x); e2cSlots--; } else dropped.push(x);
    });
    wrongWithMeaning.forEach(function (x) {
      if (c2eSlots > 0) { c2eItems.push(x); c2eSlots--; }
      else if (e2cSlots > 0) { e2cItems.push(x); e2cSlots--; }
      else dropped.push(x);
    });

    restWithMeaning.forEach(function (x) {
      if (c2eSlots > 0 && (e2cSlots === 0 || rand() < 0.5)) { c2eItems.push(x); c2eSlots--; }
      else if (e2cSlots > 0) { e2cItems.push(x); e2cSlots--; }
      else if (c2eSlots > 0) { c2eItems.push(x); c2eSlots--; }
      else dropped.push(x);
    });

    const items = c2eItems.map(function (x) { return makeItem(x, 'C2E'); })
      .concat(e2cItems.map(function (x) { return makeItem(x, 'E2C'); }));
    const shuffled = U().shuffle(items, rand);
    shuffled.forEach(function (it, i) { it.seq = i + 1; });
    return {
      items: shuffled,
      c2e_count: c2eItems.length,
      e2c_count: e2cItems.length,
      dropped: dropped.length,
      total: shuffled.length
    };
  }

  return { pickWeighted: pickWeighted, buildItems: buildItems };
})();
