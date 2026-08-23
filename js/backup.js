/* 手动备份通道：导出/导入 JSON 文件 + 存储持久化申请 */
WR.backup = (function () {
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  async function exportFile() {
    const payload = await WR.db.exportAll();
    download('wordrobot-backup-' + WR.util.tsName(new Date()) + '.json', JSON.stringify(payload));
  }

  async function importFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.app !== 'wordrobot' || !data.data) throw new Error('备份文件格式不正确');
    await WR.db.replaceAll(data);
    return data;
  }

  async function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      try { return await navigator.storage.persist(); } catch (e) { return false; }
    }
    return false;
  }

  async function persistenceGranted() {
    if (navigator.storage && navigator.storage.persisted) {
      try { return await navigator.storage.persisted(); } catch (e) { return false; }
    }
    return false;
  }

  return { exportFile: exportFile, importFile: importFile, download: download,
    requestPersistence: requestPersistence, persistenceGranted: persistenceGranted };
})();
