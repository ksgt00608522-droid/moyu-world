/* 魔鱼世界 · 界面
   全局：G.ui

   只负责把东西画出来。不判断规则，不改状态。
   要改外观去 css/theme.css，这里只生成结构。 */

var G = window.G || (window.G = {});

G.ui = (function () {

  var MAX_LOG = 400;   /* 记事最多留多少行，超出裁掉最老的 */

  /* 四个方向：指令名、x 增量、y 增量。渲染地图和点位状态都用它，
     免得两处各写一份、改一处忘一处。 */
  var STEPS = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];

  /* 门在地图上画出来的字形。只是"画什么字"，不是门的定义 ——
     门在素材里是 rooms[].doors 里的一条，判定一律走 G.data.doorAt()，
     跟这个字长什么样没关系。以后想换个字（或者换成图标）改这一处就够。 */
  var DOOR_GLYPH = '门';

  var el = {};

  function init() {
    el.app     = document.getElementById('app');
    el.create  = document.getElementById('create-screen');
    el.err     = document.getElementById('create-error');
    el.note    = document.getElementById('topbar-note');
    el.saveLbl = document.getElementById('topbar-save');
    el.map     = document.getElementById('map');
    el.status  = document.getElementById('status');
    el.buffs   = document.getElementById('buffs');
    el.bag     = document.getElementById('bag');
    el.tile    = document.getElementById('tile');
    el.actions = document.getElementById('actions');
    el.second  = document.getElementById('secondary');
    el.log     = document.getElementById('log');
    el.bar     = document.getElementById('input-bar');
    el.cmd     = document.getElementById('cmd');
    el.modal   = document.getElementById('modal');
    el.mTitle  = document.getElementById('modal-title');
    el.mBody   = document.getElementById('modal-body');
    el.mClose  = document.getElementById('modal-close');
    el.mBox    = document.getElementById('modal-box');
    el.mHead   = document.getElementById('modal-head');

    /* 关闭按钮的文案在 strings 里 —— index.html 是静态的，
       写死在那里就等于绕开了"文案全在 data/strings.js"这条规矩。 */
    el.mClose.textContent = G.data.t('ui.modal.close');

    /* 笔记本自己的控件（书签切栏 / 翻页）不走 main 的 data-cmd 委托，
       在弹框上单独接一个委托，扫 `[data-note]`。 */
    el.modal.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-note]') : null;
      if (!t) return;
      if (t.tagName === 'BUTTON') { try { t.blur(); } catch (err) {} }
      e.preventDefault();
      onNoteClick(t.getAttribute('data-note'), t.getAttribute('data-arg'));
    });

    /* 法术书的控件（底部标签切栏 / 翻页）也走弹框上的独立委托，扫 [data-book]。 */
    el.modal.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-book]') : null;
      if (!t) return;
      if (t.tagName === 'BUTTON') { try { t.blur(); } catch (err) {} }
      e.preventDefault();
      onBookClick(t.getAttribute('data-book'), t.getAttribute('data-arg'));
    });

    /* 书（法术书 / 笔记本）不再支持拖动 —— 居中固定就好。 */
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 记事 ---------- */

  function log(text, cls) {
    var p = document.createElement('p');
    if (cls) p.className = cls;
    p.textContent = text;
    el.log.appendChild(p);
    while (el.log.childElementCount > MAX_LOG) {
      el.log.removeChild(el.log.firstChild);
    }
    el.log.scrollTop = el.log.scrollHeight;
  }

  function clearLog() {
    el.log.innerHTML = '';
  }

  /* ---------- 地图 ---------- */

  /* 等宽字体里字符是"高瘦"的，格子要是跟着行高走就会变成长方形。
     所以量出字宽与字号的比例，再按这个比例把格子做成正方形，
     最后由 CSS 把每个格子做成同样宽高的行内块。量一次缓存起来。 */

  var BASE_FS    = 22;    /* 量字宽用的基准字号 */
  var FS_OF_CELL = 1.0;   /* 字号 = 格子边长，字形高度大约占格子的七成 */
  var WIDTH_FILL = 0.86;  /* 字宽最多占格子的八成六，左右各留一点空 */
  var CELL_MIN   = 16;    /* 再小字就看不清了 */
  var CELL_MAX   = 56;    /* 再大地图就散架了，不像一张图 */

  var advRatio = 0;       /* 字宽 ÷ 字号，跟字号无关，量一次就够 */

  function measureAdvRatio() {
    if (advRatio) return advRatio;

    var cs = window.getComputedStyle(el.map);
    var probe = document.createElement('span');
    probe.textContent = '0000000000';
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;display:inline-block;' +
                          'font-family:' + cs.fontFamily + ';font-size:' + BASE_FS + 'px';
    document.body.appendChild(probe);
    var w = probe.getBoundingClientRect().width / 10;
    document.body.removeChild(probe);

    if (!w || !isFinite(w)) w = BASE_FS * 0.6;   /* 兜底 */
    advRatio = w / BASE_FS;
    return advRatio;
  }

  /* 格子边长按面板大小自适应：小地图放大到填满面板，大地图缩到看得清为止。
     两头都设了上下限，免得一张 3×3 的图撑出一屏方块，或者一张 60×60 的图缩成渣。 */
  function applyMapMetrics(room) {
    var cols = room.tiles[0].length;
    var rows = room.tiles.length;

    /* 用 clientWidth / clientHeight 而不是 getBoundingClientRect：
       前者扣掉了滚动条，后者不扣。不扣的话会陷入
       "出现滚动条 → 可用宽度变小 → 还是溢出" 的死循环。 */
    var availW = el.map.clientWidth  - 8;
    var availH = el.map.clientHeight - 8;

    var cell = Math.floor(Math.min(availW / cols, availH / rows));
    if (!isFinite(cell) || cell <= 0) cell = CELL_MIN;   /* 面板还没布局出来 */
    cell = Math.max(CELL_MIN, Math.min(CELL_MAX, cell));

    /* 字号要同时满足两条：
         竖着 —— 字形高度（约 0.7 个字号）不能超过格子；
         横着 —— 字宽不能超过格子的 WIDTH_FILL。
       只按字宽推字号是错的：字宽只跟字号成正比，字体的"高度"却由字号本身决定，
       推出来的字号会把格子纵向撑爆，地图上就多出一条滚动条。 */
    var fs = Math.min(cell * FS_OF_CELL, cell * WIDTH_FILL / measureAdvRatio());

    el.map.style.setProperty('--cell', cell + 'px');
    el.map.style.setProperty('--fs', fs.toFixed(1) + 'px');
  }

  /* 取名字的第一个字当玩家标记。
     用 Array.from 而不是 charAt(0)：表情符号这类字符占两个 UTF-16 码元，
     charAt 会把它切成半个乱码方块。 */
  function firstChar(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '?';
    return Array.from(t)[0];
  }

  /* 空格 = 空地，井号 = 墙，门格画一个「门」字，
     NPC 那一格画它自己的图标字，玩家那一格画名字的第一个字（带边框）。
     玩家四邻中能走的格子会带上 data-move，点击和悬停都靠它。 */
  function renderMap() {
    var room = G.state.room();
    var st = G.state.data;
    if (!room || !st) { el.map.textContent = ''; return; }

    applyMapMetrics(room);

    /* 玩家不画通用的 @，画自己名字的第一个字 —— 一眼看出"这是我"。
       边框由 CSS 给（#map .me），万一同屏有别的角色首字相同，也还能分得开。 */
    var me = G.state.player();
    var meCh = firstChar(me && me.name);

    /* NPC 位置索引先建一次，免得每个格子都遍历一遍 NPC 表。
       下面算四邻可走时也要用它 —— NPC 挡路，walkable 得知道谁站在那儿。 */
    var npcs = G.data.npcIndex(room);

    /* 事件点索引，同样先建一次。**只含还活着的** —— 已经用掉的一次性事件点
       不在里面，所以地图、点位状态、触发判定三条路一起消失。

       注意它跟 npcs 的差别：**事件点不挡路**，不参与下面那个 walkable 判定
       （见 js/data.js 的 walkable 与 docs/设定/10-事件点.md）。 */
    var evs = G.events.index(room);

    /* 先算出四邻中哪些方向走得通，键是 "x,y"。
       把索引传进去，不然 walkable 每问一次都要重建一遍。 */
    var px = st.world.x, py = st.world.y;
    var near = {};
    for (var d = 0; d < STEPS.length; d++) {
      var nx = px + STEPS[d][1], ny = py + STEPS[d][2];
      if (G.data.walkable(room, nx, ny, npcs)) near[nx + ',' + ny] = STEPS[d][0];
    }

    /* 一行一个 .row 块，行高由 --cell 决定。
       不要用换行符分行：换行符的高度跟着父级 line-height 走，
       父级字号一动，行距就跟格子高对不上，地图会被拉长。
       整体再套一层 .grid，交给 CSS 用 margin:auto 居中 ——
       用 justify-content 居中在内容超出时会裁掉上边，margin:auto 不会。 */
    var html = '<div class="grid">';
    for (var y = 0; y < room.tiles.length; y++) {
      var row = room.tiles[y];
      html += '<div class="row">';
      for (var x = 0; x < row.length; x++) {
        var ch, cls, style = '';
        var npc = npcs[x + ',' + y];
        var ev  = evs[x + ',' + y];

        if (px === x && py === y) {
          /* 玩家排在最前。NPC 挡路，两者不可能同格；
             但**事件点不挡路，玩家可以站在它上面** —— 所以这一条对事件点是
             真的会用到的：站在泉水上时，这一格画的是玩家自己的字。 */
          ch = meCh; cls = 'me';
        } else if (npc) {
          ch = npc.glyph || firstChar(npc.name);
          /* 身上还有能接 / 能交的任务 → 右上角多一个角标（样式在 CSS 里） */
          cls = 'npc' + (G.quests.npcBusy(npc, room) ? ' has-quest' : '');

          /* 颜色来自类型表，写成这一格上的 CSS 变量；边框和字色都用它。
             类型 id 写错时不加 style，走 CSS 的兜底色，至少还看得见。 */
          var type = G.data.npcType(npc.type);
          if (type && type.color) style = ' style="--npc-color:' + esc(type.color) + '"';
        } else if (ev) {
          /* 事件点。**藏起来的、还没触发过的只画一个空框** ——
             玩家知道"这儿有东西"，但不知道是什么。

             "不画字"画的是一个**空格**而不是空字符串：这样每行的文字长度
             还是跟列数一致（跟空地画空格是同一个道理），
             冒烟测试里"每行 9 个字符"那条断言才站得住。

             该不该画字问 G.events.revealed()，不在这儿自己写一遍条件 ——
             两处各写一遍迟早对不上（地图按 hidden 画了空框、面板却画了字）。 */
          var shown = G.events.revealed(ev);
          ch = shown ? (ev.glyph || firstChar(ev.name)) : ' ';
          cls = 'event' + (shown ? '' : ' hidden');

          /* 颜色来自类型表，写成这一格上的 CSS 变量；边框和字色都用它 */
          var et = G.data.eventType(ev.type);
          if (et && et.color) style = ' style="--event-color:' + esc(et.color) + '"';
        } else if (G.data.doorAt(room, x, y)) {
          ch = DOOR_GLYPH; cls = 'door';
        } else if (row.charAt(x) === '#') {
          ch = '#'; cls = 'wall';
        } else {
          ch = ' '; cls = 'floor';   /* 空地就是空的，不画点 */
        }

        var step = near[x + ',' + y];
        html += '<span class="' + cls + (step ? ' walk' : '') + '"' + style +
                (step ? ' data-move="' + step + '"' : '') + '>' + esc(ch) + '</span>';
      }
      html += '</div>';
    }
    html += '</div>';
    el.map.innerHTML = html;
  }

  /* ---------- 状态面板 ---------- */

  /* 一行「标签 + 值」。cls 用来标状态（比如受惩罚时整块变色）。 */
  function row(label, value, cls) {
    return '<dt>' + esc(label) + '</dt>' +
           '<dd' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(value) + '</dd>';
  }

  /* 一行「标签 + 百分比 + 细进度条」。
     条宽写在内联 style 上 —— 这个值每帧都在变，走 CSS 变量反而更绕。 */
  function meter(label, v, max, cls) {
    var pct = Math.round(G.rules.ratio(v, max) * 100);
    return '<dt>' + esc(label) + '</dt>' +
           '<dd class="meter' + (cls ? ' ' + cls : '') + '">' +
             '<span class="bar"><i style="width:' + pct + '%"></i></span>' +
             '<span class="pct">' + pct + '%</span>' +
           '</dd>';
  }

  /* 明细里的数：整数不带小数点（5 而不是 5.0），小数保留一位（0.6）。
     四项各自保留一位，相加跟总值的差最多就是四舍五入那一点。 */
  function num(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return String(Math.round(n * 10) / 10);
  }

  /* 玩家状态：名字 / 生命 / 灵性 / 六项基础属性。

     **没有等级、没有经验、没有金币**（见 docs/设定/04-数值与成长.md）。
     **神性不列** —— 它参与判定，但玩家看不见。

     六项属性排成 **2 行 3 列**（不是 6 行 1 列）—— 省下来的纵向空间
     留给下面的「状态」块，那块的内容是会变的。
     每格两行：上面**总值**，下面**括号明细**。

     括号里固定四项、顺序固定：**基础 + 被动 + 状态 + 装备**。
     显示的是**惩罚后的实际贡献**，所以四项相加 ≈ 总值，玩家能自己核对。
     **没有「主动」那一项** —— 主动技能是靠挂状态生效的，
     它的贡献本来就在「状态」里（见 06-物品与技能.md）。

     被生命惩罚削着的时候，每格的**总值**标 warn，明细不变色。 */
  function renderStatus() {
    var p = G.state.player();
    if (!p) { el.status.innerHTML = ''; return; }

    var html = '';
    html += row(G.data.t('ui.attr.name'), p.name);
    html += meter(G.data.t('ui.vital.hp'), p.hp, p.hpMax, 'hp');
    html += meter(G.data.t('ui.vital.ess'), p.ess, p.essMax, 'ess');

    var parts = G.rules.attrParts();
    var weak  = G.rules.hpPenalty(p.hp, p.hpMax) < 1;
    var list  = G.rules.attrs;

    html += '<dd class="attrs">';
    for (var i = 0; i < list.length; i++) {
      var a = parts[list[i].key] || {};
      html += '<div class="attr' + (weak ? ' warn' : '') + '">' +
                '<div class="attr-head">' +
                  '<span class="attr-name">' + esc(list[i].label) + '</span>' +
                  '<span class="attr-total">' + num(a.total) + '</span>' +
                '</div>' +
                '<div class="attr-parts">(' +
                  '<i class="p p-base">'    + num(a.base)    + '</i>+' +
                  '<i class="p p-passive">' + num(a.passive) + '</i>+' +
                  '<i class="p p-status">'  + num(a.status)  + '</i>+' +
                  '<i class="p p-gear">'    + num(a.gear)    + '</i>' +
                ')</div>' +
              '</div>';
    }
    html += '</dd>';

    el.status.innerHTML = html;
  }

  /* **左栏没有技能块**（原来的 renderSkills() 删掉了）。
     技能换了入口：主动走操作区「行动 → 释放法术」，主动 + 被动总览走
     「其他 → 技艺」—— 两处都是弹框（见下面「弹框」一节），
     比左栏那一小块宽得多、还能写描述。留着技能块只是白占一行高度。
     别再加回来：被动技能在技艺弹框里看得到，不缺入口。 */

  /* 状态：挂着的正面 / 负面状态。**名字本身是一个按钮** ——
     点开弹框看效果（描述 / 剩余量 / 影响 / 计时）。
     光看名字看不出还剩几步、到底改了什么，所以名字就是入口。

     用 owned() 而不是 defs()：按钮要带状态 id 回来（data-arg），
     所以每条记录都得留着 id，不能只留定义。

     正负面**只影响配色**（good / bad），逻辑上没区别 —— 见 06-物品与技能.md。 */
  function renderBuffs() {
    var list = G.statuses.owned();
    if (!list.length) {
      el.buffs.className = 'idle';
      el.buffs.innerHTML = '<dd class="idle">' + esc(G.data.t('ui.buffIdle')) + '</dd>';
      return;
    }
    el.buffs.className = '';

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var kind = list[i].def.kind === 'debuff' ? 'bad' : 'good';
      html += '<dd class="buff ' + kind + '">' +
                '<button data-cmd="buff" data-arg="' + esc(list[i].id) + '"' +
                ' title="' + esc(G.data.t('ui.buff.view')) + '">' +
                esc(list[i].def.name) +
                '</button></dd>';
    }
    el.buffs.innerHTML = html;
  }

  /* 背包：身上的物品，**名字本身是一个按钮** —— 点开弹框看详情（描述 / 数量 / 使用）。
     跟状态块是同一套排法（并排成标签、按内容宽度、装不下换行），
     区别只在配色和点击后开哪个弹框。

     顺序由 G.items.list() 定好了（先按分类表、同类按素材顺序），
     这里**不重排** —— 排法归数据层，界面只负责画。理由写在 js/items.js 里：
     顺序跟着"什么时候捡到的"走的话，捡个新东西整块背包就会重排。

     可堆叠的写「名字 ×N」，唯一的不写数量（"钱袋 ×1"读着别扭）。
     **货币不在这儿** —— 钱包不是背包里的一格，要看余额得点开钱袋，
     见 docs/设定/06-物品与技能.md。 */
  function renderBag() {
    var list = G.items.list();
    if (!list.length) {
      el.bag.className = 'idle';
      el.bag.innerHTML = '<dd class="idle">' + esc(G.data.t('bag.empty')) + '</dd>';
      return;
    }
    el.bag.className = '';

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var def = list[i].def;
      var kind = G.data.itemKind(def.kind);

      /* 颜色来自分类表，写成标签上的 CSS 变量；分类 id 写错时不加 style，
         走 CSS 的兜底色，至少还看得见。 */
      var style = (kind && kind.color)
                ? ' style="--item-color:' + esc(kind.color) + '"' : '';

      var label = def.stack
        ? G.data.t('item.amount.n', { name: def.name, n: list[i].count })
        : G.data.t('item.amount', { name: def.name });

      html += '<dd class="item"' + style + '>' +
                '<button data-cmd="bag" data-arg="' + esc(def.id) + '"' +
                ' title="' + esc(G.data.t('ui.item.view')) + '">' +
                esc(label) +
                '</button></dd>';
    }
    el.bag.innerHTML = html;
  }

  /* 存档绑定状态属于"整个程序"的事，不属于玩家，所以放顶栏右侧 */
  function renderSaveLabel() {
    var name = G.save.fileName();
    el.saveLbl.textContent = '存档：' + (name || '未绑定');
  }

  /* ---------- 弹框（模态浮层） ----------

     六处共用一套壳，内容不一样：
     释放法术 / 技艺 / 状态详情 / 物品详情 / 钱包 / 笔记本。

     这里只管**画和关**：
       - 三种关法里的「点遮罩」「点关闭按钮」由 main.js 的全局点击委托认
         `[data-modal="close"]` 处理；「按 Esc」也在 main.js 的键盘分发里。
         ui 不自己挂监听 —— 挂监听就得知道"什么时候该关"，
         那是引导层的事（见 08-技术约束.md 的依赖方向）。
       - **弹框里的按钮照样是 `button[data-cmd]`**（比如「释放」带 `cast` +
         技能 id），走的还是 main 那一套点击委托，不用另写一套。

     关掉之后**不改变焦点** —— 跟别的按钮一致，不把光标塞进输入框。 */

  /* 现在开着哪一种、开着哪一个（状态详情要知道是哪个状态）。
     refresh() 里会按它重画，所以状态变了弹框里也跟着变。 */
  var modalKind = null;
  var modalArg  = null;

  /* 笔记本内部：当前看哪一栏（书签）、当前第几页。是"点开看"，
     不随对外行为变，所以留在弹框层。 */
  var noteSec  = 'active';
  var notePage = 0;

  /* 法术书：当前标签（active 主动 / passive 被动 / prof 专业）+ 页码。 */
  var bookTab  = 'active';
  var bookPage = 0;

  function modalOpen() { return !!el.modal && el.modal.hidden === false; }

  function openModal(kind, arg) {
    modalKind = kind || 'spellbook';
    modalArg  = arg == null ? null : arg;
    /* 每次打开笔记本都回到第一栏第一页，别续着上次翻到哪 */
    if (modalKind === 'notebook') { noteSec = 'active'; notePage = 0; }
    if (modalKind === 'spellbook') {
      bookTab  = (arg === 'passive' || arg === 'prof') ? arg : 'active';
      bookPage = 0;
    }
    /* **先露出来再画** —— renderModal 里有一道"弹框开着才画"的闸，
       顺序反了就会先画一次空内容（写这一轮时踩过）。 */
    el.modal.hidden = false;
    renderModal();
  }

  function closeModal() {
    if (!el.modal) return;
    el.modal.hidden = true;
    if (el.mBox) el.mBox.classList.remove('book-mode');
    modalKind = null;
    modalArg  = null;
  }

  function renderModal() {
    if (!modalKind || !modalOpen()) return;
    /* 法术书和笔记本共用同一套"书"外观（book-mode），切换时统一挂 */
    var isBook = (modalKind === 'spellbook' || modalKind === 'notebook');
    if (el.mBox) el.mBox.classList.toggle('book-mode', isBook);
    var v = modalView(modalKind, modalArg);
    el.mTitle.innerHTML = v.title;
    if (modalKind === 'notebook') {
      /* 笔记本要量高度来翻页，不走一锤子的 innerHTML，走专门的渲染 */
      noteRender();
    } else {
      el.mBody.innerHTML = v.html;
    }
  }

  /* 状态 / 技能改了些什么，写成几行（"智力 +2" / "每走一格：生命 -2"）。
     没有就返回空数组 —— 调用方自己决定空的时候说什么。 */
  function attrLabel(key) {
    if (key === 'hp')  return G.data.t('ui.vital.hp');
    if (key === 'ess') return G.data.t('ui.vital.ess');
    var list = G.rules.attrs;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i].label;
    }
    return String(key);
  }

  function signed(n) {
    n = Number(n) || 0;
    return (n > 0 ? '+' : '') + n;
  }

  function effectLines(def) {
    var out = [], i;
    var mods = def.mods || [];
    for (i = 0; i < mods.length; i++) {
      var m = mods[i];
      out.push(m.add != null
        ? G.data.t('mods.add', { attr: attrLabel(m.attr), n: signed(m.add) })
        : G.data.t('mods.pct', { attr: attrLabel(m.attr), n: signed(m.pct) }));
    }
    if (def.tick) {
      var what = attrLabel(def.tick.key) + ' ' + signed(def.tick.delta);
      /* tick 是"每次计时"的效果，计时方式不同说法也不同 ——
         step 就说"每走一格"，别的（现在还没实现）说"每次计时"。 */
      out.push(G.data.t(def.unit === 'step' ? 'buff.tick.step' : 'buff.tick.other',
                        { what: what }));
    }
    return out;
  }

  /* 一个状态 / 技能带的那点效果，拼成一句放括号里。没有就返回空串。 */
  function effectSuffix(def) {
    var lines = effectLines(def);
    if (!lines.length) return '';
    var safe = [];
    for (var i = 0; i < lines.length; i++) safe.push(esc(lines[i]));
    return '（' + safe.join('，') + '）';
  }

  /* —— 法术书：把旧「释放法术」和「技艺」合并成一本书。
   「释放法术」按钮 → 翻到「法术」（主动），「技艺」按钮 → 翻到「技艺」（被动）。 —— */

  /* 一块羊皮纸页最多放几个技能格。数据还薄，先定宽松些；
     以后法术多了，调这一个数就能自然翻页。 */
  var BOOK_PER_PAGE = 8;

  /* 法术书的点击：data-book="tab" 切栏，data-book="page" data-arg=±1 翻页。 */
  function onBookClick(act, arg) {
    if (act === 'tab') {
      bookTab  = (arg === 'passive' || arg === 'prof') ? arg : 'active';
      bookPage = 0;
    } else if (act === 'page') {
      var max = bookPages();
      bookPage += (arg === '-1') ? -1 : 1;
      if (bookPage < 0) bookPage = 0;
      if (bookPage >= max) bookPage = max - 1;
    } else {
      return;
    }
    renderModal();
  }

  /* 当前栏（法术 / 技艺）的技能切成几页。 */
  function bookPages() {
    var list = G.skills
      ? (bookTab === 'active' ? G.skills.active() : G.skills.passive())
      : [];
    return Math.max(1, Math.ceil(list.length / BOOK_PER_PAGE));
  }

  /* 法术书整页：底部标签栏 + 羊皮纸页。
     标签：法术（主动）/ 技艺（被动）/ 专业（还没做，留空占位）。 */
  function spellbookHtml() {
    var tabs = [
      [ 'active',  'modal.book.tab.active'  ],
      [ 'passive', 'modal.book.tab.passive' ],
      [ 'prof',    'modal.book.tab.prof'    ]
    ];
    var i, t, tb = '<div class="sb-tabs">';
    for (i = 0; i < tabs.length; i++) {
      t = bookTab === tabs[i][0];
      tb += '<button type="button" class="sb-tab' + (t ? ' on' : '') +
            '" data-book="tab" data-arg="' + tabs[i][0] + '">' +
            esc(G.data.t(tabs[i][1])) + '</button>';
    }
    /* 关闭按钮放在标签栏最右 —— 没有单独的标题条了，书就是"标签 + 纸面" */
    tb += '<button type="button" class="sb-close" data-modal="close" ' +
          'title="' + esc(G.data.t('ui.modal.close')) + '">✕</button>';
    tb += '</div>';
    return tb + '<div class="spell-sheet">' + bookSheetHtml() + '</div>';
  }

  /* 羊皮纸页这栏的内容：技能网格，一页放不下就翻页。 */
  function bookSheetHtml() {
    if (bookTab === 'prof') {
      return '<p class="m-idle">' + esc(G.data.t('modal.book.prof.none')) + '</p>';
    }
    var list = G.skills
      ? (bookTab === 'active' ? G.skills.active() : G.skills.passive())
      : [];
    if (!list.length) {
      return '<p class="m-idle">' +
             esc(G.data.t(bookTab === 'active' ? 'modal.spells.idle' : 'modal.arts.idle')) +
             '</p>';
    }
    var total = Math.ceil(list.length / BOOK_PER_PAGE);
    if (bookPage >= total) bookPage = total - 1;
    var start = bookPage * BOOK_PER_PAGE;
    var end = Math.min(start + BOOK_PER_PAGE, list.length);
    var html = '<div class="skill-grid">';
    for (var i = start; i < end; i++) html += bookCellHtml(list[i]);
    html += '</div>';
    html += bookPager(total);
    return html;
  }

  /* 技能格：一块彩色"符文"占位（字 = 技能名头一个字）+ 名字。
     悬停浮出说明（描述 + 实打实的效果）。主动格子点一下就施放；
     被动的偏暗、纯看。数据里没有冷却 / 射程 / 消耗，所以不编假数字，
     悬停只讲真的有的：它是什么、干了什么。 */
  function bookCellHtml(s) {
    var active = s.kind === 'active';
    var sigil = esc(s.name.charAt(0));
    var kind = esc(G.data.t(active ? 'ui.skill.active' : 'ui.skill.passive'));
    var tip = '<span class="sb-name">' + esc(s.name) + '</span>' +
              '<span class="sb-kind ' + (active ? 'active' : 'passive') + '">' + kind + '</span>' +
              (s.desc ? '<p class="sb-desc">' + esc(s.desc) + '</p>' : '') +
              '<p class="sb-eff">' + bookEffect(s) + '</p>';
    var inner = '<span class="sb-icon">' + sigil + '</span>' +
                '<span class="sb-lbl">' + esc(s.name) + '</span>' +
                '<span class="sb-tip">' + tip + '</span>';

    var color = active ? 'var(--sb-act)' : 'var(--sb-pas)';
    return active
      ? '<button type="button" class="skill-cell" data-cmd="cast" data-arg="' + esc(s.id) +
        '" style="--sc: ' + color + '">' + inner + '</button>'
      : '<div class="skill-cell dim" style="--sc: ' + color + '">' + inner + '</div>';
  }

  /* 技能到底干了些啥，一句话：主动说施放后挂什么，被动说改了什么。 */
  function bookEffect(s) {
    if (s.kind === 'active') {
      var st = G.data.status(s.applies);
      return st
        ? esc(G.data.t('modal.book.applies', { name: st.name, extra: effectSuffix(st) }))
        : esc(G.data.t('modal.book.noeffect'));
    }
    return (s.mods || []).length
      ? esc(effectLines(s).join('，'))
      : esc(G.data.t('modal.book.noeffect'));
  }

  /* 右下角翻页条：一页装得下就不显示。 */
  function bookPager(total) {
    if (total <= 1) return '';
    return '<div class="sb-pager">' +
           '<button type="button" class="sb-pg"' +
           (bookPage <= 0 ? ' disabled' : '') +
           ' data-book="page" data-arg="-1">‹</button>' +
           '<span>' + esc(G.data.t('modal.note.pages',
                       { p: bookPage + 1, total: total })) + '</span>' +
           '<button type="button" class="sb-pg"' +
           (bookPage >= total - 1 ? ' disabled' : '') +
           ' data-book="page" data-arg="1">›</button></div>';
  }

  /* 剩余量怎么说，看计时方式 —— "还能走 3 格" / "不会自己消失"。
     manual / threshold 的 turns 是 0，写"还能走 0 格"是错的。 */
  function leftText(rec) {
    var u = rec.def.unit;
    if (u === 'manual')    return G.data.t('buff.left.manual');
    if (u === 'threshold') return G.data.t('buff.left.threshold');
    return G.data.t(u === 'time' ? 'buff.left.time' : 'buff.left.step',
                    { n: rec.left });
  }

  function unitText(u) {
    var key = { step: 'buff.unit.step', time: 'buff.unit.time',
                manual: 'buff.unit.manual', threshold: 'buff.unit.threshold' }[u];
    return G.data.t(key || 'buff.unit.step');
  }

  function mBlock(label, valueHtml, cls) {
    return '<div class="m-block">' +
             '<div class="m-label">' + esc(label) + '</div>' +
             '<p class="m-value' + (cls ? ' ' + cls : '') + '">' + valueHtml + '</p>' +
           '</div>';
  }

  /* 状态详情：四块 —— 描述 / 剩余量 / 影响 / 计时。
     缺的就不画（状态可以只有描述）。**剩余量以前玩家根本看不到**，
     挂上「凝神」之后不知道还能走几步，只能等它自己消失时报一声。 */
  function buffHtml(id) {
    var list = G.statuses.owned();
    var rec = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) rec = list[i];
    }
    /* 已经摘掉的状态（比如刚好在这一步过期）—— 给一句提示，别画个空框 */
    if (!rec) {
      return '<p class="m-idle">' +
             esc(G.data.t('cmd.buff.missing', { name: id || '' })) + '</p>';
    }

    var def = rec.def;
    var lines = effectLines(def);
    var eff = [];
    for (var j = 0; j < lines.length; j++) eff.push(esc(lines[j]));

    /* desc 没写就不画那一块，不是画一个空的 —— 跟点位状态里的事件点一个做法 */
    return (def.desc ? mBlock(G.data.t('modal.buff.desc'), esc(def.desc), 'dim') : '') +
           mBlock(G.data.t('modal.buff.left'), esc(leftText(rec)), '') +
           mBlock(G.data.t('modal.buff.effect'),
                  eff.length ? eff.join('<br>') : esc(G.data.t('modal.buff.none')), '') +
           mBlock(G.data.t('modal.buff.unit'), esc(unitText(def.unit)), 'dim');
  }

  /* ---------- 物品详情 / 钱包 / 笔记本 ----------

     第 22 轮（背包系统）加的三种弹框，跟上面三种共用同一套壳。
     **一次只开一个** —— modalKind / modalArg 只有一份，
     所以"点物品详情里的按钮开钱包"天然就是**换**一个弹框，叠不起来。

     三种都是"点开看"，不改任何状态；唯一带动作的是物品详情里那个按钮，
     它走 `bag use <id>`（跟左栏标签的 `bag <id>` 只差一个 use）。
     按钮照样是 `button[data-cmd]`，走 main 的点击委托，不另写一套。 */

  /* 物品详情：描述 / 数量 / 一个动作按钮。

     **按钮画哪个由素材决定**（见 data/items.js）：
       写了 use   -> 「使用」（点了跑效果 + **消耗一个**）
       写了 panel -> 打开那个面板（钱包 / 笔记本，**不消耗**）
       都没写     -> 一个按钮都不画，只剩描述

     **没有「丢弃」** —— 不是"画出来点了没反应"，是根本不画
     （已废弃项，见 docs/设定/06-物品与技能.md）。所以这里永远不会有它。 */
  function itemHtml(id) {
    var def = G.data.item(id);
    /* 物品定义不存在（素材改过 id、存档里留着旧记录）—— 说一句"身上没有"，
       别画个空框。找不到定义时 count 也是 0，但两句提示不一样：
       一句是"没这个东西"，一句是"你没带"。 */
    if (!def) {
      return '<p class="m-idle">' +
             esc(G.data.t('bag.none', { name: id == null ? '' : id })) + '</p>';
    }

    var n = G.items.count(id);
    if (!n) {
      return '<p class="m-idle">' +
             esc(G.data.t('bag.none', { name: def.name })) + '</p>';
    }

    var html = '';
    if (def.desc) html += mBlock(G.data.t('modal.item.desc'), esc(def.desc), 'dim');
    html += mBlock(G.data.t('modal.item.count'),
                   esc(def.stack ? G.data.t('modal.item.count.n', { n: n })
                                 : G.data.t('modal.item.count.one')), '');

    /* 两个按钮都走同一条指令 `bag use <id>` —— "对这个物品做它能做的事"
       由 G.effects 按素材决定（跑效果还是开面板）。这样按钮不用知道
       这个物品是"能用"还是"能开"，以后加第三种动作也不用改这里。 */
    if ((def.use && def.use.length) || def.panel) {
      var label = def.panel
        ? G.data.t('modal.item.open.' + def.panel)
        : G.data.t('modal.item.use');
      html += '<div class="m-act"><button data-cmd="bag" data-arg="use ' +
              esc(def.id) + '">' + esc(label) + '</button></div>';
    }
    return html;
  }

  /* 钱包：各币种余额，按币种表逐行画（以后加币种不用改这里）。

     **一种钱都没有的时候说一句「里面空空的」**，不是画一排 0 ——
     玩家要能区分"我没钱"和"这块界面坏了"。
     有任意一种不为 0 时，**0 也照样列出来** —— 要能看见
     "金币有 30、银币一枚没有"，而不是银币那一行凭空消失。 */
  function walletHtml() {
    var list = G.items.wallet();
    var any = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].amount > 0) any = true;
    }
    if (!any) {
      return '<p class="m-idle">' + esc(G.data.t('modal.wallet.empty')) + '</p>';
    }

    var html = '';
    for (var j = 0; j < list.length; j++) {
      var def = list[j].def;
      html += '<div class="m-block">' +
                '<div class="m-label">' + esc(def.name) + '</div>' +
                '<p class="m-value money"' +
                (def.color ? ' style="--money-color:' + esc(def.color) + '"' : '') + '>' +
                list[j].amount +
                '</p></div>';
    }
    return html;
  }

  /* 笔记本里的一条任务。mode 是 'active'（进行中）或 'done'（已完成）。 */
  function noteQuestHtml(q, mode) {
    var html = '<div class="m-item"><div class="m-head">' +
               '<span class="m-name">' + esc(q.name) + '</span>';

    if (mode === 'done') {
      /* 已完成的那一栏说"完成过几次" —— 可重复任务能重复出现，
         只说"已完成"分不出这是第一轮还是第五轮。 */
      html += '<span class="m-kind">' +
              esc(G.data.t('modal.note.times', { n: G.quests.times(q.id) })) + '</span>';
    } else {
      var need = Number((q.goal || {}).count) || 0;
      var now = G.quests.progress(q.id);
      var ready = now >= need;
      html += '<span class="m-kind' + (ready ? ' ready' : '') + '">' +
              esc(ready ? G.data.t('quest.ready.short')
                        : G.data.t('modal.note.progress', { n: now, total: need })) +
              '</span>';
    }

    html += '</div>';
    if (q.desc) html += '<p class="m-desc">' + esc(q.desc) + '</p>';
    return html + '</div>';
  }

  /* 笔记本：任务分「进行中 / 已完成」两栏。

     **「进行中」= state 是 active**（接了还没交）。
     **「已完成」看的是 times > 0（交过几次差），不是 state === 'done'** ——
     可重复任务交付后 state 立刻回到 available，只有 times 记得住它完成过；
     按 done 列的话，可重复任务**永远进不了「已完成」那一栏**。

     所以**一个可重复任务可能两栏都出现**（正在做第 3 轮、同时已经交过 2 次差）——
     这不是 bug，是它真实的处境（见 docs/设定/06-物品与技能.md）。

     「可接但还没接」的两栏都不列 —— 那是"还没答应的事"，
     笔记本记的是"在办的"和"办过的"，不是"能办的"。 */
  /* 当前这栏（进行中 / 已完成）要列的任务。
     「进行中」= state 是 active；「已完成」= times > 0（交过几次差）。
     一条可重复任务可能两栏都进 —— 这不是 bug，是它真实的处境。 */
  function noteList(section) {
    var out = [];
    var list = G.data.quests || [];
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (section === 'done') { if (G.quests.times(q.id) > 0) out.push(q); }
      else                    { if (G.quests.state(q.id) === G.quests.ACTIVE) out.push(q); }
    }
    return out;
  }

  /* 量条目高度，把一栏切成几「页」：每页塞到默认纸面高度为止，多的放下页。
     返回页码数组 pages[i] = 第 i 页的任务在 items 里的下标集合。 */
  function notePaginate(items, pageEl) {
    var cs = window.getComputedStyle(pageEl);
    var avail = pageEl.clientHeight - (parseFloat(cs.paddingTop) || 0);
    var kids = pageEl.children, pages = [], cur = [], curH = 0, i;
    for (i = 0; i < kids.length; i++) {
      var add = kids[i].offsetHeight;          /* 含条目自己的内边距和分隔线 */
      if (cur.length && curH + add > avail) { pages.push(cur); cur = []; curH = 0; }
      cur.push(i); curH += add;
    }
    if (cur.length) pages.push(cur);
    return pages;
  }

  /* 切栏 / 翻页 的点击入口。data-note 不走 main 的 data-cmd 委托，
     是弹框自己的控件，所以在这里自己管、自己重画。 */
  function onNoteClick(kind, arg) {
    if (kind === 'sec') {
      noteSec = (arg === 'done') ? 'done' : 'active';
      notePage = 0;
    } else if (kind === 'page') {
      notePage += (arg === '-1') ? -1 : 1;
    }
    noteRender();
  }

  /* 画笔记本：壳（两根书签当页签 + 纸面 + 翻页条），再把当前栏切页装进去。
     先铺全部任务量高度，再裁到当前页，最后补翻页条 —— 都在同一次渲染里，
     浏览器只画最后一版，不会有"闪一下整页"的中间态。 */
  function noteRender() {
    /* 笔记本从渲染这一面就保证自己是"书"外观 —— renderModal 的 toggle
       是给法术书+笔记本统一挂的，这里再兜一层，免得哪条路径漏挂、
       纸面退回默认的深色底（就是那个"莫名其妙的黑色背景"）。 */
    if (el.mBox) el.mBox.classList.add('book-mode');
    var items = noteList(noteSec);
    var shell =
      '<div class="book">' +
        '<div class="book-tabs">' +
          '<button type="button" class="book-tab' + (noteSec === 'active' ? ' on' : '') +
            '" data-note="sec" data-arg="active">' + esc(G.data.t('modal.note.active')) + '</button>' +
          '<button type="button" class="book-tab' + (noteSec === 'done' ? ' on' : '') +
            '" data-note="sec" data-arg="done">' + esc(G.data.t('modal.note.done')) + '</button>' +
          '<button type="button" class="sb-close" data-modal="close" ' +
            'title="' + esc(G.data.t('ui.modal.close')) + '">✕</button>' +
        '</div>' +
        '<div class="book-pages"><div class="book-page"></div></div>' +
        '<div class="book-pager"></div>' +
      '</div>';
    el.mBody.innerHTML = shell;

    var pageEl = el.mBody.querySelector('.book-page');
    if (!items.length) {
      pageEl.innerHTML = '<p class="m-idle slim">' +
                         esc(G.data.t('modal.note.' + noteSec + '.none')) + '</p>';
      el.mBody.querySelector('.book-pager').hidden = true;
      return;
    }

    var all = '', i;
    for (i = 0; i < items.length; i++) all += noteQuestHtml(items[i], noteSec);
    pageEl.innerHTML = all;                    /* 先铺全部，量完高度再裁到当前页 */

    var pages = notePaginate(items, pageEl);
    if (notePage >= pages.length) notePage = pages.length - 1;   /* 换了栏页码可能越界 */

    var html = '', slice = pages[notePage];
    for (i = 0; i < slice.length; i++) html += pageEl.children[slice[i]].outerHTML;
    pageEl.innerHTML = html;

    noteRenderPager(pages.length);
  }

  function noteRenderPager(total) {
    var pager = el.mBody.querySelector('.book-pager');
    if (total <= 1) { pager.hidden = true; return; }     /* 一页装得下就别翻页 */
    pager.hidden = false;
    pager.innerHTML =
      '<button type="button" data-note="page" data-arg="-1"' +
        (notePage <= 0 ? ' disabled' : '') + '>‹</button>' +
      '<span class="page-no">' +
        esc(G.data.t('modal.note.pages', { p: notePage + 1, total: total })) + '</span>' +
      '<button type="button" data-note="page" data-arg="1"' +
        (notePage >= total - 1 ? ' disabled' : '') + '>›</button>';
  }

  /* 标题 + 正文。状态详情的标题用状态自己的名字（带正负面小标签）——
     标题写"状态详情"的话，开着好几个弹框就分不清看的是哪个了。
     物品详情同理，用物品名 + 分类小标签。 */
  function modalView(kind, arg) {
    /* 法术书：旧的「释放法术」（spells）和「技艺」（arts）都合并到这里。
       标题前那个📖就是左上角的书本图标。 */
    if (kind === 'spellbook' || kind === 'spells' || kind === 'arts') {
      return { title: '📖 ' + esc(G.data.t('modal.book.title')), html: spellbookHtml() };
    }
    if (kind === 'item') {
      var idef = G.data.item(arg);
      var ikind = idef ? G.data.itemKind(idef.kind) : null;
      var tag = '';
      if (ikind) {
        tag = '<span class="m-tag kind"' +
              (ikind.color ? ' style="--item-color:' + esc(ikind.color) + '"' : '') +
              '>' + esc(ikind.name) + '</span>';
      }
      return {
        title: esc(idef ? idef.name : G.data.t('modal.item.title')) + tag,
        html: itemHtml(arg)
      };
    }
    if (kind === 'wallet') {
      return { title: esc(G.data.t('modal.wallet.title')), html: walletHtml() };
    }
    if (kind === 'notebook') {
      /* 正文不在这画 —— renderModal 对笔记本走 noteRender()（要量高度翻页）。
         标题带📖，跟法术书同一套书壳。 */
      return { title: '📖 ' + esc(G.data.t('modal.note.title')), html: '' };
    }
    if (kind === 'buff') {
      var rec = null, list = G.statuses.owned();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === arg) rec = list[i];
      }
      var bad = rec && rec.def.kind === 'debuff';
      return {
        title: esc(rec ? rec.def.name : G.data.t('modal.buff.title')) +
               '<span class="m-tag ' + (bad ? 'bad' : 'good') + '">' +
               esc(G.data.t(bad ? 'ui.buff.bad' : 'ui.buff.good')) + '</span>',
        html: buffHtml(arg)
      };
    }
    return { title: '📖 ' + esc(G.data.t('modal.book.title')), html: spellbookHtml() };
  }

  /* ---------- 地图点位状态 ---------- */

  /* 人名，用类型色。颜色来自数据表，这里只负责搬运。 */
  function npcNameHtml(npc) {
    var type = G.data.npcType(npc.type);
    return '<dd class="npc-name"' +
           (type && type.color ? ' style="--npc-color:' + esc(type.color) + '"' : '') +
           '>' + esc(npc.name) + '</dd>';
  }

  /* 类型名 · 态度阶段名 分数 */
  function npcMetaHtml(npc) {
    var type = G.data.npcType(npc.type);
    var stage = G.rules.attitudeStage(npc.attitude);
    var meta = [];
    if (type && type.name) meta.push(esc(type.name));
    meta.push('<span' + (stage.color ? ' style="color:' + esc(stage.color) + '"' : '') + '>' +
              esc(stage.name) + ' ' + esc(npc.attitude) + '</span>');
    return '<dd class="npc-meta">' + meta.join(' · ') + '</dd>';
  }

  /* 一个 NPC 身上的任务，作为**信息行**列出来（进行中的报进度，交过的说已完成）。
     能接 / 能交的那些不在这里 —— 它们会变成对话面板里的选项按钮。 */
  function npcQuestHtml(npc, room) {
    var html = '';
    var list = G.quests.ofNpc(npc, room);
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var state = G.quests.state(q.id);
      var need = Number((q.goal || {}).count) || 0;

      if (state === G.quests.ACTIVE) {
        var done = G.quests.isReady(q.id);
        html += '<dd class="npc-quest' + (done ? ' ready' : '') + '">' + esc(q.name) + ' ' +
                esc(done ? G.data.t('quest.ready.short')
                         : G.data.t('modal.note.progress',
                                    { n: G.quests.progress(q.id), total: need })) + '</dd>';
      } else if (state === G.quests.DONE) {
        html += '<dd class="npc-quest done">' + esc(q.name) + ' ' +
                esc(G.data.t('quest.finished')) + '</dd>';
      }
      /* available 的在这里不列 —— 它已经是「接受」按钮了，不重复说一遍 */
    }
    return html;
  }

  /* 二级操作：点了「跟某某说话」之后能做什么。

     台词 + 任务进度 + 选项都在这里。**名字和态度不在这里重复画** ——
     一级区（地图点位状态）那两行就是给这个用的，而且当前说话的那个人
     在一级区是高亮的。两块面板各讲自己那一层，不互相抄。 */
  function talkPanelHtml(npc) {
    var type = G.data.npcType(npc.type);
    /* 名字那一圈要跟一级区同名同色，所以得裹一个 span。
       G.data.t 只做纯字符串替换、不转义（见 js/data.js），
       所以这里传进去的是拼好的标签 —— 名字本身已经 esc 过了。 */
    var who = '<span>' + esc(npc.name) + '</span>';
    var html = '<dt class="talk-head"' +
               (type && type.color ? ' style="--npc-color:' + esc(type.color) + '"' : '') +
               '>' + G.data.t('ui.talking', { name: who }) + '</dt>';
    html += '<dd class="talk-line">「' + esc(G.talk.line()) + '」</dd>';
    html += npcQuestHtml(npc, G.state.room());

    /* 对话是一排选项，**一个任务就是一个选项** —— 普通对话、接任务、交任务
       可以同时挂在同一个人身上，各点各的。

       选项全部塞进**同一个 dd** 里排成一列。一个选项占一个 dd 的话，
       选项一多（普通对话 + 好几个任务 + 结束对话）就会把面板撑出滚动条，
       最下面那个按钮被裁掉一半。 */
    var opts = G.talk.options();
    var btns = '';
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var arg = o.kind === 'chat' ? 'chat' : o.kind + ' ' + o.questId;
      /* 任务选项用金色，闲聊用中性色 —— 一眼分得出哪个是正事 */
      var cls = o.kind === 'chat' ? 'talk' : 'quest';
      btns += '<button class="' + cls + '" data-cmd="talk" data-arg="' +
              esc(arg) + '">' + esc(o.label) + '</button>';
    }
    btns += '<button class="talk ghost" data-cmd="talk" data-arg="bye">' +
            esc(G.data.t('talk.opt.bye')) + '</button>';
    return html + '<dd class="acts">' + btns + '</dd>';
  }

  /* 二级操作面板。没在说话时给一句灰提示 ——
     面板挺高，内容只有一行，空着会显得像坏了。
     idle 类是为了让那句提示居中（光靠 dd 自己没法在很高的面板里居中）。 */
  function renderSecondary() {
    var npc = G.talk.current();
    el.second.className = npc ? '' : 'idle';
    el.second.innerHTML = npc
      ? talkPanelHtml(npc)
      : '<dd class="idle">' + esc(G.data.t('ui.secondaryIdle')) + '</dd>';
  }

  /* 脚下的事件点：它是什么 + 一句描述 + 互动按钮。

     **只有站在它上面时才画这一块** —— 跟门、跟人一个做法：动作属于哪个东西，
     按钮就跟着那个东西出现。没站在上面时它根本不存在。

     按钮**只在素材写了 onUse 的时候才画**。纯 onCollide 的事件点没有按钮：
     它的动作是"走上去"，玩家已经走上来了，再给个按钮是多余。

     已经用掉的一次性事件点不会走到这里 —— G.events.at() 已经把它滤掉了，
     所以地图、这一块、触发判定是一起消失的。 */
  function eventHtml(ev) {
    var type = G.data.eventType(ev.type);
    var style = (type && type.color)
              ? ' style="--event-color:' + esc(type.color) + '"' : '';

    var html = '<dt>地上</dt>';
    html += '<dd class="event-name"' + style + '>' + esc(ev.name) + '</dd>';
    if (type && type.name) html += '<dd class="event-meta">' + esc(type.name) + '</dd>';
    /* desc 没写就不画这一行，不是画一行空的 */
    if (ev.desc) html += '<dd class="event-desc">' + esc(ev.desc) + '</dd>';

    if (ev.onUse && ev.onUse.length) {
      /* 按钮上那圈颜色要跟上面那块一致，所以 --event-color 在这里再写一次 ——
         按钮靠继承拿不到兄弟元素的变量。 */
      html += '<dd class="act"' + style + '><button class="use" data-cmd="use">' +
              esc(ev.hint || G.data.t('use.opt')) + '</button></dd>';
    }
    return html;
  }

  /* 旁边站着谁：一人一块（名字 + 类型 · 态度 + 说话按钮）。
     NPC 挡路之后人只可能在旁边，不可能在脚下，所以这一块讲的是四邻。
     动作属于哪个东西，按钮就跟着哪个东西出现 —— 对话按钮只在这里画，
     没站在人旁边时它根本不存在。

     **只列人，不列任务进度。** 进度点开对话、在右栏的二级操作里看；
     "这人身上有活可干"另有提示（地图上那一格右上角的角标），不在这儿重复。

     一级区**永远**列着旁边所有人 —— 正在说话的那个只是换个颜色（cur），
     不从这儿消失。这样点另一个人的按钮就直接切过去，不用先按「结束对话」。 */
  function nearHtml(npcs, curId) {
    var html = '<dt>旁边的人</dt>';
    for (var i = 0; i < npcs.length; i++) {
      var npc = npcs[i];
      html += npcNameHtml(npc);
      html += npcMetaHtml(npc);
      html += '<dd class="act"><button class="talk' + (npc.id === curId ? ' cur' : '') +
              '" data-cmd="talk" data-arg="' + esc(npc.id) + '">' +
              esc(G.data.t('talk.opt.start', { name: npc.name })) + '</button></dd>';
    }
    return html;
  }

  /* 这一栏讲的是"玩家此刻脚下这一格"：属于哪个区域、在哪个房间、
     坐标多少、站的是空地还是门、这扇门通往哪里、旁边站着谁。
     不列四邻可走方向，也不统计本室出口 —— 见函数里那段说明。 */
  function renderTile() {
    var st = G.state.data;
    var room = G.state.room();
    if (!st || !room) { el.tile.innerHTML = ''; return; }

    var x = st.world.x, y = st.world.y;
    var door = G.data.doorAt(room, x, y);

    /* 区域是房间的分组（见 data/areas.js）。
       正常情况下这一行一定有值 —— validate.mjs 强制每个房间都得填 area。
       兜底那个「—」只是不想因为一处漏填就让整行消失、把面板撑变。 */
    var area = G.data.areaOf(room);

    var html = '';
    html += '<dt>区域</dt><dd class="dim">' + esc(area ? area.name : '—') + '</dd>';
    html += '<dt>房间</dt><dd>' + esc(room.name) + '</dd>';
    html += '<dt>坐标</dt><dd>(' + x + ',' + y + ')</dd>';
    html += '<dt>脚下</dt><dd' + (door ? ' class="door"' : ' class="dim"') + '>' +
            (door ? '一扇门' : '空地') + '</dd>';

    if (door) {
      var to = G.data.room(door.to);
      html += '<dt>通往</dt><dd class="door">' + esc(to ? to.name : door.to) +
              (door.name ? '（' + esc(door.name) + '）' : '') + '</dd>';
      /* 进入是门自己的动作，所以按钮跟着门走，只在这一格上出现。
         没站在门上时这里什么都没有，也就点不出"进入"。
         （dl 里一个 dt 后面可以跟多个 dd，这样写是合法的。） */
      html += '<dd class="act"><button data-cmd="enter">进入这扇门</button></dd>';
    }

    /* 脚下的事件点。事件点**不挡路**，所以玩家可以站在它上面 ——
       跟 NPC 不一样，这一块讲的就是"脚下"，不是"旁边"。 */
    var ev = G.events.at(room, x, y);
    if (ev) html += eventHtml(ev);

    /* 旁边的人。NPC 挡路之后，人就只可能在旁边、不可能在脚下 ——
       所以这一块讲的是四邻，而不是"脚下是谁"。跟「可走方向」不一样：
       那个地图已经说清了（能点的格子本来就会亮），
       而"谁站在旁边"是要交互的对象，动作按钮必须跟着它出现。

       **这里永远只列人**，正在说话的那个只是换个颜色。
       对话的台词、任务进度、选项全在右栏的二级操作里（见 renderSecondary）——
       所以一级区不会因为"开口了"就整块被替换掉，
       旁边站着两个人时也能直接点另一个切过去，不用先结束对话。 */
    var npcs = G.data.npcsNear(room, x, y);
    if (npcs.length) {
      var talking = G.talk.current();
      html += nearHtml(npcs, talking ? talking.id : null);
    }

    /* 到此为止，不再往下加东西。
       以前这里还有「可走」和「本室出口」两行，都去掉了：
       - 「可走」跟地图重复：走得通的方向，地图上那格已经能点、悬停会亮，
         再列一遍是同一件事说两遍；
       - 「本室出口」是给开发者看的信息，玩家用不上，而且跟「通往」容易看串
         （一个讲这屋子有几扇门，一个讲脚下这扇门通向哪）。
       这两项连计算一起删了 —— 没人看的东西不值得每帧算一遍。 */

    el.tile.innerHTML = html;
  }

  /* ---------- 操作面板 ---------- */

  /* groups: [{ name: '移动', pad: true, items: [{ cmd, label, danger }] }]
     pad = true 的组排成方向盘，其余组排成一行按钮。 */
  function renderActions(groups) {
    var html = '';
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      html += '<div class="group"><h3>' + esc(g.name) + '</h3>' +
              '<div class="' + (g.pad ? 'pad' : 'btns') + '">';
      for (var j = 0; j < g.items.length; j++) {
        var it = g.items[j];
        /* arg 是可选的：技能按钮要把技能 id 带上（cast + 技能 id），
           其它指令没有参数。 */
        html += '<button data-cmd="' + esc(it.cmd) + '"' +
                (it.arg ? ' data-arg="' + esc(it.arg) + '"' : '') +
                (it.danger ? ' class="danger"' : '') +
                ' title="' + esc(it.label) + '">' + esc(it.label) + '</button>';
      }
      html += '</div></div>';
    }
    el.actions.innerHTML = html;
  }

  /* ---------- 创建角色页 ---------- */

  function showCreate() {
    el.app.hidden = true;
    el.create.hidden = false;
    setCreateError('');
    var input = document.getElementById('create-name');
    input.value = '';
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 0);
  }

  function hideCreate() {
    el.create.hidden = true;
    el.app.hidden = false;
  }

  function setCreateError(msg) {
    el.err.textContent = msg || '';
  }

  /* ---------- 其他 ---------- */

  function setNote(text) {
    el.note.textContent = text || '';
  }

  /* 走路模式 / 命令模式。差别只在提示语和边框亮度，
     真正决定按键归谁管的是 main.js 里的键盘分发。 */
  function setMode(mode) {
    var walk = mode !== 'cmd';
    el.bar.classList.toggle('walk', walk);
    el.cmd.placeholder = G.data.t(walk ? 'ui.walkHint' : 'ui.cmdHint');
  }

  function setPlaceholder(text) {
    el.cmd.placeholder = text;
  }

  function clearInput() {
    el.cmd.value = '';
  }

  function refresh() {
    renderMap();
    renderStatus();
    renderBuffs();
    renderBag();
    renderTile();
    renderSecondary();
    renderSaveLabel();
    /* 弹框开着时跟着重画（比如状态刚好在这一步过期了）。
       关着的时候 modalKind 是 null，这一步什么都不做。 */
    renderModal();
  }

  return {
    init: init,
    log: log,
    clearLog: clearLog,
    renderMap: renderMap,
    renderStatus: renderStatus,
    renderBuffs: renderBuffs,
    renderBag: renderBag,
    renderTile: renderTile,
    renderSecondary: renderSecondary,
    renderSaveLabel: renderSaveLabel,
    renderActions: renderActions,
    openModal: openModal,
    closeModal: closeModal,
    modalOpen: modalOpen,
    showCreate: showCreate,
    hideCreate: hideCreate,
    setCreateError: setCreateError,
    setNote: setNote,
    setMode: setMode,
    setPlaceholder: setPlaceholder,
    clearInput: clearInput,
    refresh: refresh,
    esc: esc
  };

})();
