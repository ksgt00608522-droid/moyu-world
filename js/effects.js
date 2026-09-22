/* 魔鱼世界 · 效果执行器
   全局：G.effects

   **唯一认识效果键的地方。** 事件点的 onCollide / onUse、物品的 use、
   任务的 reward 发的提示，跑的都是同一套效果 —— 那七个键只在这里解释一遍。
   别的地方再抄一份的话，两边迟早对不上（加个新键只改了一处）。

   不碰 DOM：只产出 { text, cls } 的行，写记事与刷新交给调用方 ——
   跟 G.talk / G.events 是同一条规矩。

   ------------------------------------------------------------------
   效果分三条路落地（见 docs/设定/10-事件点.md 第三节）
   ------------------------------------------------------------------
     log / cls            直接变成记事行，交给调用方写
     give / take / money  落到 G.items（背包与钱包两张表）
     buff                 落到 G.statuses（挂状态）
     set                  落到 G.rules.applyEffect（**现在还是空壳**）

   **set 是唯一还没接通的一条**，因为它唯一一个"目标字段还没定"。
   别把 give / money 也塞进 applyEffect —— 它们的落点不是玩家对象上的字段，
   而是一张表，塞进去那个函数就变成什么都管了。

   ------------------------------------------------------------------
   两条容易写错的
   ------------------------------------------------------------------
   1. 每条效果里**先写记事再改东西**。玩家先看到"你把草嚼了"，
      再看到"你身上多了「凝神」"；反过来读着别扭。
   2. 给不出去的时候**要补一句**。唯一物品已经有了再给，素材那句
      "你捡起钱袋"照样会写进记事，背包里却什么都没多 —— 那就是静默失效，
      是本项目最讨厌的一类坑。 */

var G = window.G || (window.G = {});

G.effects = (function () {

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* "带符号的字符串" -> 数字。`"+20"` / `"-5"` 都认，别的一律 0。
     跟 set 的值是同一个规矩（格式由 tools/validate.mjs 拦）。 */
  function signed(v) {
    if (typeof v !== 'string') return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /* 一串物品增减。sign 是 +1（给）或 -1（取）。
     取的那一边**不补提示** —— 取到多少算多少是明确的行为（跟 money 一样），
     只有"给不出去"才是意外。 */
  function applyItems(map, sign, out) {
    for (var id in map) {
      if (!own(map, id)) continue;

      var n = Math.floor(Number(map[id]));
      if (!isFinite(n) || n <= 0) continue;

      var moved = (sign > 0) ? G.items.give(id, n) : G.items.take(id, n);

      if (sign > 0 && moved === 0) {
        var def = G.data.item(id);
        out.events.push({
          text: G.data.t('item.dup', { name: def ? def.name : id }),
          cls: 'info'
        });
      }
    }
  }

  /* 货币增减。值是带符号的字符串，扣到 0 为止，不报错。 */
  function applyMoney(map, out) {
    for (var id in map) {
      if (!own(map, id)) continue;
      var d = signed(map[id]);
      if (!d) continue;
      G.items.addMoney(id, d);
    }
  }

  /* 挂一个状态。**已经挂着就是续期**（剩余量重置回满），跟 cast 一致 ——
     不然喝两瓶药水就叠出两个「凝神」，属性明细里会多算一遍。
     G.statuses.add() 返回 true = 新挂上，false = 续期。 */
  function applyBuff(id, out) {
    var def = G.data.status(id);
    if (!def) return;
    var fresh = G.statuses.add(id);
    out.events.push({
      text: G.data.t(fresh ? 'status.gain' : 'status.refresh', { name: def.name }),
      cls: fresh ? 'ok' : 'info'
    });
  }

  /* 把一串效果跑一遍，返回 { events }。 */
  function run(list) {
    var out = { events: [] };
    if (!(list instanceof Array)) return out;

    for (var i = 0; i < list.length; i++) {
      var ef = list[i] || {};

      if (ef.log) out.events.push({ text: ef.log, cls: ef.cls || 'info' });

      if (ef.give)  applyItems(ef.give, 1, out);
      if (ef.take)  applyItems(ef.take, -1, out);
      if (ef.money) applyMoney(ef.money, out);
      if (ef.buff)  applyBuff(ef.buff, out);

      /* 数值效果交给 G.rules —— **现在它是个空壳，什么都不做**。
         玩法还没定（连有没有血量都没定），现在就把扣血写实等于替玩家拍板。
         素材照写、这里照调，等 A 组拍板只改 applyEffect 那一个函数。 */
      if (ef.set) {
        for (var k in ef.set) {
          if (own(ef.set, k)) G.rules.applyEffect(k, ef.set[k]);
        }
      }
    }
    return out;
  }

  /* 用一次物品：跑它的 use 效果，**再扣掉一个**。
     返回 { ok, def, events }。

     ok 是 false 有三种情况，调用方各给一句不同的提示：
       找不到这个物品 / 身上没有 / 它压根没写 use（那是"打开面板"型的）

     **扣在效果后面**：万一以后有"用完自己再给一个"的效果，
     先跑后扣才是对的（先扣后跑会把刚给的那个也扣走）。 */
  function useItem(id) {
    var out = { ok: false, def: null, events: [] };
    var def = G.data.item(id);
    if (!def || !def.use || !def.use.length) return out;
    if (!G.items.has(id)) return out;

    var r = run(def.use);
    G.items.take(id, 1);

    out.ok = true;
    out.def = def;
    out.events = r.events;
    return out;
  }

  return {
    run: run,
    useItem: useItem
  };

})();
