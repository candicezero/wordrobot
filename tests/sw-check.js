(async () => {
  const out = {};
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    out.registered = !!reg;
    out.state = reg ? (reg.installing ? 'installing' : reg.waiting ? 'waiting' : reg.active ? 'active' : '?') : 'none';
    out.controller = !!navigator.serviceWorker.controller;
    if ('caches' in window) {
      const keys = await caches.keys();
      out.cacheNames = keys;
      const c = await caches.open(keys[0]);
      out.assetCount = (await c.keys()).length;
      out.hasDict = !!(await c.match('assets/dictionary.json'));
      out.hasIndex = !!(await c.match('index.html')) || !!(await c.match('./index.html')) || !!(await c.match('./'));
      out.hasIcon = !!(await c.match('assets/icons/icon-192.png'));
    }
  } catch (e) {
    out.ERROR = (e && e.stack) || String(e);
  }
  return JSON.stringify(out);
})()
