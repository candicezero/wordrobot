/* 首页：教师模式 / 孩子模式 两个入口 */
WR.views = WR.views || {};

WR.views.home = function (app) {
  WR.ui.zone('home');
  WR.ui.header({});

  const wrap = WR.util.el('div', { class: 'home-wrap' });
  wrap.appendChild(WR.util.el('div', { class: 'home-logo', text: '🤖' }));
  wrap.appendChild(WR.util.el('h1', { class: 'home-title', text: '听写机器人' }));
  wrap.appendChild(WR.util.el('p', { class: 'home-sub', text: '和机器人一起做单词听写吧！' }));

  const teacherBtn = WR.util.el('button', {
    class: 'home-card teacher-card',
    onclick: function () { WR.router.nav('#/teacher/libraries'); }
  }, [WR.util.el('div', { class: 'home-card-icon', text: '📚' }),
      WR.util.el('div', { class: 'home-card-text' }, [
        WR.util.el('div', { class: 'home-card-title', text: '教师模式' }),
        WR.util.el('div', { class: 'home-card-desc', text: '词库 · 批改 · 备份' })
      ])]);
  wrap.appendChild(teacherBtn);

  const childBtn = WR.util.el('button', {
    class: 'home-card child-card',
    onclick: function () { WR.router.nav('#/child'); }
  }, [WR.util.el('div', { class: 'home-card-icon', text: '🎧' }),
      WR.util.el('div', { class: 'home-card-text' }, [
        WR.util.el('div', { class: 'home-card-title', text: '开始听写' }),
        WR.util.el('div', { class: 'home-card-desc', text: '准备好了吗？' })
      ])]);
  wrap.appendChild(childBtn);

  const links = WR.util.el('div', { class: 'home-links' });
  const gradeLink = WR.util.el('a', {
    class: 'home-link', text: '听写批改', href: '#/teacher/sessions',
    onclick: function (e) { e.preventDefault(); WR.router.nav('#/teacher/sessions'); }
  });
  links.appendChild(gradeLink);
  links.appendChild(WR.util.el('a', {
    class: 'home-link', text: '学生与勋章', href: '#/teacher/students',
    onclick: function (e) { e.preventDefault(); WR.router.nav('#/teacher/students'); }
  }));
  links.appendChild(WR.util.el('a', {
    class: 'home-link', text: '设置', href: '#/teacher/settings',
    onclick: function (e) { e.preventDefault(); WR.router.nav('#/teacher/settings'); }
  }));
  wrap.appendChild(links);

  app.appendChild(wrap);

  /* 教师入口角标：备份积压条数 */
  WR.db.queue.pendingList().then(function (pending) {
    if (pending.length) {
      const badge = WR.util.el('span', { class: 'home-badge', text: String(pending.length) });
      teacherBtn.appendChild(badge);
    }
  });

  /* 批改入口角标：还没有任何批改记录的听写任务数 */
  (async function () {
    const sessions = await WR.db.sessions.listDesc();
    let ungraded = 0;
    for (const se of sessions) {
      const grads = await WR.db.gradings.bySession(se.id);
      if (!grads.length) ungraded++;
    }
    if (ungraded) {
      gradeLink.appendChild(WR.util.el('span', { class: 'home-badge', text: String(ungraded) }));
    }
  })();
};
