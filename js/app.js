/* 应用入口：打开数据库 → 加载词典 → 注册路由 → 启动；SW 注册与备份重试 */
(async function () {
  try {
    await WR.db.open();
  } catch (e) {
    document.getElementById('app').innerHTML =
      '<div class="page"><div class="card"><p>数据库打开失败：' + WR.util.esc(e.message || e) + '</p></div></div>';
    return;
  }

  try {
    await WR.dictionary.load();
  } catch (e) {
    console.warn('dictionary.json 加载失败（缺释义词需手动补录）:', e);
  }

  /* 首次启动播种默认词库：任何新设备打开 App 即自动建库（词表文件随 App 托管并预缓存）。
     settings.default_wordlists_seeded 记录已播种的词表名：教师删除词库后不会重复自动创建；
     设备上已有自建词库数据时只标记、不播种，避免打扰既有使用。 */
  const DEFAULT_WORDLISTS = [
    { file: 'assets/wordlists/summer-review.txt', name: '暑期待巩固单词' }
  ];

  async function seedDefaultWordlists() {
    let seeded = await WR.db.settings.get('default_wordlists_seeded', []);
    if (!Array.isArray(seeded)) seeded = [];
    const remaining = DEFAULT_WORDLISTS.filter(function (w) { return seeded.indexOf(w.name) < 0; });
    if (!remaining.length) return;
    if (!WR.dictionary.loaded()) return;   /* 词典未就绪时跳过，下次启动重试（保证释义回填） */
    const libs = await WR.db.libraries.list();
    if (libs.length) {
      await WR.db.settings.set('default_wordlists_seeded',
        seeded.concat(remaining.map(function (w) { return w.name; })));
      return;
    }
    const cfg = await WR.db.settings.merged();
    for (const w of remaining) {
      try {
        const res = await fetch(w.file);
        if (!res.ok) continue;
        const lines = (await res.text()).split(/\r?\n/)
          .map(function (l) { return l.trim(); })
          .filter(function (l) { return l && !/^[\s*\-—·、,，]+$/.test(l); });
        if (!lines.length) continue;
        const lib = await WR.db.libraries.create(w.name);
        await WR.db.words.addFromInput(lib.id, lines, cfg);
        seeded.push(w.name);
        console.log('默认词库已创建：' + w.name + '（' + lines.length + ' 词）');
      } catch (e) {
        console.warn('默认词库播种失败（下次启动重试）:', w.file, e);
      }
    }
    if (seeded.length) await WR.db.settings.set('default_wordlists_seeded', seeded);
  }

  await seedDefaultWordlists();

  const V = WR.views;
  WR.router.add('#/home', V.home);
  WR.router.add('#/teacher', V.libraries);
  WR.router.add('#/teacher/libraries', V.libraries);
  WR.router.add('#/teacher/library/:id', V.libraryDetail);
  WR.router.add('#/teacher/sessions', V.sessions);
  WR.router.add('#/teacher/grading/:ts', V.grading);
  WR.router.add('#/teacher/students', V.students);
  WR.router.add('#/teacher/settings', V.settings);
  WR.router.add('#/child', V.childHome);
  WR.router.add('#/child/dictation/:ts', V.dictation);
  WR.router.add('#/child/done/:ts', V.childDone);

  WR.router.start();

  /* Service Worker 离线缓存 */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW 注册失败:', e); });
  }

  /* 打开 App / 联网时自动补交积压备份 */
  async function retryBackupSilently() {
    try {
      if (!(await WR.githubBackup.configured())) return;
      const rs = await WR.githubBackup.retryPending();
      if (rs.length && rs.every(function (r) { return r.ok; })) {
        WR.util.toast('已自动补交 ' + rs.length + ' 条备份 ✓');
      }
    } catch (e) { /* silent */ }
  }
  window.addEventListener('online', retryBackupSilently);
  retryBackupSilently();
})();
