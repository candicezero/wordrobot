/* Service Worker：App 壳 + 词典预缓存，首次联网加载后可完全离线。
   注意：每次发版修改文件后，把 CACHE 版本号 +1（如 wordrobot-v2）。 */
const CACHE = 'wordrobot-v3';
const ASSETS = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './css/app.css',
  './css/teacher.css',
  './css/child.css',
  './js/util.js',
  './js/ui.js',
  './js/db.js',
  './js/dictionary.js',
  './js/selector.js',
  './js/grading.js',
  './js/reward.js',
  './js/tts.js',
  './js/asr.js',
  './js/githubBackup.js',
  './js/backup.js',
  './js/router.js',
  './js/views/home.js',
  './js/views/libraries.js',
  './js/views/grading.js',
  './js/views/students.js',
  './js/views/settings.js',
  './js/views/child.js',
  './js/app.js',
  './assets/dictionary.json',
  './assets/wordlists/summer-review.txt',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-180.png',
  './assets/icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;               // 备份 PUT 等不拦截
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;     // GitHub API 等跨域请求不拦截

  /* 导航请求：缓存壳优先，离线兜底 index.html */
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then(function (cached) {
        return cached || fetch(req);
      })
    );
    return;
  }

  /* 静态资源：cache-first，未命中取网络并回填 */
  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, clone); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
