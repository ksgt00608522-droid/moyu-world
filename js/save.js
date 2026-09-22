/* 魔鱼世界 · 存档
   全局：G.save

   三层，从"顺手"到"保命"：
     L1  浏览器本地键值存储，自动写        清缓存会丢
     L2  绑定一个真实磁盘文件，每次一起写   清缓存不丢  ← 真正解决丢档的那个
     L3  导出 / 导入 .json                全浏览器通用，给别人玩的主力

   文件句柄只能放 IndexedDB —— 本地键值存储存不了 FileSystemFileHandle 对象。
   所有 key 都带命名空间，因为所有 file:// 页面共享同一份本地存储。 */

var G = window.G || (window.G = {});

G.save = (function () {

  var KEY = 'moyu.save.v1';
  var IDB_NAME = 'moyu';
  var IDB_STORE = 'handles';
  var HANDLE_KEY = 'saveFile';

  var fileHandle = null;
  var lastSavedAt = 0;
  var timer = null;

  function msg(e) {
    return (e && e.message) ? e.message : String(e);
  }

  function hasFSA() {
    return typeof window.showSaveFilePicker === 'function';
  }

  /* ---------- L1：本地键值存储 ---------- */

  function writeLocal() {
    if (!G.state.data) return false;
    try {
      window.localStorage.setItem(KEY, G.state.toJSON());
      return true;
    } catch (e) {
      return false;
    }
  }

  function readLocal() {
    try { return window.localStorage.getItem(KEY); }
    catch (e) { return null; }
  }

  function clearLocal() {
    try { window.localStorage.removeItem(KEY); } catch (e) {}
  }

  /* ---------- IndexedDB：只用来存文件句柄 ---------- */

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbRun(mode, fn) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, mode);
        var req = fn(tx.objectStore(IDB_STORE));
        tx.oncomplete = function () { db.close(); resolve(req ? req.result : undefined); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function idbPut(v) { return idbRun('readwrite', function (s) { return s.put(v, HANDLE_KEY); }); }
  function idbGet() { return idbRun('readonly',  function (s) { return s.get(HANDLE_KEY); }); }

  /* ---------- L2：磁盘文件 ---------- */

  function fileName() {
    return fileHandle ? fileHandle.name : '';
  }

  /* interactive 为 true 时允许弹出授权框。自动存档一律传 false，
     否则会在没有用户手势的情况下弹窗，浏览器会直接拒绝。 */
  function writeFile(interactive) {
    if (!fileHandle || !G.state.data) return Promise.resolve(false);

    return Promise.resolve()
      .then(function () {
        if (!fileHandle.queryPermission) return 'granted';
        return fileHandle.queryPermission({ mode: 'readwrite' });
      })
      .then(function (p) {
        if (p === 'granted') return 'granted';
        if (!interactive) return 'denied';
        return fileHandle.requestPermission({ mode: 'readwrite' });
      })
      .then(function (p) {
        if (p !== 'granted') return false;
        return fileHandle.createWritable().then(function (w) {
          return w.write(G.state.toJSON()).then(function () { return w.close(); });
        }).then(function () { return true; });
      })
      .catch(function () { return false; });
  }

  function bindFile() {
    if (!hasFSA()) {
      G.ui.log(G.data.t('bind.unsupported'), 'warn');
      return;
    }
    /* 注意：这行之前不能有 await，否则用户手势会被消耗掉 */
    window.showSaveFilePicker({
      suggestedName: '魔鱼世界-存档.json',
      types: [{ description: '存档文件', accept: { 'application/json': ['.json'] } }]
    }).then(function (handle) {
      fileHandle = handle;
      return idbPut(handle).catch(function () {}).then(function () {
        return writeFile(true);
      });
    }).then(function () {
      G.ui.log(G.data.t('bind.ok', { file: fileName() }), 'ok');
      G.ui.refresh();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;   /* 用户自己取消的，不报错 */
      G.ui.log(G.data.t('bind.fail', { msg: msg(e) }), 'err');
    });
  }

  /* 开机时把上次绑定的句柄捞回来。权限可能是 prompt，不在这里弹窗。 */
  function restoreHandle() {
    if (!hasFSA()) return Promise.resolve();
    return idbGet().then(function (h) {
      if (h) fileHandle = h;
    }).catch(function () {});
  }

  function readFileHandle() {
    if (!fileHandle) return Promise.resolve(null);
    return fileHandle.getFile().then(function (f) {
      return f.text();
    }).catch(function () { return null; });
  }

  /* ---------- 存档 / 读档 ---------- */

  function markSaved() {
    lastSavedAt = Date.now();
  }

  /* 自动存档：状态一变就调，debounce 后落盘 */
  function auto() {
    if (!G.state.data) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      if (writeLocal()) markSaved();
      writeFile(false);
      G.ui.renderSaveLabel();
    }, 300);
  }

  /* 玩家主动存档：本地 + 磁盘都写，并且报告结果 */
  function explicit() {
    if (!G.state.data) return;
    var ok = writeLocal();
    if (!ok) {
      G.ui.log(G.data.t('save.fail', { msg: '浏览器本地存储不可用' }), 'err');
      return;
    }
    markSaved();

    if (!fileHandle) {
      G.ui.log(G.data.t('save.ok'), 'ok');
      G.ui.renderSaveLabel();
      return;
    }

    writeFile(true).then(function (done) {
      if (done) {
        G.ui.log(G.data.t('save.ok.file', { file: fileName() }), 'ok');
      } else {
        G.ui.log(G.data.t('save.ok'), 'ok');
        G.ui.log('磁盘文件没写成功，可能没授权。再点一次「存档」试试。', 'warn');
      }
      G.ui.renderSaveLabel();
    });
  }

  /* 读档：优先磁盘文件，没有就退回本地存储 */
  function load() {
    var fromFile = !!fileHandle;

    (fromFile ? readFileHandle() : Promise.resolve(null)).then(function (text) {
      if (!text) {
        fromFile = false;
        text = readLocal();
      }
      if (!text) {
        G.ui.log(G.data.t('load.none'), 'warn');
        return;
      }
      try {
        G.state.fromJSON(text);
        G.ui.clearLog();
        G.ui.log(G.data.t('load.ok', { name: G.state.player().name }), 'ok');
        if (fromFile) G.ui.log('来源：磁盘文件「' + fileName() + '」', 'sys');
        else G.ui.log('来源：浏览器本地存储', 'sys');
        G.world.describe(G.state.room());
        G.ui.refresh();
        markSaved();
      } catch (e) {
        G.ui.log(G.data.t('load.fail', { msg: msg(e) }), 'err');
      }
    });
  }

  function wipe() {
    clearLocal();
    G.state.data = null;
    lastSavedAt = 0;
  }

  /* ---------- L3：导出 / 导入 ---------- */

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function exportFile() {
    if (!G.state.data) return;
    try {
      var name = '魔鱼世界-' + (G.state.player().name || '存档') + '-' + stamp() + '.json';
      var blob = new Blob([G.state.toJSON()], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      G.ui.log(G.data.t('export.ok', { file: name }), 'ok');
    } catch (e) {
      G.ui.log(G.data.t('save.fail', { msg: msg(e) }), 'err');
    }
  }

  function pickImport() {
    var input = document.getElementById('file-input');
    input.value = '';
    input.click();
    G.ui.log(G.data.t('import.ask'), 'sys');
  }

  function onImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        G.state.fromJSON(String(reader.result));
        G.ui.clearLog();
        G.ui.log(G.data.t('import.ok', {
          name: G.state.player().name
        }), 'ok');
        G.world.describe(G.state.room());
        G.ui.refresh();
        markSaved();
      } catch (e) {
        G.ui.log(G.data.t('import.fail', { msg: msg(e) }), 'err');
      }
    };
    reader.onerror = function () {
      G.ui.log(G.data.t('import.fail', { msg: '文件读不出来' }), 'err');
    };
    reader.readAsText(file, 'utf-8');
  }

  return {
    KEY: KEY,
    auto: auto,
    explicit: explicit,
    load: load,
    wipe: wipe,
    writeLocal: writeLocal,
    readLocal: readLocal,
    clearLocal: clearLocal,
    bindFile: bindFile,
    restoreHandle: restoreHandle,
    fileName: fileName,
    hasFSA: hasFSA,
    exportFile: exportFile,
    pickImport: pickImport,
    onImportFile: onImportFile,
    lastSavedAt: function () { return lastSavedAt; }
  };

})();
