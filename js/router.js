/* hash 路由：#/teacher/library/123 → {id:'123'}；视图返回 {destroy} 可选 */
WR.router = (function () {
  const routes = [];
  let current = null;

  function add(pattern, fn) {
    const names = [];
    const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, function (m) {
      names.push(m.slice(1));
      return '([^/]+)';
    }) + '$');
    routes.push({ rx: rx, fn: fn, names: names });
  }

  function nav(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    const h = location.hash || '#/home';
    for (const r of routes) {
      const m = h.match(r.rx);
      if (m) {
        const params = {};
        r.names.forEach(function (n, i) { params[n] = decodeURIComponent(m[i + 1]); });
        const app = document.getElementById('app');
        app.innerHTML = '';
        if (current && current.destroy) {
          try { current.destroy(); } catch (e) { /* ignore */ }
        }
        current = r.fn(app, params) || {};
        window.scrollTo(0, 0);
        return;
      }
    }
    if (h !== '#/home') nav('#/home');
  }

  function start() {
    window.addEventListener('hashchange', render);
    render();
  }

  return { add: add, nav: nav, start: start, refresh: render };
})();
