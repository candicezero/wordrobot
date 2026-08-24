/* 教师模式 · 词库管理：列表/新建 + 词库详情（追加/TXT导入/词典回填/缺释义补录/已掌握） */
WR.views = WR.views || {};

WR.views.libraries = function (app) {
  WR.ui.zone('teacher');
  WR.ui.header({
    title: '词库管理', back: '#/home',
    actions: [{ text: '批改', onclick: function () { WR.router.nav('#/teacher/sessions'); } }]
  });

  const wrap = WR.util.el('div', { class: 'page' });

  const newBox = WR.util.el('div', { class: 'card row' });
  const nameInput = WR.util.el('input', {
    class: 'input', type: 'text', placeholder: '新词库名称，如：七年级上册'
  });
  newBox.appendChild(nameInput);
  newBox.appendChild(WR.util.el('button', {
    class: 'btn btn-primary', text: '新建词库',
    onclick: async function () {
      const name = nameInput.value.trim();
      if (!name) { WR.util.toast('请输入词库名称'); return; }
      const row = await WR.db.libraries.create(name);
      WR.router.nav('#/teacher/library/' + row.id);
    }
  }));
  wrap.appendChild(newBox);

  const listBox = WR.util.el('div', { class: 'card' });
  listBox.appendChild(WR.ui.spinner());
  wrap.appendChild(listBox);
  app.appendChild(wrap);

  (async function () {
    const libs = await WR.db.libraries.list();
    listBox.innerHTML = '';
    if (!libs.length) {
      listBox.appendChild(WR.ui.empty('还没有词库，先新建一个吧'));
      return;
    }
    for (const lib of libs) {
      const words = await WR.db.words.listByLibrary(lib.id);
      const mastered = await WR.db.mastered.listByLibrary(lib.id);
      const missing = words.filter(function (w) { return !w.meaning; }).length;
      const row = WR.util.el('button', {
        class: 'list-item',
        onclick: function () { WR.router.nav('#/teacher/library/' + lib.id); }
      });
      row.appendChild(WR.util.el('div', { class: 'list-item-main' }, [
        WR.util.el('div', { class: 'list-item-title', text: lib.name }),
        WR.util.el('div', { class: 'list-item-sub', text: '活跃 ' + words.length + ' · 已掌握 ' + mastered.length + (missing ? ' · 缺释义 ' + missing : '') })
      ]));
      row.appendChild(WR.util.el('div', { class: 'chevron', text: '›' }));
      listBox.appendChild(row);
    }
  })();
};

