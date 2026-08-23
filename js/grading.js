/* 批改保存：权重更新（§3.1）、错词池、快照原则、可撤销重批 */
WR.grading = (function () {
  function computeScore(total, wrongCount) {
    if (!total) return 0;
    return Math.round((total - wrongCount) / total * 100);
  }

  /* 纯函数：把一次批改的 对/错 应用到词行，返回更新与回滚日志。
     items: session_items；wrongItemIds: 勾错的 item id 数组；wordsByWord: Map(word→words 行) */
  function applyUpdates(items, wrongItemIds, wordsByWord, cfg) {
    const wrongSet = {};
    (wrongItemIds || []).forEach(function (id) { wrongSet[id] = true; });
    const updates = {};          // word → 新行
    const log = [];              // 回滚日志
    const movedWords = [];       // 达到掌握门槛的词（快照行）
    const movedSet = {};

    items.forEach(function (it) {
      let row = updates[it.word];
      if (!row) {
        const orig = wordsByWord[it.word];
        if (!orig) return; // 词已不在活跃词库（提前掌握/删除），跳过
        row = Object.assign({}, orig);
        updates[it.word] = row;
        log.push({ word: it.word, wrong_before: orig.wrong_count, correct_before: orig.correct_count, weight_before: orig.weight });
      }
      if (wrongSet[it.id]) {
        row.wrong_count = (row.wrong_count || 0) + 1;
        row.weight = Math.min(Number(row.weight) * cfg.wrong_multiplier, cfg.weight_cap);
      } else {
        row.correct_count = (row.correct_count || 0) + 1;
        if (row.correct_count % cfg.correct_per_decrease === 0) {
          row.weight = Math.max(Number(row.weight) / cfg.decrease_divisor, cfg.weight_floor);
        }
      }
      if (row.correct_count >= cfg.mastered_threshold && !movedSet[it.word]) {
        movedSet[it.word] = true;
        movedWords.push({ word: it.word, row: Object.assign({}, row) });
      }
    });
    return { updates: updates, log: log, movedWords: movedWords };
  }

  /* 回滚一次已保存批改的影响（词行计数/权重/掌握移动/勋章/里程碑） */
  async function revertApplied(libraryId, applied) {
    if (!applied) return;
    const activeRows = await WR.db.words.listByLibrary(libraryId);
    const byWord = {};
    activeRows.forEach(function (w) { byWord[w.word] = w; });
    const movedMap = {};
    (applied.movedWords || []).forEach(function (m) { movedMap[m.word] = m; });

    for (const m of applied.movedWords || []) {
      const masteredRow = await WR.db.mastered.getByWord(libraryId, m.word);
      if (masteredRow) await WR.db.mastered.remove(masteredRow.id);
      const restored = Object.assign({}, m.row);
      delete restored.mastered_at;
      restored.id = byWord[m.word] ? byWord[m.word].id : undefined;
      if (restored.id) await WR.db.words.update(restored);
    }
    for (const l of applied.log || []) {
      if (movedMap[l.word]) continue; // 已由 movedWords 恢复
      const row = byWord[l.word];
      if (!row) continue;
      row.wrong_count = l.wrong_before;
      row.correct_count = l.correct_before;
      row.weight = l.weight_before;
      await WR.db.words.update(row);
    }
    for (const bid of applied.badges_created || []) await WR.db.badges.remove(bid);
    for (const mid of applied.milestones_created || []) await WR.db.milestones.remove(mid);
  }

  /* 保存批改（同一学生重复保存 = 先回滚再重算）。
     返回 {grading, score, wrongWords, badges, milestones} */
  async function saveGrading(opts) {
    const session = opts.session, items = opts.items, student = opts.student;
    const wrongItemIds = opts.wrongItemIds || [];
    const cfg = opts.cfg;             // merged selection 配置
    const rewardCfg = opts.rewardCfg; // merged reward 配置
    const db = WR.db;
    const now = WR.util.nowIso();

    const prev = await db.gradings.get(session.id, student.id);
    if (prev) {
      let applied = null;
      try { applied = JSON.parse(prev.applied_json || '{}'); } catch (e) { applied = null; }
      await revertApplied(session.library_id, applied);
    }

    const activeRows = await db.words.listByLibrary(session.library_id);
    const wordsByWord = {};
    activeRows.forEach(function (w) { wordsByWord[w.word] = w; });
    const result = applyUpdates(items, wrongItemIds, wordsByWord, cfg);

    const movedMap = {};
    result.movedWords.forEach(function (m) { movedMap[m.word] = true; });
    for (const word in result.updates) {
      const row = result.updates[word];
      if (movedMap[word]) {
        if (row.id) await db.words.remove(row.id);
        await db.mastered.addFromWordRow(row);
      } else {
        await db.words.update(row);
      }
    }

    const score = computeScore(items.length, wrongItemIds.length);
    const grading = {
      session_id: session.id, student_id: student.id,
      wrong_item_ids: JSON.stringify(wrongItemIds),
      score: score, created_at: prev ? prev.created_at : now,
      applied_json: JSON.stringify({
        log: result.log,
        movedWords: result.movedWords,
        badges_created: [], milestones_created: []
      })
    };
    if (prev) grading.id = prev.id;
    grading.id = await db.gradings.save(grading);

    /* 小勋章 + 大勋章兑换 */
    const badgesCreated = [];
    const smallBadge = await db.badges.add(student.id, grading.id, 'small');
    badgesCreated.push(smallBadge.id);
    const counts = await db.badges.countsByStudent(student.id);
    if (WR.reward.bigBadgeDue(counts.small, rewardCfg.big_badge_per)) {
      const big = await db.badges.add(student.id, grading.id, 'big');
      badgesCreated.push(big.id);
    }

    /* 里程碑（按词库独立统计） */
    const milestonesCreated = [];
    const masteredCount = await db.mastered.countByLibrary(session.library_id);
    const existing = (await db.milestones.listByLibrary(session.library_id))
      .map(function (m) { return m.mastered_count; });
    const due = WR.reward.milestonesDue(masteredCount, rewardCfg.milestone_step, existing);
    for (const k of due) {
      const ev = await db.milestones.add(session.library_id, k);
      milestonesCreated.push(ev.id);
    }

    /* 更新回滚日志中的勋章/里程碑 id */
    const applied = JSON.parse(grading.applied_json);
    applied.badges_created = badgesCreated;
    applied.milestones_created = milestonesCreated;
    grading.applied_json = JSON.stringify(applied);
    await db.gradings.save(grading);

    await db.drafts.put(session.id, student.id, wrongItemIds);

    const wrongItems = items.filter(function (it) { return wrongItemIds.indexOf(it.id) >= 0; });
    return {
      grading: grading, score: score,
      wrongItems: wrongItems,
      bigBadgeEarned: badgesCreated.length > 1,
      milestones: due, updated: !!prev
    };
  }

  /* 错词池：该词库最近一次听写任务中，任一学生标错的词（跨学生合并去重，仍活跃的） */
  async function wrongPoolForLibrary(libraryId) {
    const db = WR.db;
    const latest = await db.sessions.latestForLibrary(libraryId);
    if (!latest) return [];
    const grads = await db.gradings.bySession(latest.id);
    if (!grads.length) return [];
    const items = await db.sessions.items(latest.id);
    const byId = {};
    items.forEach(function (it) { byId[it.id] = it; });
    const wrongSet = {};
    grads.forEach(function (g) {
      let ids = [];
      try { ids = JSON.parse(g.wrong_item_ids || '[]'); } catch (e) { ids = []; }
      ids.forEach(function (id) { const it = byId[id]; if (it) wrongSet[it.word] = true; });
    });
    const active = await db.words.listByLibrary(libraryId);
    return active.filter(function (w) { return wrongSet[w.word]; });
  }

  return {
    computeScore: computeScore, applyUpdates: applyUpdates,
    saveGrading: saveGrading, revertApplied: revertApplied,
    wrongPoolForLibrary: wrongPoolForLibrary
  };
})();
