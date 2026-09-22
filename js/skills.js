/* 魔鱼世界 · 技能
   全局：G.skills

   技能是角色**拥有**的东西，定义在 data/skills.js。
   这里只管"查"和"用"，不碰界面 —— 记事由调用方写。

   被动技能：拥有就生效，修正算"角色固有"那一段（**吃生命惩罚**）。
   主动技能：用一次、挂一个状态，修正在状态里（**不吃惩罚**）。

   见 docs/设定/06-物品与技能.md。 */

var G = window.G || (window.G = {});

G.skills = (function () {

  /* 角色拥有的技能对象数组，按存档里的顺序。

     指向已删技能的 id **直接跳过**，不报错 —— 技能临时下线再加回来时，
     存档里的记录还在，不该因为查不到就炸掉。这跟任务的处理是一个思路。 */
  function owned() {
    var p = G.state.player();
    var ids = (p && p.skills) || [];
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var s = G.data.skill(ids[i]);
      if (s) out.push(s);
    }
    return out;
  }

  function byKind(kind) {
    var list = owned(), out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === kind) out.push(list[i]);
    }
    return out;
  }

  /* 所有被动技能的修正项，拼成一个大数组。
     G.rules.collectMods 会把同属性的加值 / 百分比分别相加。 */
  function passiveMods() {
    var list = byKind('passive');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i].mods || [];
      for (var j = 0; j < m.length; j++) out.push(m[j]);
    }
    return out;
  }

  function has(id) {
    var p = G.state.player();
    var ids = (p && p.skills) || [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === id) return true;
    }
    return false;
  }

  /* 给角色一个技能。已经有了就不重复加。
     还没有获取途径（掉落 / 任务 / 学习都没做），先把接口留在这儿。 */
  function learn(id) {
    var p = G.state.player();
    if (!p || !G.data.skill(id) || has(id)) return false;
    if (!p.skills) p.skills = [];
    p.skills.push(id);
    return true;
  }

  /* 用一个主动技能：检查能不能用，然后挂上它对应的状态。
     返回 { ok, skill, status, refreshed } 或 { ok: false, reason }。

     **被动技能不能"用"** —— 它一直生效着，没有可用的动作。
     失败原因交给调用方去写记事，这里不碰界面。 */
  function use(id) {
    var s = G.data.skill(id);
    if (!s) return { ok: false, reason: 'no-skill' };
    if (!has(id)) return { ok: false, reason: 'not-owned' };
    if (s.kind !== 'active') return { ok: false, reason: 'not-active' };

    var st = G.data.status(s.applies);
    if (!st) return { ok: false, reason: 'no-status' };

    var added = G.statuses.add(st.id);
    return { ok: true, skill: s, status: st, refreshed: !added };
  }

  return {
    owned: owned,
    byKind: byKind,
    passive: function () { return byKind('passive'); },
    active: function () { return byKind('active'); },
    passiveMods: passiveMods,
    has: has,
    learn: learn,
    use: use
  };

})();
