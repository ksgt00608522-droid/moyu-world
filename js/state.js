/* 魔鱼世界 · 状态与存档结构
   全局：G.state

   状态是纯数据：不含函数、不含 DOM 引用，JSON.stringify 出来就是完整存档。
   加字段时必须同时考虑"旧存档读进来怎么办"，见 normalize()。 */

var G = window.G || (window.G = {});

G.state = (function () {

  /* v2：加了 quests 字段（任务进度）。v1 存档读进来补一个空对象即可，
     因为 G.quests 把"没有记录"当成"可接"。

     v3：任务从"一开始就自动进行"改成"要先接取"。**状态结构没变**
     （还是 { state, progress }），只是多了一个 times 字段、"没有记录"
     的含义从"进行中"变成"可接"。所以迁移不用动数据，只记一版：
     v2 存档里没有记录的任务，本来就只有玩家一步没走过的那些 ——
     正好对应"还没接"。见 data/quests.js 与 js/quests.js。

     v4：加了事件点的触发次数（events 字段）。同样是"没有记录 = 初始状态"，
     补个空对象即可。见 data/events.js 与 js/events.js。

     v5：**玩家状态整个换新**（见 docs/设定/04-数值与成长.md）。
     删掉等级 / 经验 / 攻防速 / 法力 / 金币，换成
     生命·灵性百分比 + 六项基础属性 + 神性 + 技能 + 状态。
     **这一版不做迁移**，v1–v4 的存档一律拒绝（原因见 migrate）。

     v6：加了**背包**（items）和**钱包**（wallet），见 docs/设定/06-物品与技能.md。
     纯新增两张表，别的字段一个都没动 —— 补两个空对象就能用，
     **v5 的存档照常读得进来**（跟 v5 那次"整个换掉"不一样）。
     见 data/items.js 与 js/items.js。 */
  var VERSION = 6;

  /* 建一份全新存档 */
  function create(name) {
    var seed = G.rng.newSeed();
    G.rng.setSeed(seed);

    var hall = G.data.room('room_hall');
    var data = {
      v: VERSION,
      createdAt: Date.now(),
      rng: G.rng.snapshot(),
      player: G.rules.newPlayer(name),
      world: {
        roomId: hall ? hall.id : '',
        x: hall ? hall.spawn.x : 0,
        y: hall ? hall.spawn.y : 0,
        visited: {},
        flags: {}
      },
      quests: {},  /* 任务 id -> { state, progress, times }。见 js/quests.js */
      events: {},  /* 事件点 id -> { times }。见 js/events.js */
      items:  {},  /* 物品 id -> { count }。见 js/items.js */
      wallet: {}   /* 币种 id -> 数量。见 js/items.js */
    };
    if (hall) data.world.visited[hall.id] = true;

    G.state.data = data;
    return data;
  }

  /* 把玩家对象补齐成当前结构。
     **先按新结构建一份，再用存档里的值逐字段覆盖** ——
     这样存档里缺的字段自然落到默认值上（以后加新属性，
     老存档读进来不会变成 undefined）。 */
  function normalizePlayer(raw) {
    var p = G.rules.newPlayer(raw && raw.name);
    if (!raw) return p;

    var num = function (v, d) {
      var n = Number(v);
      return isFinite(n) ? n : d;
    };

    if (raw.hp != null) p.hp = num(raw.hp, p.hp);
    if (raw.hpMax != null) p.hpMax = num(raw.hpMax, p.hpMax);
    if (raw.ess != null) p.ess = num(raw.ess, p.ess);
    if (raw.essMax != null) p.essMax = num(raw.essMax, p.essMax);
    if (raw[G.rules.DIV_KEY] != null) p[G.rules.DIV_KEY] = num(raw[G.rules.DIV_KEY], 0);

    if (raw.base) {
      for (var i = 0; i < G.rules.attrs.length; i++) {
        var k = G.rules.attrs[i].key;
        if (raw.base[k] != null) p.base[k] = num(raw.base[k], p.base[k]);
      }
    }

    if (raw.skills instanceof Array) p.skills = raw.skills.slice();
    if (raw.statuses instanceof Array) p.statuses = raw.statuses.slice();

    return p;
  }

  /* 把任意来源的数据补齐成当前版本的结构。
     旧存档缺字段、素材被改名导致房间不存在，都在这里兜住。 */
  function normalize(raw) {
    var hall = G.data.room('room_hall');

    var w = raw.world || {};
    var roomId = w.roomId || (hall ? hall.id : '');
    if (!G.data.room(roomId)) {
      roomId = hall ? hall.id : '';
      w.x = hall ? hall.spawn.x : 0;
      w.y = hall ? hall.spawn.y : 0;
    }

    return {
      v: VERSION,
      createdAt: Number(raw.createdAt) || Date.now(),
      rng: raw.rng || {},
      player: normalizePlayer(raw.player),
      world: {
        roomId: roomId,
        x: Number(w.x) || 0,
        y: Number(w.y) || 0,
        visited: w.visited || {},
        flags: w.flags || {}
      },
      /* 任务进度照搬。**故意不清理指向已删任务的记录** ——
         任务临时下线再加回来时，进度还在。多出来的键不占地方也不影响渲染。 */
      quests: raw.quests || {},

      /* 事件点触发次数，同样照搬。没有记录 = 一次都没触发过。 */
      events: raw.events || {},

      /* 背包与钱包，同样照搬。**"没有记录" = 没有这个东西 / 余额为 0**。
         故意不清理指向已删物品的记录 —— 物品临时下线再加回来时，数量还在
         （跟 quests 同一个理由）。多出来的键不占地方也不影响渲染。 */
      items:  raw.items  || {},
      wallet: raw.wallet || {}
    };
  }

  /* 版本迁移。以后每加一版就在下面追加一段，旧的不要删。 */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('存档内容不是一个对象');
    }
    var v = Number(raw.v) || 0;
    if (v > VERSION) {
      throw new Error('存档来自更新的版本（v' + v + '），当前程序只支持到 v' + VERSION);
    }

    /* v5 之前的存档**直接拒绝**。
       player 里除了 name，一个字段都对不上：lv / exp / expNext / mp /
       atk / def / spd / gold 全删了，hp 从"20 点"变成"100%"，
       语义都不一样。硬映射只会造出一份谁也说不清的档。

       只有自己的档，重开比写一段假的映射便宜，而且不会留下错误的数据。
       见 docs/设定/07-存档与状态.md 的「v5 为什么不迁移」。 */
    if (v < 5) {
      throw new Error('这份存档是 v' + v + '，玩家状态在这一版整个换过，不能沿用。请重开一局。');
    }

    /* 下面几段是历史迁移，留着记录改动点。v5 之后它们不会再被执行到
       （v < 5 在上面已经抛出去了），但别删 —— 以后回头查"哪一版改了什么"
       要能对得上。 */
    if (v < 2) { raw.quests = raw.quests || {}; }
    if (v < 4) { raw.events = raw.events || {}; }

    /* v5 → v6：加了背包（items）和钱包（wallet）。补两个空对象就行 ——
       "没有记录" = 没有这个东西 / 余额为 0，正好是想要的效果。

       **这一版不用拒绝旧档**：跟 v5 那次"把 player 整个换掉"不同，
       v6 是纯新增两张表，player / world / quests / events 一个字段都没动。
       能迁移就迁移，别动不动就让人重开。 */
    if (v < 6) {
      raw.items  = raw.items  || {};
      raw.wallet = raw.wallet || {};
    }

    return normalize(raw);
  }

  /* 把内存里的数据装进来，同时恢复随机流 */
  function load(data) {
    G.state.data = data;
    G.rng.restore(data.rng);
    return data;
  }

  return {
    VERSION: VERSION,
    data: null,

    create: create,
    load: load,
    normalize: normalize,
    migrate: migrate,

    isLoaded: function () {
      return !!G.state.data;
    },

    /* 导出成字符串。调用前先把随机游标同步进数据。 */
    toJSON: function () {
      if (G.state.data) G.state.data.rng = G.rng.snapshot();
      return JSON.stringify(G.state.data, null, 2);
    },

    fromJSON: function (text) {
      var raw = JSON.parse(text);
      return load(migrate(raw));
    },

    /* 常用查询 */
    room: function () {
      return G.state.data ? G.data.room(G.state.data.world.roomId) : null;
    },

    player: function () {
      return G.state.data ? G.state.data.player : null;
    }
  };

})();