WR.views.libraryDetail = function (app, params) {
  WR.ui.zone('teacher');
  const libId = Number(params.id);
  let filter = 'active';   // active | mastered | missing
  let showLimit = 100;
  let destroyFlag = false;

  const wrap = WR.util.el('div', { class: 'page' });
  app.appendChild(wrap);

  async function render() {
    if (destroyFlag) return;
    const lib = await WR.db.libraries.get(libId);
    if (!lib) { WR.util.toast('词库不存在'); WR.router.nav('#/teacher/libraries'); return; }
    const words = (await WR.db.words.listByLibrary(libId))
      .sort(function (a, b) { return (a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id; });
    const mastered = (await WR.db.mastered.listByLibrary(libId))
      .sort(function (a, b) { return (b.mastered_at || '').localeCompare(a.mastered_at || ''); });

    WR.ui.header({
      title: lib.name,
      back: '#/teacher/libraries',
      actions: [
        { text: '改名', onclick: renameLib },
        { text: '删除', class: 'danger-link', onclick: deleteLib }
      ]
    });

    wrap.innerHTML = '';

    /* 概览 */
    const missingCount = words.filter(function (w) { return !w.meaning; }).length;
    wrap.appendChild(WR.util.el('div', { class: 'stats-row' }, [
      statChip('活跃 ' + words.length, filter === 'active', function () { switchFilter('active'); }),
      statChip('已掌握 ' + mastered.length, filter === 'mastered', function () { switchFilter('mastered'); }),
      statChip('缺释义 ' + missingCount, filter === 'missing', missingCount ? 'warn' : '', function () { switchFilter('missing'); })
    ]));

    /* 录入区 */
    const addCard = WR.util.el('div', { class: 'card' });
    addCard.appendChild(WR.util.el('div', { class: 'card-title', text: '添加单词（只输英文，支持逗号、空格、换行分隔）' }));
    const ta = WR.util.el('textarea', {
      class: 'input textarea', rows: 3,
      placeholder: '例如：\nability, about\n*café'
    });
    addCard.appendChild(ta);
    const btnRow = WR.util.el('div', { class: 'row' });

    const importInput = WR.util.el('input', { type: 'file', accept: '.txt,text/plain', class: 'hidden-file' });
    importInput.addEventListener('change', async function () {
      const f = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!f) return;
      try {
        const text = await f.text();
        const lines = text.split(/\r?\n/).map(function (l) { return l.trim(); })
          .filter(function (l) { return l && !/^[\s*\-—·、,，]+$/.test(l); });
        await doAdd(lines, 'TXT 导入');
      } catch (e) {
        WR.util.toast('导入失败：' + (e.message || e));
      }
    });
    document.body.appendChild(importInput);
    if (destroyFlag === false && !wrap._fileInput) {
      wrap._fileInput = importInput;
    }

    btnRow.appendChild(WR.util.el('button', {
      class: 'btn btn-primary', text: '保存并查词典',
      onclick: function () {
        const parts = ta.value.split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        doAdd(parts, '添加');
      }
    }));
    btnRow.appendChild(WR.util.el('button', {
      class: 'btn btn-secondary', text: '导入 TXT',
      onclick: function () { importInput.click(); }
    }));
    addCard.appendChild(btnRow);
    wrap.appendChild(addCard);

    /* 词条列表 */
    let listWords;
    if (filter === 'mastered') listWords = [];
    else if (filter === 'missing') listWords = words.filter(function (w) { return !w.meaning; });
    else listWords = words;

    const listCard = WR.util.el('div', { class: 'card' });
    listCard.appendChild(WR.util.el('div', { class: 'card-title', text: filter === 'mastered' ? '已掌握词库' : (filter === 'missing' ? '缺释义（点“补”录入中文与音标）' : '词条') }));
    if (filter !== 'mastered') {
      if (!listWords.length) {
        listCard.appendChild(WR.ui.empty(filter === 'missing' ? '没有缺释义的词 🎉' : '还没有单词，先在上方添加'));
      }
      listWords.slice(0, showLimit).forEach(function (w) { listCard.appendChild(wordRow(w)); });
      if (listWords.length > showLimit) {
        const more = WR.util.el('button', {
          class: 'btn btn-ghost wide', text: '显示更多（' + (listWords.length - showLimit) + '）',
          onclick: function () { showLimit += 200; render(); }
        });
        listCard.appendChild(more);
      }
    } else {
      if (!mastered.length) listCard.appendChild(WR.ui.empty('还没有已掌握的单词'));
      mastered.slice(0, showLimit).forEach(function (m) { listCard.appendChild(masteredRow(m)); });
      if (mastered.length > showLimit) {
        listCard.appendChild(WR.util.el('button', {
          class: 'btn btn-ghost wide', text: '显示更多（' + (mastered.length - showLimit) + '）',
          onclick: function () { showLimit += 200; render(); }
        }));
      }
    }
    wrap.appendChild(listCard);
  }

  function statChip(text, active, extraClass, onclick) {
    return WR.util.el('button', {
      class: 'stat-chip' + (active ? ' active' : '') + (extraClass ? ' ' + extraClass : ''),
      onclick: onclick
    }, text);
  }

  function switchFilter(f) {
    filter = f;
    showLimit = 100;
    render();
  }

  async function doAdd(parts, label) {
    if (!parts.length) { WR.util.toast('没有可添加的单词'); return; }
    const cfg = await WR.db.settings.merged();
    const report = await WR.db.words.addFromInput(libId, parts, cfg);
    let msg = label + '：成功 ' + report.added.length + '，重复跳过 ' + report.skipped.length;
    if (report.missing.length) msg += '，缺释义 ' + report.missing.length;
    WR.util.toast(msg, 3200);
    if (report.missing.length && report.missing.length <= 30) {
      setTimeout(function () {
        WR.ui.modal({
          title: '以下单词词典未收录，请手动补录',
          body: WR.util.el('div', {}, [
            WR.util.el('div', { class: 'missing-list', text: report.missing.join('、') }),
            WR.util.el('p', { class: 'hint', text: '可在下方列表的“缺释义”筛选中集中补录。' })
          ]),
          actions: [
            { text: '去补录', class: 'btn-primary', onclick: function (close) { close(); switchFilter('missing'); } },
            { text: '稍后', class: 'btn-secondary' }
          ]
        });
      }, 300);
    }
    render();
  }

  function wordRow(w) {
    const sp = WR.util.splitPosMeaning(w.meaning);
    const row = WR.util.el('div', { class: 'word-row' + (w.meaning ? '' : ' missing') });
    const main = WR.util.el('div', { class: 'word-main' });
    const titleLine = WR.util.el('div', { class: 'word-title' });
    titleLine.appendChild(WR.util.el('span', { class: 'word-text', text: w.display || w.word }));
    if (w.starred) titleLine.appendChild(WR.util.el('span', { class: 'tag tag-star', title: '重点词', text: '★' }));
    if (!w.meaning) titleLine.appendChild(WR.util.el('span', { class: 'tag tag-warn', text: '缺释义' }));
    else if (w.meaning_source === 'manual') titleLine.appendChild(WR.util.el('span', { class: 'tag tag-manual', text: '手' }));
    main.appendChild(titleLine);
    main.appendChild(WR.util.el('div', { class: 'word-sub' }, [
      WR.util.el('span', { class: 'phonetic', text: w.phonetic || '' }),
      WR.util.el('span', { class: 'meaning', text: w.meaning || '（未补录，只能出英译中题）' })
    ]));
    main.appendChild(WR.util.el('div', { class: 'word-stats', text: '错 ' + (w.wrong_count || 0) + ' · 对 ' + (w.correct_count || 0) + ' · 权重 ' + Number(w.weight).toFixed(2) }));
    row.appendChild(main);

    const ops = WR.util.el('div', { class: 'word-ops' });
    ops.appendChild(WR.util.el('button', {
      class: 'btn btn-small', text: w.meaning ? '编辑' : '补',
      onclick: function (e) { e.stopPropagation(); editWord(w); }
    }));
    ops.appendChild(WR.util.el('button', {
      class: 'btn btn-small', text: '掌握', title: '移入已掌握词库',
      onclick: async function (e) {
        e.stopPropagation();
        if (!await WR.util.confirmAsync('把「' + (w.display || w.word) + '」移入已掌握？')) return;
        await WR.db.mastered.addFromWordRow(w);
        await WR.db.words.remove(w.id);
        WR.util.toast('已移入已掌握');
        render();
      }
    }));
    ops.appendChild(WR.util.el('button', {
      class: 'btn btn-small btn-danger-ghost', text: '删',
      onclick: async function (e) {
        e.stopPropagation();
        if (!await WR.util.confirmAsync('删除「' + (w.display || w.word) + '」？')) return;
        await WR.db.words.remove(w.id);
        render();
      }
    }));
    row.appendChild(ops);
    return row;
  }

  function masteredRow(m) {
    const row = WR.util.el('div', { class: 'word-row mastered' });
    row.appendChild(WR.util.el('div', { class: 'word-main' }, [
      WR.util.el('div', { class: 'word-title' }, [
        WR.util.el('span', { class: 'word-text', text: m.display || m.word }),
        WR.util.el('span', { class: 'tag tag-ok', text: '已掌握' })
      ]),
      WR.util.el('div', { class: 'word-sub' }, [
        WR.util.el('span', { class: 'phonetic', text: m.phonetic || '' }),
        WR.util.el('span', { class: 'meaning', text: m.meaning || '' })
      ]),
      WR.util.el('div', { class: 'word-stats', text: WR.util.fmtDateTime(m.mastered_at) })
    ]));
    row.appendChild(WR.util.el('div', { class: 'word-ops' }, [
      WR.util.el('button', {
        class: 'btn btn-small', text: '移回词库',
        onclick: async function () {
          await WR.db.mastered.moveBack(m);
          WR.util.toast('已移回词库');
          render();
        }
      })
    ]));
    return row;
  }

  function editWord(w) {
    const body = WR.util.el('div');
    const phon = WR.util.el('input', { class: 'input', type: 'text', value: w.phonetic || '', placeholder: '音标，如 /ə\'bɪləti/' });
    const mean = WR.util.el('input', { class: 'input', type: 'text', value: w.meaning || '', placeholder: '词性&中文，如 n. 能力；才能' });
    body.appendChild(WR.util.el('label', { class: 'field-label', text: '音标' }));
    body.appendChild(phon);
    body.appendChild(WR.util.el('label', { class: 'field-label', text: '词性 & 中文' }));
    body.appendChild(mean);
    WR.ui.modal({
      title: '补录 / 编辑：' + (w.display || w.word),
      body: body,
      actions: [{
        text: '保存', class: 'btn-primary',
        onclick: async function (close) {
          w.phonetic = phon.value.trim();
          if (w.meaning !== mean.value.trim() && mean.value.trim()) w.meaning_source = 'manual';
          w.meaning = mean.value.trim();
          await WR.db.words.update(w);
          WR.util.toast('已保存');
          close();
          render();
        }
      }, { text: '取消', class: 'btn-secondary' }]
    });
  }

  async function renameLib() {
    const lib = await WR.db.libraries.get(libId);
    const name = window.prompt('新的词库名称', lib.name);
    if (name === null) return;
    if (!name.trim()) { WR.util.toast('名称不能为空'); return; }
    await WR.db.libraries.rename(libId, name.trim());
    render();
  }

  async function deleteLib() {
    const lib = await WR.db.libraries.get(libId);
    if (!await WR.util.confirmAsync('删除词库「' + lib.name + '」及其全部词条与听写记录？此操作不可恢复！')) return;
    if (!await WR.util.confirmAsync('再次确认：真的要删除吗？')) return;
    await WR.db.libraries.remove(libId);
    WR.util.toast('词库已删除');
    WR.router.nav('#/teacher/libraries');
  }

  render();

  return {
    destroy: function () {
      destroyFlag = true;
      if (wrap._fileInput) wrap._fileInput.remove();
    }
  };
};
