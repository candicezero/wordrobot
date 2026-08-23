/* 教师模式 · 学生管理 / 勋章统计 */
WR.views = WR.views || {};

WR.views.students = function (app) {
  WR.ui.zone('teacher');
  WR.ui.header({ title: '学生与勋章', back: '#/home' });

  const wrap = WR.util.el('div', { class: 'page' });
  app.appendChild(wrap);

  const addCard = WR.util.el('div', { class: 'card row' });
  const nameInput = WR.util.el('input', { class: 'input', type: 'text', placeholder: '学生姓名' });
  addCard.appendChild(nameInput);
  addCard.appendChild(WR.util.el('button', {
    class: 'btn btn-primary', text: '添加',
    onclick: async function () {
      if (!nameInput.value.trim()) { WR.util.toast('请输入姓名'); return; }
      await WR.db.students.create(nameInput.value);
      nameInput.value = '';
      render();
    }
  }));
  wrap.appendChild(addCard);

  const listCard = WR.util.el('div', { class: 'card' });
  wrap.appendChild(listCard);

  async function render() {
    const students = await WR.db.students.list();
    listCard.innerHTML = '';
    if (!students.length) {
      listCard.appendChild(WR.ui.empty('还没有学生。批改时也可快速新建。'));
      return;
    }
    for (const s of students) {
      const counts = await WR.db.badges.countsByStudent(s.id);
      const row = WR.util.el('div', { class: 'word-row' });
      row.appendChild(WR.util.el('div', { class: 'word-main' }, [
        WR.util.el('div', { class: 'word-title' }, [
          WR.util.el('span', { class: 'word-text', text: s.name })
        ]),
        WR.util.el('div', { class: 'word-sub badge-line' }, [
          WR.util.el('span', { class: 'badge-pill', text: '⭐ 小勋章 ' + counts.small }),
          WR.util.el('span', { class: 'badge-pill big', text: '🏆 大勋章 ' + counts.big })
        ])
      ]));
      const ops = WR.util.el('div', { class: 'word-ops' });
      ops.appendChild(WR.util.el('button', {
        class: 'btn btn-small', text: '改名',
        onclick: async function () {
          const name = window.prompt('新姓名', s.name);
          if (name === null || !name.trim()) return;
          await WR.db.students.rename(s.id, name);
          render();
        }
      }));
      ops.appendChild(WR.util.el('button', {
        class: 'btn btn-small btn-danger-ghost', text: '删除',
        onclick: async function () {
          if (!await WR.util.confirmAsync('删除学生「' + s.name + '」及其勋章记录？')) return;
          await WR.db.students.remove(s.id);
          render();
        }
      }));
      row.appendChild(ops);
      listCard.appendChild(row);
    }
  }

  render();
};
