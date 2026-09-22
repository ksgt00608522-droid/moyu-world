/* 魔鱼世界 · 背包与钱包
   全局：G.items

   **只认两张表**：存档里的 items（物品 id -> { count }）和 wallet（币种 id -> 数量）。
   物品与币种的**定义**在 data/items.js，这里只管数量。

   ------------------------------------------------------------------
   为什么没有 use()
   ------------------------------------------------------------------
   "使用物品" = 跑一遍它的 use 效果 + 扣掉一个，本质是**效果执行**的一部分，
   所以它归 js/effects.js 的 useItem()。
   放到这儿的话 items 和 effects 就得互相调用（effects 要 items.give，
   items.use 要 effects.run）—— 能跑，但那是全项目唯一的一处双向依赖，不值当。
   这里保持"只认两张表"的纯数据模块。

   ------------------------------------------------------------------
   不缓存
   ------------------------------------------------------------------
   每次现读现写 G.state.data，跟 quests / events 同一个约定：
   状态只有一份，不存在"内存和存档对不上"的问题。

   ------------------------------------------------------------------
   两条夹逼规则
   ------------------------------------------------------------------
     take  取到没有为止（有 2 个却要取 5 个 -> 取走 2 个，不报错、不变负数）
     money 扣到 0 为止（同上）
   两个都**返回实际变化了多少**，调用方拿它决定要不要提示。
   给不出去 / 取不到，一律返回 0，**不抛错** —— 素材写错由 validate.mjs 拦，
   运行时只保证不炸。 */

var G = window.G || (window.G = {});

G.items = (function () {

  /* ---------- 两张表 ---------- */

  /* 拿到背包表。**顺手把缺失的表补上** —— 老存档（v5）没有这两个字段，
     正常走 migrate() 会补，但万一有别的入口漏了，这里兜一下比抛错强。 */
  function bag() {
    var st = G.state.data;
    if (!st) return null;
    if (!st.items) st.items = {};
    return st.items;
  }

  function purse() {
    var st = G.state.data;
    if (!st) return null;
    if (!st.wallet) st.wallet = {};
    return st.wallet;
  }

  /* ---------- 查 ---------- */

  /* 持有几个。**"没有记录" = 0** —— 所以旧存档不用迁移就能直接用。 */
  function count(id) {
    var b = bag();
    if (!b) return 0;
    var rec = b[id];
    if (!rec) return 0;
    var n = Number(rec.count);
    return (isFinite(n) && n > 0) ? n : 0;
  }

  function has(id) { return count(id) > 0; }

  /* 背包里的东西，拼成 [{ def, count }]，**已经排好序**。
     排序：先按分类表的顺序（消耗品 -> 装备 -> 材料 -> 特殊 -> 任务），
     同类按素材里出现的顺序。
     **不能让顺序跟着"什么时候捡到的"走** —— 那样捡个新东西整块背包就会重排，
     玩家每次都得重新找一遍。指向已删物品的记录直接跳过。 */
  function list() {
    var b = bag();
    if (!b) return [];
    var kinds = G.data.itemKinds || [];
    var defs = G.data.items || [];
    var out = [];

    for (var k = 0; k < kinds.length; k++) {
      for (var i = 0; i < defs.length; i++) {
        var def = defs[i];
        if (def.kind !== kinds[k].id) continue;
        var n = count(def.id);
        if (n > 0) out.push({ def: def, count: n });
      }
    }
    return out;
  }

  /* 按名字或 id 找一个物品**定义**（不看身上有没有）。
     名字撞了返回 { def, ambiguous: true }，让调用方提示玩家改用 id ——
     **不要随便挑一个**：挑错了玩家会以为游戏在乱来。 */
  function find(nameOrId) {
    var key = String(nameOrId == null ? '' : nameOrId).trim();
    if (!key) return null;

    var defs = G.data.items || [];
    var hit = null, n = 0;
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].id === key) return { def: defs[i], ambiguous: false };
      if (defs[i].name === key) { hit = defs[i]; n++; }
    }
    if (!hit) return null;
    return { def: hit, ambiguous: n > 1 };
  }

  /* ---------- 给 / 取 ---------- */

  /* 给 n 个，返回**实际给了几个**。
     指向不存在的物品、唯一物品已经有了，都返回 0 —— 调用方拿它判断
     要不要补一句"你已经有了"（见 js/effects.js）。
     **唯一物品（stack: false）恒为 1**：已经有了就不再累加，也不报错。 */
  function give(id, n) {
    var def = G.data.item(id);
    var b = bag();
    if (!def || !b) return 0;

    var want = Math.floor(Number(n));
    if (!isFinite(want) || want <= 0) return 0;

    var cur = count(id);
    if (!def.stack) {
      if (cur > 0) return 0;              /* 唯一物品：已经有了，等于没给 */
      b[id] = { count: 1 };
      return 1;
    }

    b[id] = { count: cur + want };
    return want;
  }

  /* 取走 n 个，返回**实际取走几个** —— 取到没有为止。 */
  function take(id, n) {
    var b = bag();
    if (!b) return 0;

    var want = Math.floor(Number(n));
    if (!isFinite(want) || want <= 0) return 0;

    var cur = count(id);
    if (cur <= 0) return 0;

    var got = Math.min(cur, want);
    var left = cur - got;
    /* 归零就把记录**删掉**，不在存档里留一个 count: 0 的空壳 ——
       "没有记录 = 没有这个东西"这条约定要保持干净，不然
       "身上有没有钱袋"就得同时看"有没有记录"和"count 是不是 0"。 */
    if (left > 0) b[id] = { count: left };
    else delete b[id];
    return got;
  }

  /* ---------- 货币 ---------- */

  /* 某个币种有多少。**"没有记录" = 0。** */
  function money(id) {
    var w = purse();
    if (!w) return 0;
    var n = Number(w[id]);
    return (isFinite(n) && n > 0) ? n : 0;
  }

  /* 改货币。delta 可正可负，**扣到 0 为止**，不会变成负数。
     返回**实际变化了多少**（钱不够时比要的少）。 */
  function addMoney(id, delta) {
    var w = purse();
    if (!w) return 0;
    if (!G.data.moneyType(id)) return 0;   /* 币种不存在就当没这回事 */

    var d = Math.floor(Number(delta));
    if (!isFinite(d) || d === 0) return 0;

    var before = money(id);
    var v = before + d;
    if (v < 0) v = 0;
    if (v > 0) w[id] = v;
    else delete w[id];                     /* 同上：归零就删记录 */
    return v - before;
  }

  /* 钱包里所有币种，按币种表的顺序，拼成 [{ def, amount }]。
     **0 也列出来** —— 玩家要能看见"我现在一枚金币都没有"，
     而不是面对一块空白（见 02-玩法循环与操作.md 的「弹框」）。
     币种多了以后这里也不用改，照表逐行画就行。 */
  function wallet() {
    var types = G.data.moneyTypes || [];
    var out = [];
    for (var i = 0; i < types.length; i++) {
      out.push({ def: types[i], amount: money(types[i].id) });
    }
    return out;
  }

  return {
    count: count,
    has: has,
    list: list,
    find: find,

    give: give,
    take: take,

    money: money,
    addMoney: addMoney,
    wallet: wallet
  };

})();
