/* 魔鱼世界 · 事件点
   全局：G.events

   事件点**定义**在 data/events.js，这个模块只管"触发过没有、触发一次会怎样"。

   触发次数不缓存在模块里，每次现读现写 G.state.data.events ——
   状态只有一份，不存在"内存和存档对不上"的问题。

   ------------------------------------------------------------------
   三个正交维度（见 docs/设定/10-事件点.md 第二节）
   ------------------------------------------------------------------
     怎么触发   onCollide（走上去自动）/ onUse（点按钮）/ 两个都写
     去留       once    true = 用一次就没 / false = 永远在
     藏不藏     hidden  true = 触发前只画空框 / false = 一直画字

   三个维度互相独立、随便组合 —— **不要**把它们写成一个
   "泉水型 / 物品型 / 机关型"的枚举，那样以后想加新组合就得改代码。

   ------------------------------------------------------------------
   不碰 DOM
   ------------------------------------------------------------------
   ui.js 要读这个模块来画地图（ui → events），所以它不能反向调 ui ——
   否则两个模块成环，违反"依赖方向严格单向"。
   按项目的做法：fire() 只**产出事件列表** { text, cls }，
   调用方（main.js 的 runUse、world.js 的 move）负责写记事和刷新。

   fire() 返回的 events 是"要写进记事的行"，跟 G.talk 的返回字段同名 ——
   因为它们处理方式一模一样。别跟"事件点"混起来。 */

var G = window.G || (window.G = {});

G.events = (function () {

  var KIND_STEP = 'step';
  var KIND_USE  = 'use';

  /* 存档里那一条记录，没有返回 null。只读，不改状态 ——
     UI 每次刷新都会问一遍，查询不该有副作用。 */
  function entry(id) {
    var st = G.state.data;
    if (!st || !st.events) return null;
    return st.events[id] || null;
  }

  /* 触发 / 互动过几次。**"没有记录" = 0**（一次都没触发过），
     所以旧存档不用迁移就能直接用。 */
  function timesOf(id) {
    var e = entry(id);
    return e ? (Number(e.times) || 0) : 0;
  }

  /* 记一次。**先记次数再跑效果** —— 反过来的话，效果里如果想问一句
     "这是第几次"，拿到的还是旧值。 */
  function bump(id) {
    var st = G.state.data;
    if (!st) return;
    if (!st.events) st.events = {};
    var e = st.events[id] || (st.events[id] = { times: 0 });
    e.times = (Number(e.times) || 0) + 1;
  }

  /* ---------- 三个维度：条目覆盖类型表 ----------

     这三条逻辑**只写在这里**。UI 里再抄一遍的话两边迟早对不上 ——
     比如地图按 hidden 画了空框，面板却按类型表画了字。 */

  function fromType(ev, key) {
    if (!ev) return false;
    if (ev[key] != null) return !!ev[key];      /* 条目写了就听条目的 */
    var t = G.data.eventType(ev.type);
    return !!(t && t[key]);                     /* 否则看类型表 */
  }

  function onceOf(ev)   { return fromType(ev, 'once'); }
  function hiddenOf(ev) { return fromType(ev, 'hidden'); }

  /* 还在不在。once 且已经用过 → 没了。
     注意这里**不看 room** —— 同一个 id = 同一份状态，
     在一处用掉了，写在别处的那一个也没了（跟 NPC「同一个人出现在多处」同一个约定）。 */
  function alive(ev) {
    if (!ev) return false;
    return !onceOf(ev) || timesOf(ev.id) === 0;
  }

  /* 该不该画字。不藏的照画；藏的**触发过之后**才画 ——
     这就是"走到前无法察觉，触发后可以看到了"。 */
  function revealed(ev) {
    if (!ev) return false;
    return !hiddenOf(ev) || timesOf(ev.id) > 0;
  }

  /* ---------- 位置 ---------- */

  /* 这一房间里**还活着**的事件点索引：{ "x,y": ev }。
     渲染地图和判定触发都用它 —— 已经用掉的一次性事件点不在里面，
     所以地图、面板、触发三条路**一起**消失，
     不会出现"地图上没了但还能点"或者反过来的情况。

     同一格写了两个事件点时只留第一个 —— validate.mjs 会拦下这种素材，
     这里不报错只是为了不让地图渲染炸掉。 */
  function index(room) {
    var map = {};
    if (!room) return map;
    var list = G.data.events || [];
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      if (!alive(ev)) continue;
      var at = ev.at || [];
      for (var j = 0; j < at.length; j++) {
        if (at[j].room !== room.id) continue;
        var k = at[j].x + ',' + at[j].y;
        if (!map[k]) map[k] = ev;
      }
    }
    return map;
  }

  /* 站在这一格上的事件点，没有返回 null */
  function at(room, x, y) {
    return index(room)[x + ',' + y] || null;
  }

  /* ---------- 触发 ---------- */

  /* 触发一次。kind 是 'step'（走上去）或 'use'（动手）。

     返回 { ok, events }：
       ok      真的触发了。**没触发有三种情况**：
               事件点不存在 / 已经用掉了 / 这种触发方式它没写回调
               （拿 'use' 去点一个纯 onCollide 的东西）
       events  要写进记事的行，[{ text, cls }]

     内部顺序：先记次数，再跑效果。

     效果本身交给 G.effects.run() —— **那七个键只有那个模块认识**。
     这里不再自己 for 一遍 log / set：物品的 use 跑的也是同一套效果，
     两处各写一份的话，以后加个新键就得记得改两个地方。 */
  function fire(ev, kind) {
    var out = { ok: false, events: [] };
    if (!ev || !alive(ev)) return out;

    /* 触发方式完全由"写了哪个回调"决定，不看任何类型字段 */
    var list = (kind === KIND_STEP) ? ev.onCollide : ev.onUse;
    if (!list || !list.length) return out;

    out.ok = true;
    bump(ev.id);
    out.events = G.effects.run(list).events;
    return out;
  }

  return {
    STEP: KIND_STEP,
    USE: KIND_USE,

    once: onceOf,
    hidden: hiddenOf,
    alive: alive,
    revealed: revealed,

    index: index,
    at: at,
    times: timesOf,
    fire: fire
  };

})();
