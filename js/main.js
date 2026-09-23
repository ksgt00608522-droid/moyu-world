/* 魔鱼世界 · 引导与指令分发
   全局：G.main

   指令表是唯一的事实来源：输入框、操作面板的按钮走的都是这张表，
   按钮只是替玩家打字。

   开局有两种可能：
     - 本地没有存档 → 显示创建角色页（独立一页，不走指令）
     - 本地有存档   → 直接进游戏 */

var G = window.G || (window.G = {});

G.main = (function () {

  /* ---------- 指令表 ---------- */

  var CMDS = [
    /* 移动四个方向 quiet：按钮和键盘触发的都不回显，不然走一步刷两行，
       日志全被 "> up" 占满。手打指令时仍然回显，见 submit。 */
    { name: 'up',     alias: ['上', 'w'], btn: '↑', group: '移动', desc: '向上移动一格', quiet: true,
      needsState: true, run: function () { G.world.move(0, -1); } },
    { name: 'down',   alias: ['下', 's'], btn: '↓', group: '移动', desc: '向下移动一格', quiet: true,
      needsState: true, run: function () { G.world.move(0, 1); } },
    { name: 'left',   alias: ['左', 'a'], btn: '←', group: '移动', desc: '向左移动一格', quiet: true,
      needsState: true, run: function () { G.world.move(-1, 0); } },
    { name: 'right',  alias: ['右', 'd'], btn: '→', group: '移动', desc: '向右移动一格', quiet: true,
      needsState: true, run: function () { G.world.move(1, 0); } },

    { name: 'enter',  alias: ['进入'], group: '行动', desc: '站在门上时进入该门',
      /* 故意不给 btn：进入是门自己的动作，只有站在门格上才成立。
         按钮由地图点位状态面板在"脚下是门"时临时画出来（见 ui.js 的 renderTile）。
         不给它通用按钮，就不会出现"没站在门上却点得动进入"的尴尬。 */
      needsState: true, run: function () { G.world.enterDoor(); } },

    { name: 'talk',   alias: ['对话', '说话'], group: '行动', quiet: true,
      desc: '跟旁边的人说话。对话里的选项：闲聊 / 接受任务 / 交付任务 / 结束',
      /* 同样不给 btn：说话是 NPC 自己的动作，只有站在他旁边才成立。
         一级区（地图点位状态）画「跟某某说话」，点下去之后对话的选项
         出现在右栏的二级操作里（见 ui.js 的 nearHtml / talkPanelHtml），
         两边都靠 data-arg 把子命令传回来（talk chat / talk accept q_xxx / talk bye）。 */
      needsState: true, run: runTalk },

    { name: 'use',    alias: ['互动', '用'], group: '行动', quiet: true,
      desc: '互动脚下的东西（喝水 / 捡起 / ……）',
      /* 同样不给 btn：互动是事件点自己的动作，只有站在它上面才成立。
         按钮由点位状态面板画出来（见 ui.js 的 eventHtml）——
         没站在事件点上时，那个按钮根本不存在。 */
      needsState: true, run: function () { G.world.useAt(); } },

    { name: 'cast',   alias: ['法术', '技能'], btn: '释放法术', group: '行动',
      desc: '释放一个主动法术。不带参数弹出法术书（法术标签页），带参数直接放（cast 凝神）',
      /* **不给 arg**：按钮点出来是"打开法术书"，不是"放某一个"——
         要放哪个由法术书里那个技能格带 data-arg 传回来（见 ui.js 的 bookCellHtml）。
         同一个指令两种行为：不带参数打开法术书，带参数直接放。
         打字仍然可以一步到位：cast 凝神 / cast skl_focus。 */
      needsState: true, run: function (args) { doCast(args); } },

    { name: 'look',   alias: ['l', '查看'], btn: '查看', group: '行动', desc: '重新描述当前房间',
      needsState: true, run: function () { G.world.describe(); } },

    /* 看状态是**状态自己的动作**，只有身上挂着它才成立 —— 跟 enter 绑门、
       talk 绑人是一个做法。所以不给 btn：按钮就是左栏「状态」块里那个
       可点的状态名（见 ui.js 的 renderBuffs），点下去带着 data-arg 回来。 */
    { name: 'buff',   alias: ['状态'], group: '行动', quiet: true,
      desc: '查看身上某个状态的效果（buff 凝神 / buff st_focus）',
      needsState: true, run: function (args) { doBuff(args); } },

    /* 背包跟状态是同一个做法：**看物品是物品自己的动作**，只有身上有才成立。
       所以不给 btn —— 按钮就是左栏「玩家背包」块里那个可点的物品名
       （见 ui.js 的 renderBag），点下去带着物品 id 回来。
       同一个指令三种行为：不带参数列一遍背包、带名字开详情、`use` 直接做。 */
    { name: 'bag',    alias: ['背包', '物品'], group: '行动', quiet: true,
      desc: '看背包（bag）或某个物品（bag 钱袋 / bag use 钱袋）',
      needsState: true, run: function (args) { doBag(args); } },

    { name: 'save',   alias: ['存档'], btn: '存档', group: '存档', desc: '存档（本地 + 已绑定的磁盘文件）',
      needsState: true, run: function () { G.save.explicit(); } },
    { name: 'load',   alias: ['读档'], btn: '读档', group: '存档', desc: '读取存档',
      needsState: false, run: function () { G.save.load(); } },
    { name: 'export', alias: ['导出'], btn: '导出', group: '存档', desc: '导出成 .json 文件下载',
      needsState: true, run: function () { G.save.exportFile(); } },
    { name: 'import', alias: ['导入'], btn: '导入', group: '存档', desc: '从 .json 文件导入存档',
      needsState: false, run: function () { G.save.pickImport(); } },
    { name: 'bind',   alias: ['绑定'], btn: '绑定', group: '存档', desc: '绑定一个磁盘存档文件，清缓存也不丢',
      needsState: true, run: function () { G.save.bindFile(); } },

    { name: 'arts',   alias: ['技艺'], btn: '技艺', group: '其他',
      desc: '打开法术书，翻到「技艺」（被动技能）',
      needsState: true, run: function () { G.ui.openModal('spellbook', 'passive'); } },
    { name: 'help',   alias: ['?', '帮助'], btn: '帮助', group: '其他', desc: '列出全部指令',
      needsState: false, run: showHelp },
    { name: 'clear',  alias: ['清屏'], btn: '清屏', group: '其他', desc: '清空记事',
      needsState: false, run: function () { G.ui.clearLog(); G.ui.log(G.data.t('clear.done'), 'sys'); } },

    /* 重开不放按钮，只能打字，避免手滑 */
    { name: 'reset',  alias: ['重开'], desc: '删除存档重新开始（reset yes 确认）',
      needsState: false, run: reset }
  ];

  /* 操作面板的分组，按这个顺序渲染。

     **没有「技能」分组**（已废弃）：原来那组按"拥有几个主动技能"现生成按钮，
     技能一多就把操作区撑长。现在改成「行动」组里一个固定的「释放法术」按钮，
     点开弹列表（见 docs/设定/06-物品与技能.md）。

     所以操作区的内容**跟角色完全无关**了 —— 换个档读进来，按钮一个都不变，
     也就没有"读档之后要重画操作区"这回事了。 */
  var GROUPS = ['移动', '行动', '存档', '其他'];

  /* 排成方向盘的组。其余组排成一行按钮。 */
  var PAD_GROUPS = ['移动'];

  function find(word) {
    var q = String(word == null ? '' : word).toLowerCase();
    for (var i = 0; i < CMDS.length; i++) {
      var c = CMDS[i];
      if (c.name === q) return c;
      for (var j = 0; j < c.alias.length; j++) {
        if (c.alias[j].toLowerCase() === q) return c;
      }
    }
    return null;
  }

  /* 按分组把 CMDS 里带 btn 的挑出来排好。
     四组现在**都是静态的** —— 指令表变了操作区才变，跟角色无关
     （技能那组已废弃，见 GROUPS 上面那段）。 */
  function actionGroups() {
    var out = [];
    for (var i = 0; i < GROUPS.length; i++) {
      var name = GROUPS[i];
      var items = [];

      for (var j = 0; j < CMDS.length; j++) {
        var c = CMDS[j];
        if (c.group === name && c.btn) {
          items.push({ cmd: c.name, label: c.btn, danger: c.danger });
        }
      }

      if (items.length) {
        out.push({ name: name, pad: PAD_GROUPS.indexOf(name) >= 0, items: items });
      }
    }
    return out;
  }

  /* 按显示宽度补空格，中文算两格 */
  function pad(s, n) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 2 : 1;
    while (w < n) { s += ' '; w++; }
    return s;
  }

  function showHelp() {
    G.ui.log(G.data.t('help.keys'), 'sys');
    G.ui.log(G.data.t('help.header'), 'sys');
    var lines = [];
    for (var i = 0; i < CMDS.length; i++) {
      var c = CMDS[i];
      lines.push('  ' + pad([c.name].concat(c.alias).join(' / '), 26) + c.desc);
    }
    G.ui.log(lines.join('\n'), 'sys');
  }

  function reset(args) {
    if (!args || args[0] !== 'yes') {
      G.ui.log(G.data.t('reset.ask'), 'warn');
      return;
    }
    G.save.wipe();
    boot();
  }

  /* ---------- 对话 ----------

     talk 后面可以带子命令，点位状态面板里的按钮就是把子命令写进 data-arg
     再点回来的：

       talk                    跟旁边的人说话（旁边只有一个人才行）
       talk <npcId>            跟指定的那个人说话
       talk chat               换一句普通台词
       talk accept <questId>   接受任务
       talk deliver <questId>  交付任务
       talk bye                结束对话

     对话本身不碰 DOM，只返回事件列表（见 js/talk.js），
     所以写记事和刷新面板都归这里 —— 依赖方向才不会成环。 */
  function runTalk(args) {
    args = args || [];
    var sub = args[0] || '';
    var r;

    if (sub === 'bye')           r = G.talk.stop();
    else if (sub === 'chat')     r = G.talk.chat();
    else if (sub === 'accept')   r = G.talk.choose('accept', args[1]);
    else if (sub === 'deliver')  r = G.talk.choose('deliver', args[1]);
    else                         r = G.talk.start(sub || null);

    for (var i = 0; i < r.events.length; i++) {
      G.ui.log(r.events[i].text, r.events[i].cls);
    }
    if (r.ok) G.ui.refresh();
  }

  /* ---------- 法术（主动技能） ---------- */

  /* 按 id 或名字找一个**拥有**的技能。打字时玩家多半打的是名字。 */
  function findSkill(word) {
    var q = String(word == null ? '' : word).trim().toLowerCase();
    if (!q) return null;
    var list = G.skills.owned();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id.toLowerCase() === q) return list[i];
      if (String(list[i].name).toLowerCase() === q) return list[i];
    }
    return null;
  }

  /* 释放一个主动法术。**不带参数 = 打开法术列表**，带参数 = 直接放 ——
     同一个指令两种行为：点按钮走列表（要选一个），打字可以一步到位。
     见 docs/设定/06-物品与技能.md 的「怎么释放」。

     状态由 G.skills.use 挂上，这里只负责把发生的事写进记事。 */
  function doCast(args) {
    if (!args || !args.length) {
      G.ui.openModal('spellbook', 'active');
      return;
    }

    /* 从列表里点「释放」过来的 —— 先把弹框关掉再放。
       放完弹框还挂着的话，玩家会以为"点了没反应"（内容都变了）。 */
    G.ui.closeModal();

    var s = findSkill(args[0]);
    if (!s) {
      G.ui.log(G.data.t('cmd.unknown', { cmd: 'cast ' + (args[0] || '') }), 'warn');
      return;
    }

    var r = G.skills.use(s.id);
    if (!r.ok) {
      G.ui.log(G.data.t(r.reason === 'not-active' ? 'skill.notActive' : 'skill.missing',
                        { name: s.name }), 'warn');
      return;
    }

    /* refreshed = 这个状态本来就挂着，只是把剩余量续满了。
       那种情况不说"你身上多了…"，说了反而像叠了一层。 */
    G.ui.log(G.data.t(r.refreshed ? 'skill.refresh' : 'skill.use', { name: s.name }), 'ok');
    if (!r.refreshed) {
      G.ui.log(G.data.t('status.gain', { name: r.status.name }),
               r.status.kind === 'debuff' ? 'warn' : 'ok');
    }

    G.ui.refresh();
    G.save.auto();
  }

  /* ---------- 看一个状态的详情 ---------- */

  /* 不带参数时身上只有一个状态就直接打开它，多个就提示点哪一个 ——
     跟「旁边站着好几个人」是同一个思路。
     找不到 / 没挂这个状态，各给一句不同的提示。 */
  function doBuff(args) {
    var list = G.statuses.owned();
    if (!list.length) {
      G.ui.log(G.data.t('ui.buffIdle'), 'sys');
      return;
    }

    var q = String((args && args[0]) || '').trim().toLowerCase();

    if (!q) {
      if (list.length === 1) { G.ui.openModal('buff', list[0].id); return; }
      var names = [];
      for (var i = 0; i < list.length; i++) names.push(list[i].def.name);
      G.ui.log(G.data.t('cmd.buff.which', { names: names.join('、') }), 'warn');
      return;
    }

    for (var j = 0; j < list.length; j++) {
      if (list[j].id.toLowerCase() === q ||
          String(list[j].def.name).toLowerCase() === q) {
        G.ui.openModal('buff', list[j].id);
        return;
      }
    }
    G.ui.log(G.data.t('cmd.buff.missing', { name: (args && args[0]) || '' }), 'warn');
  }

  /* ---------- 背包 ----------

     bag                     在记事里列一遍背包
     bag <名字或 id>         打开这个物品的详情弹框
     bag use <名字或 id>     直接对它做它能做的事（跑效果 / 开面板）

     左栏「玩家背包」块里点物品名走的是第二种（data-arg 带物品 id），
     详情弹框里那个动作按钮走的是第三种（data-arg 是 "use <id>"）。

     重名时报错并提示用 id，**不随便挑一个** —— 挑错了玩家会以为游戏在乱来。
     找不到 / 身上没有，各给一句不同的提示，别都说"没有这个物品"。 */

  /* 在记事里列一遍背包。空的时候说一句，不是打一行空的。 */
  function listBag() {
    var list = G.items.list();
    if (!list.length) {
      G.ui.log(G.data.t('bag.empty'), 'sys');
      return;
    }
    var names = [];
    for (var i = 0; i < list.length; i++) {
      var def = list[i].def;
      names.push(def.stack
        ? G.data.t('item.amount.n', { name: def.name, n: list[i].count })
        : G.data.t('item.amount', { name: def.name }));
    }
    G.ui.log(G.data.t('bag.list', { list: names.join('、') }), 'sys');
  }

  /* 对这个物品做它能做的事。**做什么由素材决定**（见 js/effects.js）：
       写了 use   -> 跑效果 + 消耗一个
       写了 panel -> 打开那个面板（不消耗）
     两个都没写的物品走不到这里 —— 详情框里根本没有按钮。 */
  function useBagItem(def) {
    if (def.panel) {
      /* panel 的取值（wallet / notebook）**故意跟弹框种类同名** ——
         validate.mjs 把 panel 限死在白名单里，所以这里直接当弹框种类用。
         以后加面板时两边要一起加，别只改一边。 */
      G.ui.openModal(def.panel);
      return;
    }

    var r = G.effects.useItem(def.id);
    if (!r.ok) {
      G.ui.log(G.data.t('bag.noUse', { name: def.name }), 'warn');
      return;
    }

    /* **先把弹框关掉再写记事** —— 弹框里点完「使用」，内容已经变了，
       还开着会让玩家以为"点了没反应"。 */
    G.ui.closeModal();
    for (var i = 0; i < r.events.length; i++) {
      G.ui.log(r.events[i].text, r.events[i].cls);
    }
    G.ui.refresh();
    G.save.auto();
  }

  function doBag(args) {
    args = args || [];
    var first = String(args[0] == null ? '' : args[0]).trim();

    /* `bag use <x>` —— 跳过详情框直接做。
       只认"第一个词就是 use"这一种写法（物品名是中文，跟 use 撞不上）；
       `bag use` 后面没跟东西时当成"列一遍背包"，比报一句没头没尾的错强。 */
    var direct = first.toLowerCase() === 'use';
    var word = direct ? String(args[1] == null ? '' : args[1]).trim() : first;

    if (!word) { listBag(); return; }

    var hit = G.items.find(word);
    if (!hit) {
      G.ui.log(G.data.t('cmd.unknown', { cmd: 'bag ' + word }), 'warn');
      return;
    }
    if (hit.ambiguous) {
      G.ui.log(G.data.t('bag.which', { name: word }), 'warn');
      return;
    }
    /* 有定义但身上没有 —— 跟"没这个物品"是两回事，提示也不一样 */
    if (!G.items.has(hit.def.id)) {
      G.ui.log(G.data.t('bag.none', { name: hit.def.name }), 'warn');
      return;
    }

    if (!direct) { G.ui.openModal('item', hit.def.id); return; }
    useBagItem(hit.def);
  }

  /* ---------- 执行 ---------- */

  function blocked(c) {
    if (c.needsState && !G.state.isLoaded()) {
      G.ui.log(G.data.t('ui.blocked'), 'warn');
      return true;
    }
    return false;
  }

  /* 从输入框来的一行文字。手打的指令一律回显 —— 玩家得看见自己打了什么。 */
  function submit(line) {
    var text = String(line == null ? '' : line).trim();
    G.ui.clearInput();

    if (!text) { leaveCommand(); return; }   /* 空回车 = 退出命令模式 */

    G.ui.log(G.data.t('cmd.echo', { cmd: text }), 'echo');

    var parts = text.split(/\s+/);
    var c = find(parts[0]);
    if (!c) {
      /* 打错了留在命令模式，好接着改，不用再按一次 / */
      G.ui.log(G.data.t('cmd.unknown', { cmd: parts[0] }), 'warn');
      return;
    }
    if (blocked(c)) { leaveCommand(); return; }

    c.run(parts.slice(1));
    leaveCommand();
  }

  /* 按钮点出来的、键盘敲出来的、点地图格子触发的指令都走这里。
     不再抢焦点：以前每次执行完都把光标塞回输入框，结果键盘全被输入框吃掉，
     方向键按下去只会在输入框里左右移动光标。

     args 是可选的参数数组（点按钮时来自 data-arg）。 */
  function exec(name, args) {
    var c = find(name);
    if (!c) return false;
    if (blocked(c)) return false;
    if (!c.quiet) G.ui.log(G.data.t('cmd.echo', { cmd: c.name }), 'echo');
    c.run(args || []);
    return true;
  }

  /* ---------- 走路模式 / 命令模式 ----------

     走路模式（默认）：键盘归游戏，方向键 / WASD / 小键盘直接走。
     命令模式（输入框获得焦点）：键盘归输入框，正常打字。

     为什么非要分模式：走路用的是 w a s d，而存档指令是 save、向下是 s，
     同一个键不可能既是"走"又是"打字"。与其猜，不如让玩家自己切，
     反正切换只要一个键。 */

  /* 按 e.code 认键，不认 e.key：
     开着中文输入法时 e.key 可能变成别的字符，e.code 永远是物理键位。 */
  var KEYMAP = {
    ArrowUp: 'up',   ArrowDown: 'down',   ArrowLeft: 'left',   ArrowRight: 'right',
    KeyW: 'up',      KeyS: 'down',        KeyA: 'left',        KeyD: 'right',
    Numpad8: 'up',   Numpad2: 'down',     Numpad4: 'left',     Numpad6: 'right',
    /* 进门给三个键：小键盘中键（老 roguelike 的习惯）、句号、空格 */
    Numpad5: 'enter', Period: 'enter', Space: 'enter'
  };

  var REPEAT_MS = 110;   /* 按住不放时的最短间隔，不然日志会被刷屏 */
  var lastMoveAt = 0;

  function cmdInput() { return document.getElementById('cmd'); }
  function appVisible() { return !document.getElementById('app').hidden; }
  function inCommand() { return document.activeElement === cmdInput(); }

  function enterCommand() {
    var input = cmdInput();
    G.ui.setMode('cmd');
    input.value = '';
    try { input.focus(); } catch (e) {}
  }

  function leaveCommand() {
    G.ui.clearInput();
    G.ui.setMode('walk');
    /* 只从输入框和按钮上摘焦点，别的一概不碰 ——
       开局那一下要留给创建页的名字输入框。 */
    var a = document.activeElement;
    if (a && a !== document.body && (a.id === 'cmd' || a.tagName === 'BUTTON')) {
      try { a.blur(); } catch (e) {}
    }
  }

  function onKey(e) {
    if (!appVisible()) return;   /* 创建页有自己的键盘处理，别插手 */

    /* 弹框开着时**键盘不给游戏用** —— 免得在列表上按方向键把角色走丢了。
       只额外认一个 Esc 用来关掉它。不 preventDefault 别的键：
       弹框内容可能要上下滚动，方向键留给滚动是合理的。 */
    if (G.ui.modalOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); G.ui.closeModal(); }
      return;
    }

    /* 命令模式：键盘全归输入框，只额外认一个 Esc 用来退出 */
    if (inCommand()) {
      if (e.key === 'Escape') { e.preventDefault(); leaveCommand(); }
      return;
    }

    /* 走路模式：/ 或回车进命令模式 */
    if (e.key === '/' || e.key === 'Enter') {
      e.preventDefault();
      enterCommand();
      return;
    }

    var cmd = KEYMAP[e.code];
    if (!cmd) return;
    e.preventDefault();

    /* 按住不放会一直触发 keydown。走太快日志会被刷屏，所以限一下速。 */
    var now = Date.now();
    if (e.repeat && now - lastMoveAt < REPEAT_MS) return;
    lastMoveAt = now;

    exec(cmd);
  }

  /* ---------- 创建角色 ---------- */

  function startCreate() {
    G.ui.showCreate();
  }

  function tryCreate() {
    var input = document.getElementById('create-name');
    var name = input.value;

    var err = G.rules.checkName(name);
    if (err) {
      G.ui.setCreateError(err);
      return;
    }

    G.state.create(String(name).trim());
    G.ui.hideCreate();
    G.ui.clearLog();
    G.ui.log(G.data.t('boot.title'), 'title');
    G.ui.log(G.data.t('create.done', { name: G.state.player().name }), 'ok');
    G.ui.log(G.data.t('ui.hint'), 'sys');
    G.world.describe(G.state.room());

    G.ui.refresh();
    G.save.auto();
    leaveCommand();   /* 建完角色直接回走路模式，键盘就能用了 */
  }

  /* ---------- 开局 ---------- */

  function boot() {
    G.ui.clearLog();

    var text = G.save.readLocal();
    if (text) {
      try {
        G.state.fromJSON(text);
        G.ui.hideCreate();
        G.ui.log(G.data.t('boot.title'), 'title');
        G.ui.log(G.data.t('boot.continue'), 'sys');
        G.world.describe(G.state.room());
        G.ui.refresh();
        leaveCommand();
        return;
      } catch (e) {
        G.ui.log('存档读不出来：' + ((e && e.message) || e), 'err');
        G.ui.log('将重新开始。', 'warn');
      }
    }
    startCreate();
  }

  /* ---------- 启动 ---------- */

  function init() {
    G.ui.init();
    /* 操作区只画一次就够 —— 它的内容跟角色无关（见 GROUPS 上面那段），
       读档 / 导入换个角色也不会变。 */
    G.ui.renderActions(actionGroups());

    G.ui.setNote(G.data.t('ui.hint'));
    G.ui.setMode('walk');

    document.getElementById('send').addEventListener('click', function () {
      /* 还没在输入状态就先聚焦，省得点了发送没反应 */
      if (!inCommand()) { enterCommand(); return; }
      submit(document.getElementById('cmd').value);
    });

    /* 点整条输入栏都算"我要打字"，不用精准点到那个细长的输入框。
       用 mousedown 而不是 focus 事件：文档没有焦点时浏览器会把 focus / blur
       推迟派发，靠不住；mousedown 一定会有。
       注意模式只是个外观 —— 按键归谁管看的是 document.activeElement，
       所以就算焦点事件没派发，键盘行为也不会错，最多边框颜色慢半拍。 */
    document.getElementById('input-bar').addEventListener('mousedown', function (e) {
      if (e.target && e.target.id === 'send') return;
      if (inCommand()) return;
      e.preventDefault();
      enterCommand();
    });

    document.getElementById('cmd').addEventListener('focus', function () { G.ui.setMode('cmd'); });
    document.getElementById('cmd').addEventListener('blur', function () { G.ui.setMode('walk'); });

    /* Esc 由下面挂到 document 上的 onKey 统一处理，这里只管回车 */
    document.getElementById('cmd').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit(this.value);
      }
    });

    /* 点地图上相邻的格子走过去。ui.js 只负责把能走的方向标在格子上
       （data-move），谁被点到了怎么处理由这里决定 —— ui 不反向调 main。 */
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;

      /* 弹框的两种关法：点遮罩、点右上角「关闭」。
         遮罩和方框是**兄弟**（见 index.html），所以点方框里面
         不会匹配到这条，不用额外判断"点在不在框里"。 */
      if (e.target.closest('[data-modal="close"]')) { G.ui.closeModal(); return; }

      var cell = e.target.closest('#map [data-move]');
      if (cell) { exec(cell.getAttribute('data-move')); return; }

      var btn = e.target.closest('button[data-cmd]');
      if (btn) {
        /* 先把焦点从按钮上摘掉，不然接下来按回车会重复触发这个按钮 */
        try { btn.blur(); } catch (err) {}
        /* data-arg 是按钮带给指令的参数（比如对话选项的 accept q_walk10、
           法术列表里的 cast skl_focus） */
        var raw = btn.getAttribute('data-arg') || '';
        exec(btn.getAttribute('data-cmd'), raw ? raw.split(/\s+/) : []);
      }
    });

    /* 走路模式下的全局键盘。挂在 document 上，
       所以不用先点哪儿"激活"，打开就能走。 */
    document.addEventListener('keydown', onKey);

    /* 创建角色页 */
    var nameInput = document.getElementById('create-name');
    document.getElementById('create-go').addEventListener('click', tryCreate);
    nameInput.addEventListener('input', function () { G.ui.setCreateError(''); });
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        tryCreate();
      }
    });

    document.getElementById('file-input').addEventListener('change', function () {
      G.save.onImportFile(this.files && this.files[0]);
    });

    boot();

    /* 捞上次绑定的磁盘文件句柄，不必等它，捞到了再刷新一下状态面板 */
    G.save.restoreHandle().then(function () { G.ui.renderSaveLabel(); });
  }

  return {
    init: init,
    submit: submit,
    exec: exec,
    enterCommand: enterCommand,
    leaveCommand: leaveCommand,
    inCommand: inCommand,
    onKey: onKey,
    cmds: CMDS,
    boot: boot
  };

})();

G.main.init();
