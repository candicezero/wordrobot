/* 词典：启动时 fetch dictionary.json 到内存，毫秒级查询；含变体归一（café→cafe） */
WR.dictionary = (function () {
  let map = null;
  let foldedIndex = null; // 去音符 key → 原始 key

  function foldKey(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  }

  function buildFolded() {
    foldedIndex = {};
    Object.keys(map).forEach(function (k) {
      const f = foldKey(k);
      if (!(f in foldedIndex)) foldedIndex[f] = k;
    });
  }

  async function load(url) {
    const res = await fetch(url || 'assets/dictionary.json');
    if (!res.ok) throw new Error('词典加载失败: ' + res.status);
    map = await res.json();
    buildFolded();
    return map;
  }

  function lookup(raw) {
    if (!map) return null;
    const key = WR.util.normalizeWord(raw);
    if (!key) return null;
    let entry = map[key];
    if (!entry) {
      const folded = foldedIndex[foldKey(key)];
      if (folded) entry = map[folded];
    }
    if (!entry) return null;
    return {
      phonetic: entry.phonetic || '',
      meaning: entry.meaning || '',
      starred: !!entry.starred,
      pdf_index: entry.pdf_index
    };
  }

  function loaded() { return !!map; }
  function size() { return map ? Object.keys(map).length : 0; }

  return { load: load, lookup: lookup, loaded: loaded, size: size, foldKey: foldKey };
})();
