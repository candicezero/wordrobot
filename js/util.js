/* 通用工具：DOM、格式化、词形归一、词性拆分 */
window.WR = window.WR || {};

WR.util = (function () {
  const POS_TAG_RX = /\b(?:n|v|adj|adv|prep|conj|pron|num|int|interj|art|aux|abbr|vi|vt)\s*\./g;
  const ONLY_PUNCT_RX = /^[\s&.,;()（）·—\-]+$/;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]);
      }
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* 听写任务名，如 20260823-175301 */
  function tsName(d) {
    d = d || new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  function fmtDateTime(iso) {
    const d = iso instanceof Date ? iso : new Date(iso || Date.now());
    if (isNaN(d.getTime())) return String(iso || '');
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function nowIso() { return new Date().toISOString(); }

  function shuffle(arr, rand) {
    rand = rand || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }

  /* 星标词归一（项目约定：去前导*、大小写不敏感、café/cafe 变体同词） */
  function normalizeWord(s) {
    return String(s || '').trim().replace(/^\*+/g, '').replace(/\s+/g, ' ').toLowerCase();
  }

  function displayWord(s) {
    return String(s || '').trim().replace(/^\*+/g, '').replace(/\s+/g, ' ');
  }

  /* 拆“词性&中文”组合字段：n. 能力；才能 → {pos:'n.', zh:'能力；才能'}
     prep.关于 adv.大约 → {pos:'prep./adv.', zh:'关于；大约'} */
  function splitPosMeaning(meaning) {
    const m = String(meaning || '').trim();
    if (!m) return { pos: '', zh: '' };
    const tags = [];
    const SEP = '\u0001';
    const rest = m.replace(POS_TAG_RX, function (t) { tags.push(t.replace(/\s+/g, '')); return SEP; });
    const parts = rest.split(SEP).map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !ONLY_PUNCT_RX.test(s); });
    return { pos: tags.join('/'), zh: parts.join('；') };
  }

  function toast(msg, ms) {
    const box = document.getElementById('toast');
    if (!box) { alert(msg); return; }
    box.textContent = msg;
    box.classList.add('show');
    clearTimeout(box._t);
    box._t = setTimeout(function () { box.classList.remove('show'); }, ms || 2200);
  }

  async function confirmAsync(msg) {
    return window.confirm(msg);
  }

  return {
    $: $, $$: $$, el: el, esc: esc, pad2: pad2, tsName: tsName,
    fmtDateTime: fmtDateTime, nowIso: nowIso, shuffle: shuffle, debounce: debounce,
    clamp: clamp, normalizeWord: normalizeWord, displayWord: displayWord,
    splitPosMeaning: splitPosMeaning, toast: toast, confirmAsync: confirmAsync
  };
})();
