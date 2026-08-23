/* IndexedDB 数据层（库名 wordrobot），设计见 docs/design-plan.md §2 */
WR.db = (function () {
  const DB_NAME = 'wordrobot';
  const DB_VERSION = 1;
  const S = {
    libraries: 'libraries', words: 'words', mastered: 'mastered_words',
    students: 'students', sessions: 'sessions', session_items: 'session_items',
    gradings: 'gradings', badges: 'badges', milestone_events: 'milestone_events',
    backup_queue: 'backup_queue', settings: 'settings', grading_drafts: 'grading_drafts'
  };

  let db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const d = req.result;
        d.createObjectStore(S.libraries, { keyPath: 'id', autoIncrement: true });
        const w = d.createObjectStore(S.words, { keyPath: 'id', autoIncrement: true });
        w.createIndex('library_id', 'library_id', { unique: false });
        w.createIndex('lib_word', ['library_id', 'word'], { unique: true });
        const m = d.createObjectStore(S.mastered, { keyPath: 'id', autoIncrement: true });
        m.createIndex('library_id', 'library_id', { unique: false });
        m.createIndex('lib_word', ['library_id', 'word'], { unique: true });
        d.createObjectStore(S.students, { keyPath: 'id', autoIncrement: true });
        const se = d.createObjectStore(S.sessions, { keyPath: 'id', autoIncrement: true });
        se.createIndex('library_id', 'library_id', { unique: false });
        se.createIndex('ts_name', 'ts_name', { unique: true });
        const si = d.createObjectStore(S.session_items, { keyPath: 'id', autoIncrement: true });
        si.createIndex('session_id', 'session_id', { unique: false });
        const g = d.createObjectStore(S.gradings, { keyPath: 'id', autoIncrement: true });
        g.createIndex('session_id', 'session_id', { unique: false });
        g.createIndex('sess_student', ['session_id', 'student_id'], { unique: true });
        const b = d.createObjectStore(S.badges, { keyPath: 'id', autoIncrement: true });
        b.createIndex('student_id', 'student_id', { unique: false });
        b.createIndex('grading_id', 'grading_id', { unique: false });
        const me = d.createObjectStore(S.milestone_events, { keyPath: 'id', autoIncrement: true });
        me.createIndex('library_id', 'library_id', { unique: false });
        d.createObjectStore(S.backup_queue, { keyPath: 'id', autoIncrement: true });
        d.createObjectStore(S.settings, { keyPath: 'key' });
        d.createObjectStore(S.grading_drafts, { keyPath: ['session_id', 'student_id'] });
      };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function p(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function store(name, mode) {
    return db.transaction(name, mode || 'readonly').objectStore(name);
  }

  function get(name, key) { return p(store(name).get(key)); }
  function put(name, val) { return p(store(name, 'readwrite').put(val)); }
  function del(name, key) { return p(store(name, 'readwrite').delete(key)); }
  function all(name) { return p(store(name).getAll()); }
  function clear(name) { return p(store(name, 'readwrite').clear()); }
  function count(name) { return p(store(name).count()); }
  function byIndex(name, index, key) { return p(store(name).index(index).getAll(key)); }
  function byIndexOne(name, index, key) { return p(store(name).index(index).get(key)); }

  /* ---------- settings ---------- */
  const settings = {
    async get(key, def) {
      const row = await get(S.settings, key);
      return row ? row.value : def;
    },
    async set(key, value) { await put(S.settings, { key: key, value: value }); },
    async getAll() {
      const rows = await all(S.settings);
      const out = {};
      rows.forEach(function (r) { out[r.key] = r.value; });
      return out;
    },
    /* 合并 WR_CONFIG 默认值与已保存设置 */
    async merged() {
      const saved = await settings.getAll();
      const out = {};
      Object.keys(WR_CONFIG).forEach(function (section) {
        out[section] = Object.assign({}, WR_CONFIG[section], saved[section] || {});
      });
      return out;
    }
  };

  /* ---------- libraries ---------- */
  const libraries = {
    async create(name) {
      const now = WR.util.nowIso();
      const row = { name: String(name || '').trim(), created_at: now, updated_at: now };
      row.id = await put(S.libraries, row);
      return row;
    },
    async list() {
      const rows = await all(S.libraries);
      rows.sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); });
      return rows;
    },
    get(id) { return get(S.libraries, Number(id)); },
    async touch(id) {
      const row = await libraries.get(id);
      if (row) { row.updated_at = WR.util.nowIso(); await put(S.libraries, row); }
    },
    async rename(id, name) {
      const row = await libraries.get(id);
      if (row) { row.name = String(name || '').trim(); row.updated_at = WR.util.nowIso(); await put(S.libraries, row); }
    },
    async remove(id) {
      await del(S.libraries, Number(id));
      const words = await byIndex(S.words, 'library_id', Number(id));
      for (const w of words) await del(S.words, w.id);
      const mastered = await byIndex(S.mastered, 'library_id', Number(id));
      for (const m of mastered) await del(S.mastered, m.id);
      const sessions = await byIndex(S.sessions, 'library_id', Number(id));
      for (const se of sessions) {
        const items = await byIndex(S.session_items, 'session_id', se.id);
        for (const it of items) await del(S.session_items, it.id);
        const grads = await byIndex(S.gradings, 'session_id', se.id);
        for (const gr of grads) await del(S.gradings, gr.id);
        await del(S.sessions, se.id);
      }
    }
  };

  /* ---------- words ---------- */
  const words = {
    listByLibrary(libId) { return byIndex(S.words, 'library_id', Number(libId)); },
    getByWord(libId, word) { return byIndexOne(S.words, 'lib_word', [Number(libId), word]); },
    async update(row) { await put(S.words, row); return row; },
    remove(id) { return del(S.words, Number(id)); },
    /* 词库新增：rawList 为原始输入串数组；返回导入报告 */
    async addFromInput(libId, rawList, cfg) {
      cfg = cfg || WR_CONFIG;
      const existingWords = {};
      (await words.listByLibrary(libId)).forEach(function (w) { existingWords[w.word] = true; });
      const existingMastered = {};
      (await mastered.listByLibrary(libId)).forEach(function (m) { existingMastered[m.word] = true; });
      const report = { added: [], skipped: [], missing: [] };
      const now = WR.util.nowIso();
      for (const raw of rawList) {
        const norm = WR.util.normalizeWord(raw);
        if (!norm) continue;
        if (existingWords[norm] || existingMastered[norm]) { report.skipped.push(WR.util.displayWord(raw)); continue; }
        const display = WR.util.displayWord(raw) || norm;
        const hit = WR.dictionary.loaded() ? WR.dictionary.lookup(norm) : null;
        const row = {
          library_id: Number(libId), word: norm, display: display,
          phonetic: hit ? hit.phonetic : '', meaning: hit ? hit.meaning : '',
          meaning_source: hit ? 'pdf' : 'manual', starred: hit ? hit.starred : false,
          weight: cfg.selection.initial_weight, wrong_count: 0, correct_count: 0,
          created_at: now
        };
        row.id = await put(S.words, row);
        existingWords[norm] = true;
        report.added.push(display);
        if (!row.meaning) report.missing.push(display);
      }
      if (report.added.length) await libraries.touch(libId);
      return report;
    }
  };

  /* ---------- mastered ---------- */
  const mastered = {
    listByLibrary(libId) { return byIndex(S.mastered, 'library_id', Number(libId)); },
    getByWord(libId, word) { return byIndexOne(S.mastered, 'lib_word', [Number(libId), word]); },
    async countByLibrary(libId) {
      const rows = await byIndex(S.mastered, 'library_id', Number(libId));
      return rows.length;
    },
    async addFromWordRow(row) {
      const m = Object.assign({}, row);
      delete m.id;
      m.mastered_at = WR.util.nowIso();
      m.id = await put(S.mastered, m);
      return m;
    },
    async moveBack(mRow) {
      const w = Object.assign({}, mRow);
      delete w.id; delete w.mastered_at;
      w.id = await put(S.words, w);
      await del(S.mastered, mRow.id);
      return w;
    },
    remove(id) { return del(S.mastered, Number(id)); }
  };

  /* ---------- students ---------- */
  const students = {
    async list() {
      const rows = await all(S.students);
      rows.sort(function (a, b) { return (a.created_at || '').localeCompare(b.created_at || ''); });
      return rows;
    },
    async create(name) {
      const row = { name: String(name || '').trim(), created_at: WR.util.nowIso() };
      row.id = await put(S.students, row);
      return row;
    },
    async rename(id, name) {
      const row = await get(S.students, Number(id));
      if (row) { row.name = String(name || '').trim(); await put(S.students, row); }
    },
    async remove(id) {
      await del(S.students, Number(id));
      const rows = await byIndex(S.badges, 'student_id', Number(id));
      for (const r of rows) await del(S.badges, r.id);
    },
    get(id) { return get(S.students, Number(id)); }
  };

  /* ---------- sessions & items ---------- */
  const sessions = {
    async create(libraryId, items, cfgDictation) {
      const now = new Date();
      /* 同一秒内重复创建时追加序号，保证 ts_name 唯一 */
      let ts = WR.util.tsName(now), n = 2;
      while (await sessions.byTsName(ts)) { ts = WR.util.tsName(now) + '-' + n; n++; }
      const session = {
        ts_name: ts, library_id: Number(libraryId),
        created_at: now.toISOString(),
        total: items.length,
        c2e_count: items.filter(function (i) { return i.q_type === 'C2E'; }).length,
        e2c_count: items.filter(function (i) { return i.q_type === 'E2C'; }).length
      };
      session.id = await put(S.sessions, session);
      for (const it of items) {
        it.session_id = session.id;
        it.id = await put(S.session_items, it);
      }
      return session;
    },
    async listDesc() {
      const rows = await all(S.sessions);
      rows.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
      return rows;
    },
    async latestForLibrary(libId) {
      const rows = await byIndex(S.sessions, 'library_id', Number(libId));
      if (!rows.length) return null;
      rows.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || '') || b.id - a.id; });
      return rows[0];
    },
    async byTsName(ts) {
      const rows = await all(S.sessions);
      return rows.find(function (r) { return r.ts_name === ts; }) || null;
    },
    async items(sessionId) {
      const rows = await byIndex(S.session_items, 'session_id', Number(sessionId));
      rows.sort(function (a, b) { return a.seq - b.seq; });
      return rows;
    }
  };

  /* ---------- gradings ---------- */
  const gradings = {
    bySession(sessionId) { return byIndex(S.gradings, 'session_id', Number(sessionId)); },
    get(sessionId, studentId) { return byIndexOne(S.gradings, 'sess_student', [Number(sessionId), Number(studentId)]); },
    save(row) { return put(S.gradings, row); },
    remove(id) { return del(S.gradings, Number(id)); }
  };

  /* ---------- badges ---------- */
  const badges = {
    async add(studentId, gradingId, kind) {
      const row = {
        student_id: Number(studentId), grading_id: gradingId == null ? null : Number(gradingId),
        kind: kind, created_at: WR.util.nowIso()
      };
      row.id = await put(S.badges, row);
      return row;
    },
    listByStudent(studentId) { return byIndex(S.badges, 'student_id', Number(studentId)); },
    async countsByStudent(studentId) {
      const rows = await badges.listByStudent(studentId);
      const out = { small: 0, big: 0 };
      rows.forEach(function (r) { if (out[r.kind] !== undefined) out[r.kind]++; });
      return out;
    },
    remove(id) { return del(S.badges, Number(id)); },
    async removeByGrading(gradingId) {
      const rows = await byIndex(S.badges, 'grading_id', Number(gradingId));
      for (const r of rows) await del(S.badges, r.id);
    }
  };

  /* ---------- milestones ---------- */
  const milestones = {
    listByLibrary(libId) { return byIndex(S.milestone_events, 'library_id', Number(libId)); },
    async add(libId, masteredCount) {
      const row = { library_id: Number(libId), mastered_count: masteredCount, created_at: WR.util.nowIso(), shown_at: null };
      row.id = await put(S.milestone_events, row);
      return row;
    },
    async markShown(id) {
      const row = await get(S.milestone_events, Number(id));
      if (row) { row.shown_at = WR.util.nowIso(); await put(S.milestone_events, row); }
    },
    async pendingAll() {
      const rows = await all(S.milestone_events);
      return rows.filter(function (r) { return !r.shown_at; })
        .sort(function (a, b) { return a.mastered_count - b.mastered_count; });
    },
    remove(id) { return del(S.milestone_events, Number(id)); }
  };

  /* ---------- backup queue ---------- */
  const queue = {
    async enqueue(payloadJson, commitMsg) {
      const row = {
        payload_json: payloadJson, commit_msg: commitMsg, status: 'pending',
        attempts: 0, created_at: WR.util.nowIso(), sent_at: null
      };
      row.id = await put(S.backup_queue, row);
      return row;
    },
    async all() {
      const rows = await all(S.backup_queue);
      rows.sort(function (a, b) { return (a.created_at || '').localeCompare(b.created_at || ''); });
      return rows;
    },
    async pendingList() { return (await queue.all()).filter(function (r) { return r.status === 'pending'; }); },
    async markSent(id) {
      const row = await get(S.backup_queue, Number(id));
      if (row) { row.status = 'sent'; row.sent_at = WR.util.nowIso(); await put(S.backup_queue, row); }
    },
    async markFailed(id) {
      const row = await get(S.backup_queue, Number(id));
      if (row) { row.status = 'failed'; row.attempts = (row.attempts || 0) + 1; await put(S.backup_queue, row); }
    },
    remove(id) { return del(S.backup_queue, Number(id)); }
  };

  /* ---------- grading drafts ---------- */
  const drafts = {
    get(sessionId, studentId) { return get(S.grading_drafts, [Number(sessionId), Number(studentId)]); },
    put(sessionId, studentId, checkedIds) {
      return put(S.grading_drafts, {
        session_id: Number(sessionId), student_id: Number(studentId),
        checked_ids: JSON.stringify(checkedIds), updated_at: WR.util.nowIso()
      });
    },
    async clearSession(sessionId) {
      const rows = await all(S.grading_drafts);
      for (const r of rows) if (r.session_id === Number(sessionId)) await del(S.grading_drafts, [r.session_id, r.student_id]);
    }
  };

  /* ---------- 全库导出 / 恢复 ---------- */
  const BACKUP_STORES = [S.libraries, S.words, S.mastered, S.students, S.sessions,
    S.session_items, S.gradings, S.badges, S.milestone_events, S.settings];

  async function exportAll() {
    const data = {};
    for (const name of BACKUP_STORES) data[name] = await all(name);
    return { app: 'wordrobot', version: 1, exported_at: WR.util.nowIso(), data: data };
  }

  async function replaceAll(payload) {
    if (!payload || payload.app !== 'wordrobot' || !payload.data) {
      throw new Error('备份文件格式不正确');
    }
    for (const name of BACKUP_STORES) {
      await clear(name);
      const rows = payload.data[name] || [];
      for (const row of rows) await put(name, row);
    }
    await clear(S.backup_queue);
    await clear(S.grading_drafts);
  }

  async function wipeAll() {
    for (const name of Object.values(S)) await clear(name);
  }

  return {
    open: open, S: S,
    settings: settings, libraries: libraries, words: words, mastered: mastered,
    students: students, sessions: sessions, gradings: gradings, badges: badges,
    milestones: milestones, queue: queue, drafts: drafts,
    exportAll: exportAll, replaceAll: replaceAll, wipeAll: wipeAll
  };
})();
