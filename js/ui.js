/* 视图公共 UI：页头、分区主题、模态框 */
WR.ui = (function () {
  function header(opts) {
    opts = opts || {};
    const h = document.getElementById('app-header');
    h.innerHTML = '';
    if (opts.back) {
      h.appendChild(WR.util.el('button', {
        class: 'icon-btn back-btn', 'aria-label': '返回',
        onclick: function (e) { e.preventDefault(); WR.router.nav(opts.back); }
      }, '‹'));
    }
    const titles = WR.util.el('div', { class: 'header-titles' });
    titles.appendChild(WR.util.el('div', { class: 'header-title', text: opts.title || '' }));
    if (opts.subtitle) titles.appendChild(WR.util.el('div', { class: 'header-subtitle', text: opts.subtitle }));
    h.appendChild(titles);
    if (opts.actions) {
      const box = WR.util.el('div', { class: 'header-actions' });
      opts.actions.forEach(function (a) {
        box.appendChild(WR.util.el(a.tag || 'button', Object.assign({ class: 'header-action' + (a.class ? ' ' + a.class : '') }, a.attrs || {}, { onclick: a.onclick, text: a.text })));
      });
      h.appendChild(box);
    }
    h.classList.toggle('hidden', !opts.title && !opts.back && !opts.actions);
  }

  function zone(name) {
    document.body.dataset.zone = name;
  }

  /* modal({title, body(Node|string), actions:[{text, class, onclick(close)}], onClose}) → {close} */
  function modal(opts) {
    const overlay = WR.util.el('div', { class: 'modal-overlay' });
    const box = WR.util.el('div', { class: 'modal' });
    if (opts.title) box.appendChild(WR.util.el('div', { class: 'modal-title', text: opts.title }));
    const body = WR.util.el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    box.appendChild(body);
    const actions = WR.util.el('div', { class: 'modal-actions' });
    function close() {
      overlay.remove();
      if (opts.onClose) opts.onClose();
    }
    (opts.actions || [{ text: '关闭' }]).forEach(function (a) {
      actions.appendChild(WR.util.el('button', {
        class: 'btn ' + (a.class || 'btn-secondary'),
        onclick: function () { a.onclick ? a.onclick(close) : close(); }
      }, a.text));
    });
    box.appendChild(actions);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay && !opts.locked) close(); });
    document.body.appendChild(overlay);
    return { close: close };
  }

  function spinner(text) {
    return WR.util.el('div', { class: 'loading' }, [
      WR.util.el('div', { class: 'spin' }),
      WR.util.el('div', { text: text || '加载中…' })
    ]);
  }

  function empty(text) {
    return WR.util.el('div', { class: 'empty', text: text || '暂无数据' });
  }

  return { header: header, zone: zone, modal: modal, spinner: spinner, empty: empty };
})();
