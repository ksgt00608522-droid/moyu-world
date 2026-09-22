/* 魔鱼世界 · 世界与移动
   全局：G.world

   只管房间、坐标、门。不碰 DOM，只调用 G.ui 输出文字。
   以后加遭遇与事件也放这里。 */

var G = window.G || (window.G = {});

G.world = (function () {

  /* 网页上是二维的，一律用上下左右，不用东西南北 */
  function dirName(dx, dy) {
    if (dy < 0) return G.data.t('dir.up');
    if (dy > 0) return G.data.t('dir.down');
    if (dx > 0) return G.data.t('dir.right');
    return G.data.t('dir.left');
  }

  /* 描述当前（或指定）房间 */
  function describe(room) {
    room = room || G.state.room();
    if (!room) return;

    G.ui.log(G.data.t('room.enter', { name: room.name, desc: room.desc }), 'title');

    var st = G.state.data;
    var here = G.data.doorAt(room, st.world.x, st.world.y);
    if (here) {
      G.ui.log(G.data.t('door.here', { name: here.name }), 'info');
    }

    /* 屋里有人就提一句。不说在哪个位置 —— 那属于"看一眼地图"的事，
       写进日志反而要玩家自己对照坐标。 */
    var npcs = G.data.npcsIn(room);
    if (npcs.length) {
      var names = [];
      for (var i = 0; i < npcs.length; i++) names.push(npcs[i].name);
      G.ui.log(G.data.t('npc.here', { names: names.join('、') }), 'info');
    }
  }

  /* 走一步 */
  function move(dx, dy) {
    var st = G.state.data;
    var room = G.state.room();
    if (!st || !room) return;

    var nx = st.world.x + dx;
    var ny = st.world.y + dy;

    if (!G.data.walkable(room, nx, ny)) {
      /* 走不过去有两种原因，说清楚是哪一种 —— NPC 挡路时说"那边是墙"
         会让玩家以为地图画错了。 */
      var who = G.data.npcsAt(room, nx, ny);
      G.ui.log(who ? G.data.t('move.blocked.npc', { name: who.name })
                   : G.data.t('move.blocked'), 'warn');
      return;
    }

    st.world.x = nx;
    st.world.y = ny;
    G.ui.log(G.data.t('move.ok', { dir: dirName(dx, dy) }), 'sys');

    /* 人走开了，对话就断了 —— 不用等玩家按「结束对话」 */
    G.talk.drop();

    var door = G.data.doorAt(room, nx, ny);
    if (door) {
      G.ui.log(G.data.t('door.here', { name: door.name }), 'info');
    }

    /* 踩到的东西。**排在走路任务前面** —— 踩到机关说一句，
       比"任务目标达成"更贴近刚发生的事（见 docs/设定/05-地图与探索.md）。

       事件点**不挡路**，所以走到这一格本来就是允许的；
       已经用掉的一次性事件点不在 G.events.at() 的返回里，不会再触发。
       走上去也会推进"走到某事件点"类的任务（跟互动是两回事，见 G.quests.reach）。 */
    var ev = G.events.at(room, nx, ny);
    if (ev) {
      var hit = G.events.fire(ev, G.events.STEP);
      for (var k = 0; k < hit.events.length; k++) {
        G.ui.log(hit.events[k].text, hit.events[k].cls);
      }
      /* 走到就算"到了"，**不管 fire 成没成功** ——
         只有 onUse 的东西（泉水）踩上去 fire 是失败的，但玩家确实走上去了，
         "走到某事件点"这种任务该算数。fire 的 ok 只表示"这次有没有触发效果"。 */
      logReady(G.quests.reach(ev.id));
    }

    /* 走一步推进"走路"类任务 —— 但只推进**已经接取**的任务（见 G.quests.add）。
       达成目标只是"可以交差了"，还要回去找发布的人交，所以这里说的是"达成"不是"完成"。
       以后击杀、收集也走 G.quests.add(...) 这个入口。 */
    logReady(G.quests.add('walk', 1));

    /* 走一步的后果之一：状态计时。**放在 refresh 之前** ——
       面板要画的是"走完这一步之后"的样子。 */
    tickStatuses();

    G.ui.refresh();
    G.save.auto();
  }

  /* 状态挂上 / 摘掉的记事。G.statuses 的 add 类接口返回这个形状。 */
  function logStatus(res) {
    var i, d;
    for (i = 0; i < (res.added || []).length; i++) {
      d = res.added[i];
      G.ui.log(G.data.t('status.gain', { name: d.name }),
               d.kind === 'debuff' ? 'warn' : 'ok');
    }
    for (i = 0; i < (res.removed || []).length; i++) {
      G.ui.log(G.data.t('status.lose', { name: res.removed[i].name }), 'info');
    }
  }

  /* 走一步之后的状态计时。
     **只有 unit 是 step 的状态会动** —— time 走真实秒数、
     manual 要人手动解、threshold 交给 syncEssence。

     生命 / 灵性被 tick 改过之后要再同步一次灵性阈值（枯竭 / 耗尽），
     所以这两个调用是绑在一起的，别拆开只留一个。 */
  function tickStatuses() {
    var res = G.statuses.tickStep();

    for (var i = 0; i < res.ticks.length; i++) {
      var t = res.ticks[i];
      G.ui.log(G.data.t('status.tick.' + t.key, {
        name: t.def.name,
        delta: (t.delta > 0 ? '+' : '') + t.delta
      }), t.delta < 0 ? 'warn' : 'ok');
    }

    logStatus({ removed: res.expired });
    logStatus(G.statuses.syncEssence());
  }

  /* 互动脚下的东西（use 指令，或者点位状态面板上那个按钮） */
  function useAt() {
    var st = G.state.data;
    var room = G.state.room();
    if (!st || !room) return;

    var ev = G.events.at(room, st.world.x, st.world.y);
    if (!ev) {
      G.ui.log(G.data.t('use.none'), 'warn');
      return;
    }

    var r = G.events.fire(ev, G.events.USE);

    /* 没触发有两种情况：已经用掉了（但 at() 已经滤过，走不到这里），
       或者这东西根本没写 onUse —— 它的动作是"走上去"，不是用手碰。
       这里说一句中性的话，**不暴露机制**：玩家不该从文案里
       读出"哦原来这个要用脚踩"。 */
    if (!r.ok) {
      G.ui.log(G.data.t('use.noop'), 'info');
      return;
    }

    for (var i = 0; i < r.events.length; i++) {
      G.ui.log(r.events[i].text, r.events[i].cls);
    }

    logReady(G.quests.use(ev.id));

    G.ui.refresh();
    G.save.auto();
  }

  /* 把"任务目标达成"的提示打出来。
     G.quests 的 add() / reach() / use() 都返回这个形状的数组。 */
  function logReady(list) {
    for (var i = 0; i < list.length; i++) {
      G.ui.log(G.data.t('quest.ready', { name: list[i].name }), 'ok');
    }
  }

  /* 进入脚下的门 */
  function enterDoor() {
    var st = G.state.data;
    var room = G.state.room();
    if (!st || !room) return;

    var door = G.data.doorAt(room, st.world.x, st.world.y);
    if (!door) {
      G.ui.log(G.data.t('door.none'), 'warn');
      return;
    }

    var target = G.data.room(door.to);
    if (!target) {
      G.ui.log(G.data.t('door.missing'), 'err');
      return;
    }

    var landing = door.back || target.spawn;

    st.world.roomId = target.id;
    st.world.x = landing.x;
    st.world.y = landing.y;
    st.world.visited[target.id] = true;

    G.ui.log(G.data.t('door.enter', { name: door.name }), 'sys');
    describe(target);
    G.ui.refresh();
    G.save.auto();
  }

  return {
    describe: describe,
    move: move,
    enterDoor: enterDoor,
    useAt: useAt,
    dirName: dirName
  };

})();
