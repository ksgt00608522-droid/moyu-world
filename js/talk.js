/* 魔鱼世界 · 对话
   全局：G.talk

   只管一件事：**此刻正在跟谁说话、他说了什么、能选什么**。

   ------------------------------------------------------------------
   为什么不碰 DOM
   ------------------------------------------------------------------
   ui.js 要读对话状态来画面板（ui → talk），所以 talk **不能反向调 ui** ——
   否则两个模块成环，违反"依赖方向严格单向"。

   按项目的做法：talk 只**产出事件列表**，谁调用谁负责拿去写记事和刷新
   （现在调用方是 main.js 的 runTalk）。

   ------------------------------------------------------------------
   为什么要有这个模块
   ------------------------------------------------------------------
   对话是一份"当前状态"，不是某一帧算出来的东西 ——
   台词要随机挑一句，但**不能每次刷新面板都重挑**（renderTile 一刷新就跑一遍，
   台词会疯闪）。所以挑中的那一句必须存下来，存在这里。

   这份状态**不进存档**：它是瞬时的，关掉游戏再打开不该还在跟人说话。

   ------------------------------------------------------------------
   走开就自动结束
   ------------------------------------------------------------------
   走一步就调一次 drop()（见 js/world.js 的 move）。另外 current() 也会现算
   "那个人还在我旁边吗"，双保险 —— 就算哪条路忘了 drop，面板也不会画出
   一个已经走远的人。

   ------------------------------------------------------------------
   对话是一串选项
   ------------------------------------------------------------------
   options() 返回这次对话能选什么：普通对话一项，**每个任务一项**。
   同一个 NPC 身上可以同时有普通对话、可接的任务、能交的任务 ——
   它们并列成一排按钮，各点各的。

   任务从哪来：G.quests.ofNpc(npc, room)。NPC 自己不记任务，
   是任务声明了 giver / room（见 data/quests.js）。 */

var G = window.G || (window.G = {});

G.talk = (function () {

  var npcId = null;   /* 正在跟谁说话，没在说话就是 null */
  var line = '';      /* 他刚说的那一句。存下来，别每次渲染都重挑 */

  function ev(text, cls) { return { text: text, cls: cls }; }

  /* 随便挑一句台词。走 G.rng，读档后不会靠反复对话刷出不同结果。 */
  function pick(npc) {
    var lines = (npc && npc.talk) || [];
    if (!lines.length) return G.data.t('talk.silent');
    return G.rng.pick(lines);
  }

  /* 此刻还能不能继续这段对话。返回那个 NPC，不在旁边就返回 null。
     **现算**，所以走开之后自然就断了。 */
  function current() {
    if (!npcId) return null;
    var st = G.state.data;
    var room = G.state.room();
    if (!st || !room) return null;

    var near = G.data.npcsNear(room, st.world.x, st.world.y);
    for (var i = 0; i < near.length; i++) {
      if (near[i].id === npcId) return near[i];
    }
    return null;
  }

  /* 清掉对话状态，不产生事件也不刷新。走路时调它 ——
     人走开了，对话就该断，不用等玩家按「结束对话」。 */
  function drop() {
    npcId = null;
    line = '';
  }

  /* 开始说话。npc 可以传对象、也可以传 id。
     不传的时候：旁边只有一个人就直接跟他说，有多个就让他自己选。 */
  function start(npc) {
    var st = G.state.data;
    var room = G.state.room();
    if (!st || !room) return { ok: false, events: [] };

    var target = null;
    if (npc && typeof npc === 'object') target = npc;
    else if (npc) target = G.data.npc(npc);

    if (!target) {
      var near = G.data.npcsNear(room, st.world.x, st.world.y);
      if (!near.length) {
        return { ok: false, events: [ev(G.data.t('talk.nobody'), 'warn')] };
      }
      if (near.length > 1) {
        var names = [];
        for (var i = 0; i < near.length; i++) names.push(near[i].name);
        return { ok: false, events: [ev(G.data.t('talk.which', { names: names.join('、') }), 'warn')] };
      }
      target = near[0];
    }

    npcId = target.id;
    line = pick(target);
    return { ok: true, events: [ev(G.data.t('talk.line', { name: target.name, line: line }), 'info')] };
  }

  /* 换一句普通台词 —— 对话面板里的「随便聊聊」 */
  function chat() {
    var npc = current();
    if (!npc) { drop(); return { ok: false, events: [] }; }

    line = pick(npc);
    return { ok: true, events: [ev(G.data.t('talk.line', { name: npc.name, line: line }), 'info')] };
  }

  /* 结束对话 */
  function stop() {
    var had = !!npcId;
    drop();
    return { ok: had, events: [] };
  }

  function lineOf() {
    return line;
  }

  /* 这次对话能选什么。返回 [{ kind, label, questId }]
     kind：'chat' 普通对话 / 'accept' 接任务 / 'deliver' 交任务

     一个任务就是一个选项；普通对话也是一个选项。
     进行中但没达成的任务**不给选项**（此刻没什么可做的），
     它只在面板上作为一行进度信息显示。 */
  function options() {
    var npc = current();
    var out = [];
    if (!npc) return out;

    out.push({ kind: 'chat', label: G.data.t('talk.opt.chat') });

    var list = G.quests.ofNpc(npc, G.state.room());
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (G.quests.state(q.id) === G.quests.AVAILABLE) {
        out.push({ kind: 'accept', questId: q.id,
                   label: G.data.t('talk.opt.accept', { name: q.name }) });
      } else if (G.quests.isReady(q.id)) {
        out.push({ kind: 'deliver', questId: q.id,
                   label: G.data.t('talk.opt.deliver', { name: q.name }) });
      }
    }
    return out;
  }

  /* 选一个选项。kind + questId 由 ui 画在按钮上，点回来落到这里。 */
  function choose(kind, questId) {
    var npc = current();
    if (!npc) { drop(); return { ok: false, events: [] }; }

    if (kind === 'chat') return chat();

    var q = G.data.quest(questId);
    if (!q) return { ok: false, events: [] };

    if (kind === 'accept') {
      if (!G.quests.accept(questId)) return { ok: false, events: [] };
      line = q.offer || G.data.t('talk.offer', { name: q.name });
      G.save.auto();
      return { ok: true, events: [
        ev(G.data.t('talk.line', { name: npc.name, line: line }), 'info'),
        ev(G.data.t('quest.accept', { name: q.name }), 'ok')
      ] };
    }

    if (kind === 'deliver') {
      /* deliver 现在返回 { ok, events } —— events 是奖励那一行。
         奖励没有 log 字段（见 data/quests.js），那一行是 G.quests 生成的。 */
      var got = G.quests.deliver(questId);
      if (!got.ok) return { ok: false, events: [] };
      line = q.turnin || G.data.t('talk.turnin', { name: q.name });

      var events = [
        ev(G.data.t('talk.line', { name: npc.name, line: line }), 'info'),
        ev(G.data.t('quest.deliver', { name: q.name }), 'ok')
      ];
      for (var i = 0; i < got.events.length; i++) events.push(got.events[i]);

      /* 可重复任务交完还能再接，说一声免得玩家以为出 bug 了 */
      if (q.repeatable) {
        events.push(ev(G.data.t('quest.repeat', { name: q.name, times: G.quests.times(q.id) }), 'sys'));
      }
      G.save.auto();
      return { ok: true, events: events };
    }

    return { ok: false, events: [] };
  }

  return {
    start: start,
    stop: stop,
    drop: drop,
    chat: chat,
    choose: choose,
    options: options,
    current: current,
    line: lineOf
  };

})();
