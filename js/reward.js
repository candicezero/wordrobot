/* 勋章 / 里程碑 规则（设计 §5.6），纯函数部分 */
WR.reward = (function () {
  /* 每累计 per 枚小勋章兑换 1 枚大勋章 */
  function bigBadgeDue(smallCount, per) {
    per = per || 10;
    return smallCount > 0 && per > 0 && smallCount % per === 0;
  }

  /* 已掌握词库每 +step 词触发一次；existingCounts 为已记录的 mastered_count 集合 */
  function milestonesDue(masteredCount, step, existingCounts) {
    step = step || 30;
    const existing = existingCounts || [];
    const due = [];
    for (let k = step; k <= masteredCount; k += step) {
      if (existing.indexOf(k) < 0) due.push(k);
    }
    return due;
  }

  /* 距下一个里程碑还差几个词 */
  function toNextMilestone(masteredCount, step) {
    step = step || 30;
    if (masteredCount < 0) masteredCount = 0;
    return step - (masteredCount % step);
  }

  return { bigBadgeDue: bigBadgeDue, milestonesDue: milestonesDue, toNextMilestone: toNextMilestone };
})();
