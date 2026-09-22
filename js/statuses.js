/* 魔鱼世界 · 状态
   全局：G.statuses

   状态是角色**挂着**的东西，定义在 data/statuses.js。
   这里管：挂上、摘掉、按步数计时、收集修正、灵性阈值自动挂摘。

   生命 / 灵性**只有这里能自动改**（状态的 tick）——
   战斗和物品都还没有。见 docs/设定/06-物品与技能.md。 */

var G = window.G || (window.G = {});

G.statuses = (function () {

  /* 灵性阈值：≤ 20% 挂枯竭，到 0% 换成耗尽。见 docs/设定/04-数值与成长.md。 */
  var ESS_LOW = 0.20;
  var ST_DRAINED = 'st_drained';
  var ST_EXHAUSTED = 'st_exhausted';

  /* ---------- 查 ---------- */

  /* 挂着的状态，拼成 [{ id, left, def }]。跳过指向已删状态的记录。 */
  function owned() {
    var p = G.state.player();
    var arr = (p && p.statuses) || [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var def = G.data.status(arr[i].id);
      if (def) out.push({ id: arr[i].id, left: Number(arr[i].left) || 0, def: def });
    }
    return out;
  }

  /* 只要定义，不要剩余量 */
  function defs() {
    var list = owned(), out = [];
    for (var i = 0; i < list.length; i++) out.push(list[i].def);
    return out;
  }

  function find(id) {
    var p = G.state.player();
    var arr = (p && p.statuses) || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return arr[i];
    }
    return null;
  }

  function has(id) { return !!find(id); }

  /* 所有挂着状态的修正项，拼成一个大数组。
     G.rules.collectMods 会把同属性的加值 / 百分比分别相加。 */
  function mods() {
    var list = defs(), out = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i].mods || [];
      for (var j = 0; j < m.length; j++) out.push(m[j]);
    }
    return out;
  }

  /* ---------- 挂 / 摘 ---------- */

  /* 挂上。**已经挂着就刷新剩余量，不叠加**（同名状态只有一份）。
     返回 true = 新挂上，false = 刷新了已有的 / 没挂上。 */
  function add(id) {
    var def = G.data.status(id);
    var p = G.state.player();
    if (!def || !p) return false;
    if (!p.statuses) p.statuses = [];

    var cur = find(id);
    if (cur) {
      cur.left = Number(def.turns) || 0;
      return false;
    }
    p.statuses.push({ id: id, left: Number(def.turns) || 0 });
    return true;
  }

  function remove(id) {
    var p = G.state.player();
    if (!p || !p.statuses) return false;
    for (var i = 0; i < p.statuses.length; i++) {
      if (p.statuses[i].id === id) {
        p.statuses.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /* ---------- tick ---------- */

  /* 执行一条 tick 效果。key 只允许 hp / ess，改完夹在 0 – 上限之间。
     返回 { key, delta }（delta 是**实际**改了多少，撞到边界会比写的少），
     不合法返回 null。 */
  function applyTick(p, tick) {
    if (!tick) return null;
    var key = tick.key;
    if (key !== 'hp' && key !== 'ess') return null;

    var delta = Number(tick.delta);
    if (!isFinite(delta)) return null;

    var before = Number(p[key]) || 0;
    var max = Number(p[key + 'Max']) || 0;
    var v = before + delta;
    if (v < 0) v = 0;
    if (max > 0 && v > max) v = max;
    p[key] = v;

    return { key: key, delta: v - before };
  }

  /* 走一步。**只有 unit 是 step 的状态会动** ——
     time 走真实秒数、manual 要人手动解、threshold 交给 syncEssence。
     返回 { ticks: [{ key, delta, def }], expired: [def] }，交给调用方写记事。 */
  function tickStep() {
    var p = G.state.player();
    var out = { ticks: [], expired: [] };
    if (!p) return out;

    var arr = p.statuses || [];
    var keep = [];

    for (var i = 0; i < arr.length; i++) {
      var rec = arr[i];
      var def = G.data.status(rec.id);
      if (!def) continue;                        /* 状态被删了，丢掉这条记录 */
      if (def.unit !== 'step') { keep.push(rec); continue; }

      /* 先执行 tick 再减 1 —— 这样"最后一步"也会掉血 */
      var hit = applyTick(p, def.tick);
      if (hit) out.ticks.push({ key: hit.key, delta: hit.delta, def: def });

      rec.left = (Number(rec.left) || 0) - 1;
      if (rec.left > 0) keep.push(rec);
      else out.expired.push(def);
    }

    p.statuses = keep;
    return out;
  }

  /* ---------- 灵性阈值 ---------- */

  /* 每次生命 / 灵性变化后调一次（现在只有 tick 会改它们）。
     灵性 ≤ 20% 挂枯竭；到 0% 换成耗尽；回到 20% 以上两个都摘掉。
     返回 { added: [def], removed: [def] }。 */
  function syncEssence() {
    var p = G.state.player();
    var out = { added: [], removed: [] };
    if (!p) return out;

    var r = G.rules.ratio(p.ess, p.essMax);

    var want = null;
    if (r <= 0) want = ST_EXHAUSTED;
    else if (r <= ESS_LOW) want = ST_DRAINED;

    /* 不该在的先摘掉 */
    var ids = [ST_DRAINED, ST_EXHAUSTED];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === want) continue;
      if (remove(ids[i])) {
        var d = G.data.status(ids[i]);
        if (d) out.removed.push(d);
      }
    }

    /* 该在的挂上 */
    if (want && !has(want)) {
      if (add(want)) {
        var w = G.data.status(want);
        if (w) out.added.push(w);
      }
    }

    return out;
  }

  return {
    owned: owned,
    defs: defs,
    find: find,
    has: has,
    mods: mods,
    add: add,
    remove: remove,
    tickStep: tickStep,
    syncEssence: syncEssence
  };

})();
