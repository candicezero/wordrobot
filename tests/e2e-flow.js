(async () => {
  const out = { steps: [] };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  window.onerror = m => { out.onerror = String(m); };
  try {
    await wait(600);
    await WR.db.students.create('E2E学生');
    location.hash = '#/teacher/libraries'; await wait(500);
    document.querySelector('.card input.input').value = 'E2E词库';
    $$('.btn').find(b => b.textContent === '新建词库').click(); await wait(700);
    out.url1 = location.hash;
    const ta = $('textarea');
    if (!ta) throw new Error('textarea not found, hash=' + location.hash);
    ta.value = 'ability, about, *laboratory, happy, harm, ice cream, jam';
    $$('.btn').find(b => b.textContent.includes('保存并查词典')).click(); await wait(900);
    out.wordRows = $$('.word-row').length;
    out.missingTag = !!$('.tag-warn');
    const okBtn = $$('.modal .btn').find(b => b.textContent === '稍后');
    if (okBtn) okBtn.click();
    await wait(300);
    location.hash = '#/child'; await wait(800);
    out.childTitle = $('.card-title.small') ? $('.card-title.small').textContent : null;
    out.startBtn = !!$('.btn-start');
    $('.btn-start').click(); await wait(2500);
    out.dictHash = location.hash;
    out.startOverlay = !!$('.start-overlay');
    $('.start-overlay .btn-start').click(); await wait(1200);
    out.question = !!$('.question-card');
    out.progress = $('.dict-count') ? $('.dict-count').textContent : null;
    const nextBtn = () => $$('.dict-btns .btn').find(b => b.textContent.includes('下一题'));
    nextBtn().click(); await wait(4500);
    out.progress2 = $('.dict-count') ? $('.dict-count').textContent : null;
    location.hash = '#/teacher/sessions'; await wait(800);
    out.sessionRows = $$('.session-row').length;
    $$('.session-row .btn').find(b => b.textContent === '批改').click(); await wait(900);
    out.gradeRows = $$('.grade-row').length;
    out.chips = $$('.chip').length;
    $('.grade-check').click(); await wait(700);
    out.wrongCount = $('#wrong-count') ? $('#wrong-count').textContent : null;
    $$('.btn').find(b => b.textContent === '批改完成').click(); await wait(1500);
    out.backupModal = !!$('.modal-title');
    const know = $$('.modal .btn').find(b => b.textContent === '知道了');
    if (know) know.click();
    await wait(500);
    out.scoreChip = ($$('.chip').find(c => c.textContent.indexOf('分') >= 0) || {}).textContent;
  } catch (e) {
    out.ERROR = (e && e.stack) || String(e);
  }
  return JSON.stringify(out);
})()
