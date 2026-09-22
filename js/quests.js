/* 魔鱼世界 · 任务进度
   全局：G.quests

   任务**定义**在 data/quests.js，这个模块只管"接没接、做到哪一步了"。

   进度不缓存在模块里，每次现读现写 G.state.data.quests ——
   状态只有一份，不存在"内存和存档对不上"的问题。

   ------------------------------------------------------------------
   三个状态
   ------------------------------------------------------------------
     available  可接（还没接）
     active     已接，进行中
     done       已交付（不可重复任务的终态）

   **"没有记录" = available。** 所以旧存档（连 quests 字段都没有的）读进来，
   所有任务都直接是"可接"，不用迁移数据。

   "目标达成、等玩家去交差"不单独占一个状态 —— 它是 active 的派生结果：
   progress 到了 goal.count 就是待交付（isReady()）。少一个状态少一处不同步。

   ------------------------------------------------------------------
   接取制
   ------------------------------------------------------------------
   **没接的任务不推进进度。** add() 只认 active 的任务 ——
   这就是"未接收不可执行"。

   ------------------------------------------------------------------
   任务链
   ------------------------------------------------------------------
   任务的 `requires` 指向前一个任务。**前置没交付，这个任务完全不出现** ——
   不是"显示了但灰着"，是根本不在 ofNpc() 的返回里，
   所以 NPC 的对话选项里也看不到它。

   判定用的是 `times > 0`（交过差），**不是 state === 'done'** ——
   可重复任务交付后立刻回到 available，永远到不了 done，
   按 done 判的话它当不了任何任务的前置。

   ------------------------------------------------------------------
   任务与 NPC 不是绑定关系
   ------------------------------------------------------------------
   NPC 身上没有任务字段。是**任务自己**声明 `giver`（挂在谁身上）
   和 `room`（只在哪个房间出现），由 ofNpc() 现算 ——
   所以同一个任务换个人发布，只改 quests.js 一行，不用动 NPC 素材。

   谁推进进度：G.world 每走一步调一次 G.quests.add('walk', 1)。
   以后战斗加进来，击杀走同一个入口（add('kill', 1)），不用改这个文件。

   ------------------------------------------------------------------
   两种推进方式
   ------------------------------------------------------------------
     add(type, n)   按**目标类型**推进所有匹配的任务 ——
                    "走了/杀了/捡了"这类不挑地方的目标用它
     reach(evId)    按**指定的事件点**推进 —— 走到某个事件点上
     use(evId)      同上，但是"跟它互动"（喝水 / 捡起）

   为什么要分开：add() 只需要知道"走了"，而"走到某个特定事件点上"
   必须知道是哪一个。硬塞进 add() 就得给它加可选参数、还得在里面判断
   有没有传，反而更难读。

   两个入口都**只推进已经接取的任务**（未接收不可执行），
   也都返回"这一次刚刚达成目标"的任务数组，跟 add() 一致。

   ------------------------------------------------------------------
   collect：收集类目标**不用推进**，现算
   ------------------------------------------------------------------
   walk / reach / use 是"累计推进"，collect 不是 —— 它的进度就是
   "现在身上有几个那个物品"（progressOf 里现算 G.items.count）。

   好处：捡到又用掉之后它自己会变回未达成，不会出现"显示能交、交不了"。
   代价：**它没有"这一次刚刚达成"这个事件**，所以不会像走路那样
   中途报一句"任务目标达成" —— 只有交付时才知道。

   交付时按 goal.count 扣掉，见 deliver()。

   ------------------------------------------------------------------
   奖励
   ------------------------------------------------------------------
   deliver() 会发 reward 并返回那一行记事。顺序是
   **扣物品 -> 记次数 -> 改状态 -> 发奖励**，一步都不能换，
   理由写在 deliver() 上面。 */

var G = window.G || (window.G = {});

