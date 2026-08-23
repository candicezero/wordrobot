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
