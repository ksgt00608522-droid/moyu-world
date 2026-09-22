/* 魔鱼世界 · 数据容器
   全局：G.data

   这个文件必须最先加载，data/*.js 都往 G.data 上挂东西。 */

var G = window.G || (window.G = {});

/* 按 id 在一张表里找，找不到返回 null。表都是数组，元素都带 id 字段。 */
function byId(list, id) {
  if (!list) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/* 四邻的偏移，顺序是上下左右 —— 跟 G.world 的方向词一致。
   列在这里而不是各处自己写，免得哪个地方顺序写反了没人发现。 */
var NEAR4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

G.data = {

  strings: {},
  areas: [],            /* 区域表，见 data/areas.js */
  rooms: [],            /* 房间表，由 data/rooms/*.js 各自 push 进来 */
  npcTypes: [],         /* NPC 类型表，见 data/npcs.js */
  attitudeStages: [],   /* 态度阶段表，见 data/npcs.js */
  npcs: [],             /* NPC 表，见 data/npcs.js */
  quests: [],           /* 任务表，见 data/quests.js */
  itemKinds: [],        /* 物品分类表，见 data/items.js */
  moneyTypes: [],       /* 币种表，见 data/items.js */
  items: [],            /* 物品表，见 data/items.js */
  eventTypes: [],       /* 事件点类型表，见 data/events.js */
  events: [],           /* 事件点表，见 data/events.js */
  skills: [],           /* 技能表，见 data/skills.js */
  statuses: [],         /* 状态表，见 data/statuses.js */

  /* ---------- 按 id 查询 ---------- */

  room: function (id) { return byId(G.data.rooms, id); },
  area: function (id) { return byId(G.data.areas, id); },
  npc: function (id) { return byId(G.data.npcs, id); },
  npcType: function (id) { return byId(G.data.npcTypes, id); },
  quest: function (id) { return byId(G.data.quests, id); },
  item: function (id) { return byId(G.data.items, id); },
  itemKind: function (id) { return byId(G.data.itemKinds, id); },
  moneyType: function (id) { return byId(G.data.moneyTypes, id); },
  event: function (id) { return byId(G.data.events, id); },
  eventType: function (id) { return byId(G.data.eventTypes, id); },
  skill: function (id) { return byId(G.data.skills, id); },
  status: function (id) { return byId(G.data.statuses, id); },

  /* 房间属于哪个区域。房间没写 area、或 area 指向一个不存在的区域，
     都返回 null —— 这两种情况 validate.mjs 会拦下来，运行时只是不显示而已。 */
  areaOf: function (room) {
    return G.data.area(room && room.area);
  },

  /* ---------- 文案 ---------- */

  /* 取文案：G.data.t('save.ok')
     支持占位符：G.data.t('door.here', { name: '北面的铁门' })
     找不到就把 key 原样返回，方便发现漏写。 */
  t: function (key, vars) {
    var s = G.data.strings[key];
    if (s == null) return key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          s = s.split('{' + k + '}').join(vars[k]);
        }
      }
    }
    return s;
  },

  /* ---------- 地图格子 ---------- */

  /* 房间里的门，没有返回 null。键是 "x,y" */
  doorAt: function (room, x, y) {
    if (!room || !room.doors) return null;
    return room.doors[x + ',' + y] || null;
  },

  /* 这个格子能不能站人。门可以站，墙不行，越界不行，**站了人的也不行**。

     NPC 挡路：它占的那一格过不去，玩家只能走到旁边再跟它说话
     （见 npcsNear 与 js/talk.js）。

     **事件点不算障碍。** 这是它跟 NPC 最本质的区别 —— 玩家必须能走上去，
     踩上去才会触发（见 js/events.js）。所以这里只查 npcIndex，
     永远不要顺手把 eventIndex 也加进来。

     npcIdx 是可选的第 4 个参数，给调用方传已经建好的索引。
     渲染地图时四邻都要问一遍，而索引本来就已经建了，不传就会白建四次。
     不传也能用 —— 别的调用方（比如 move）没必要关心 NPC 索引。 */
  walkable: function (room, x, y, npcIdx) {
    if (!room) return false;
    if (y < 0 || y >= room.tiles.length) return false;
    var row = room.tiles[y];
    if (x < 0 || x >= row.length) return false;

    var people = npcIdx || G.data.npcIndex(room);
    if (people[x + ',' + y]) return false;

    if (G.data.doorAt(room, x, y)) return true;
    return row.charAt(x) !== '#';
  },

  /* ---------- NPC 位置 ---------- */

  /* 一个房间里的 NPC 位置索引：{ "x,y": npc }。
     渲染地图时先建一次，免得每个格子都遍历一遍 NPC 表。

     同一格站了多个 NPC 时只留第一个 —— validate.mjs 会拦下这种素材，
     这里不报错只是为了不让地图渲染炸掉。 */
  npcIndex: function (room) {
    var map = {};
    if (!room) return map;
    var list = G.data.npcs;
    for (var i = 0; i < list.length; i++) {
      var at = list[i].at || [];
      for (var j = 0; j < at.length; j++) {
        if (at[j].room !== room.id) continue;
        var k = at[j].x + ',' + at[j].y;
        if (!map[k]) map[k] = list[i];
      }
    }
    return map;
  },

  /* 站在这个格子上的 NPC，没有返回 null */
  npcsAt: function (room, x, y) {
    return G.data.npcIndex(room)[x + ',' + y] || null;
  },

  /* 四邻里站着的人，按上下左右的顺序，没有就是空数组。

     **NPC 挡路之后，人就只可能在旁边、不可能在脚下了** ——
     所以「旁边的人」这一块和上面的对话按钮都是从这个列表画出来的。
     不传 npcIdx 就自己建一个索引。 */
  npcsNear: function (room, x, y, npcIdx) {
    var people = npcIdx || G.data.npcIndex(room);
    var out = [];
    for (var i = 0; i < NEAR4.length; i++) {
      var n = people[(x + NEAR4[i][0]) + ',' + (y + NEAR4[i][1])];
      if (n) out.push(n);
    }
    return out;
  },

  /* 这个房间里出现过哪些 NPC（同一个 NPC 出现多处只算一个）。
     进房间时提一句用。 */
  npcsIn: function (room) {
    if (!room) return [];
    var idx = G.data.npcIndex(room);
    var seen = {}, out = [];
    for (var k in idx) {
      if (!Object.prototype.hasOwnProperty.call(idx, k)) continue;
      if (seen[idx[k].id]) continue;
      seen[idx[k].id] = 1;
      out.push(idx[k]);
    }
    return out;
  }

};