G.quests = (function () {

  var AVAILABLE = 'available';
  var ACTIVE = 'active';
  var DONE = 'done';

  /* 存档里那一条记录，没有返回 null。只读，不改状态 ——
     UI 每次刷新都会问一遍，查询不该有副作用。 */
  function entry(id) {
    var st = G.state.data;
    if (!st || !st.quests) return null;
    return st.quests[id] || null;
  }

  /* 存档里那一条记录，没有就现建一条（会写进状态）。
     只有 accept / add 用得上 —— 光查不推进的地方走 state() / progress()。 */
  function ensure(id) {
    var st = G.state.data;
    if (!st.quests) st.quests = {};
    if (!st.quests[id]) st.quests[id] = { state: AVAILABLE, progress: 0, times: 0 };
    return st.quests[id];
  }

  /* 没记录 = 还没接过 = available */
  function stateOf(id) {
    var e = entry(id);
    return e ? e.state : AVAILABLE;
  }

  /* 做到哪一步了。

     **collect 是现算的，不读存档里的 progress** —— 进度就是"现在身上有几个"。
     不能累计：那样"捡到 3 个 -> 用掉 1 个"之后进度还停在 3 / 3，
     玩家会以为可以交差，交付时却发现东西不够。

     所以 collect 任务的 progress 字段是**不用的**（写了也没人看）。 */
  function progressOf(id) {
    var q = G.data.quest(id);
    var goal = (q && q.goal) || {};
    if (goal.type === 'collect') return G.items.count(goal.item);

    var e = entry(id);
    return e ? (Number(e.progress) || 0) : 0;
  }

  /* 交付过几次。可重复任务用它记完成次数，不可重复任务交过一次就是 1。 */
  function timesOf(id) {
    var e = entry(id);
    return e ? (Number(e.times) || 0) : 0;
  }

  function isDone(id) {
    return stateOf(id) === DONE;
  }

  /* 已接、且目标已经达成 —— 等玩家去找人交差。

     **collect 的进度是现算的**（见 progressOf），所以这条不用分情况：
     "捡到又用掉"之后它会自己变回未达成，不会出现"显示能交、交不了"。 */
  function isReady(id) {
    if (stateOf(id) !== ACTIVE) return false;
    var q = G.data.quest(id);
    if (!q) return false;
    return progressOf(id) >= (Number((q.goal || {}).count) || 0);
  }

  /* 前置任务**交过差**没有。没写 requires 就算满足。

     ⚠️ 判据是 `times > 0`，**不是 `state === 'done'`** ——
     可重复任务交付后 state 立刻回到 available，永远到不了 done，
     按 done 判的话 requires 指向一个可重复任务就**永远不满足**，
     后面那个任务一辈子挂不出来。见 docs/设定/09-NPC与任务.md。 */
  function unlocked(q) {
    if (!q || !q.requires) return true;
    return timesOf(q.requires) > 0;
  }

  /* 这个 NPC 此刻身上有哪些任务。
     由任务自己的 giver / room 决定，不是 NPC 上挂的 ——
     这就是"任务与 NPC 非绑定"。

     room 填了的话，只有站在那个房间里的这个 NPC 才拿出这个任务；
     NPC 会出现在多个房间时（at 是多条），靠这个字段分开。 */
  function ofNpc(npc, room) {
    var out = [];
    if (!npc) return out;
    var list = G.data.quests || [];
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (q.giver !== npc.id) continue;
      if (q.room && q.room !== (room && room.id)) continue;
      if (!unlocked(q)) continue;   /* 前置没交付 → 完全不出现 */
      out.push(q);
    }
    return out;
  }

  /* 这个 NPC 身上还有没有"现在就能做的动作"：有可接的、或者有能交的。
     地图格右上角的角标问的就是这个。

     注意：可重复任务交付后立刻回到 available，所以这类 NPC 的角标会常亮 ——
     语义上没错（"这人永远有活给你"），但确实会一直占着一个角标。
     要不要改成只标"可交"的，见 99-待定问题.md。 */
  function npcBusy(npc, room) {
    var list = ofNpc(npc, room);
    for (var i = 0; i < list.length; i++) {
      if (stateOf(list[i].id) === AVAILABLE) return true;
      if (isReady(list[i].id)) return true;
    }
    return false;
  }

  /* 接任务。只有 available 且前置已交付才能接。
     接的时候进度清零 —— 可重复任务第二次接也是从零开始。 */
  function accept(id) {
    var q = G.data.quest(id);
    if (!q) return false;
    if (stateOf(id) !== AVAILABLE) return false;
    if (!unlocked(q)) return false;

    var e = ensure(id);
    e.state = ACTIVE;
    e.progress = 0;
    return true;
  }

  /* ---------- 奖励 ----------

     奖励**没有 log 字段**（见 data/quests.js），那一行由系统生成 ——
     素材不用管，也就不会出现"素材忘了写 log，玩家不知道拿到了什么"。

     返回要写进记事的行。什么都没有（没写 reward，或者引用的东西都不存在）
     就返回空数组，调用方什么都不用补。 */
  function grantReward(q) {
    var rw = q && q.reward;
    if (!rw) return [];

    var parts = [], k, n, def;

    if (rw.money) {
      for (k in rw.money) {
        if (!Object.prototype.hasOwnProperty.call(rw.money, k)) continue;
        n = Math.floor(Number(rw.money[k]));
        def = G.data.moneyType(k);
        if (!def || !(n > 0)) continue;
        G.items.addMoney(k, n);
        parts.push(G.data.t('money.amount', { name: def.name, n: n }));
      }
    }

    if (rw.items) {
      for (k in rw.items) {
        if (!Object.prototype.hasOwnProperty.call(rw.items, k)) continue;
        n = Math.floor(Number(rw.items[k]));
        def = G.data.item(k);
        if (!def || !(n > 0)) continue;
        var got = G.items.give(k, n);          /* 唯一物品已经有了会给 0 */
        if (got > 0) parts.push(G.data.t('item.amount.n', { name: def.name, n: got }));
      }
    }

    if (!parts.length) return [];
    return [{ text: G.data.t('quest.reward', { list: parts.join('、') }), cls: 'ok' }];
  }

  /* 交任务。只有"已接 + 目标达成"才能交。

     顺序是**扣物品 -> 记次数 -> 改状态 -> 发奖励**，一条都不能换：
       - collect 先扣物品：反过来的话玩家能靠"先拿奖励再退货"刷东西
       - 扣不够就直接失败，**不进入后半段** —— 交付是原子的，
         不会出现"东西没了但任务没交"

     返回 { ok, events }：events 是奖励那一行，调用方接着往下写。
     可重复的：交完立刻回到 available，进度清零，只把次数留在存档里。
     不可重复的：进 done，从此不再出现。 */
  function deliver(id) {
    var q = G.data.quest(id);
    if (!q || !isReady(id)) return { ok: false, events: [] };

    var goal = q.goal || {};

    if (goal.type === 'collect') {
      if (G.items.count(goal.item) < goal.count) return { ok: false, events: [] };
      G.items.take(goal.item, goal.count);
    }

    var e = entry(id);
    e.times = (Number(e.times) || 0) + 1;

    if (q.repeatable) {
      e.state = AVAILABLE;
      e.progress = 0;
    } else {
      e.state = DONE;
    }

    return { ok: true, events: grantReward(q) };
  }

  /* 推进所有 goal.type === type 且**已经接取**的任务。
     返回**这一次刚刚达成目标**的任务数组，调用方拿去打日志。

     注意返回的是"目标达成"不是"任务完成" —— 还要去找人交差才算完。 */
  function add(type, n) {
    var ready = [];
    if (!G.state.data) return ready;

    var step = Number(n) || 0;
    var list = G.data.quests || [];

    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var goal = q.goal || {};
      if (goal.type !== type) continue;
      if (stateOf(q.id) !== ACTIVE) continue;   /* 没接的不算 —— 未接收不可执行 */

      var e = ensure(q.id);
      var need = Number(goal.count) || 0;
      var before = Number(e.progress) || 0;
      var wasReady = before >= need;

      e.progress = Math.min(before + step, need);

      /* 只在"刚好跨过门槛"这一次报一次，不然每走一步都会说一遍 */
      if (!wasReady && e.progress >= need) ready.push(q);
    }
    return ready;
  }

  /* ---------- 指定事件点的目标 ----------

     add() 是"按目标类型推进所有匹配的任务"，这里是"按**指定的事件点**推进" ——
     只有 goal.ev 是这个 id 的任务才算。

     为什么不能并进 add()：add() 只需要知道"走了/杀了/捡了"，而"走到某个
     特定事件点上"必须知道是哪一个。硬塞进去就得给 add() 加一个可选参数，
     还得在里面判断有没有传，反而更难读。

     n === null 表示**直接置满** —— 一个事件点不存在"走到一半"这种事，
     所以 reach 用它；use 是步进 1（可重复互动的事件点，任务可能要"用三次"）。

     跟 add() 一样：**没接的任务不推进**（未接收不可执行），
     返回**这一次刚刚达成目标**的任务数组。 */
  function hitEv(type, evId, n) {
    var ready = [];
    if (!G.state.data) return ready;
    if (!evId) return ready;

    var list = G.data.quests || [];
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var goal = q.goal || {};
      if (goal.type !== type) continue;
      if (goal.ev !== evId) continue;
      if (stateOf(q.id) !== ACTIVE) continue;   /* 没接的不算 */

      var e = ensure(q.id);
      var need = Number(goal.count) || 0;
      var before = Number(e.progress) || 0;
      var wasReady = before >= need;

      e.progress = (n == null) ? need : Math.min(before + n, need);

      /* 只在"刚好跨过门槛"这一次报一次 */
      if (!wasReady && e.progress >= need) ready.push(q);
    }
    return ready;
  }

  /* 走到指定的事件点上。 */
  function reach(evId) { return hitEv('reach', evId, null); }

  /* 跟指定的事件点互动（喝水 / 捡起）。 */
  function use(evId) { return hitEv('use', evId, 1); }

  return {
    AVAILABLE: AVAILABLE,
    ACTIVE: ACTIVE,
    DONE: DONE,

    state: stateOf,
    progress: progressOf,
    times: timesOf,
    isDone: isDone,
    isReady: isReady,
    unlocked: unlocked,

    ofNpc: ofNpc,
    npcBusy: npcBusy,

    accept: accept,
    deliver: deliver,
    add: add,
    reach: reach,
    use: use,
    ensure: ensure
  };

})();
